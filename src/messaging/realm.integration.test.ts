/** Synthetic file/WAL actors, not HTTP or Guardian qualification. Real current-authority transport is a separate gate. */
import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseCoordinator } from '../databases/database-coordinator';
import { createAsyncDatabaseClient } from '../databases/database-client';
import { createSubprocessDatabaseExecutorFactory } from '../databases/subprocess-database-executor-factory';
import type { AsyncDatabaseOperationExecutor, DatabaseSerializableValue } from '../databases/database-operations';
import { messagingRealm } from './realm';
import { MESSAGING_ACTOR_FLAG } from './actor-bootstrap';
import { readMessagingActorRejection } from './realm-errors';
import { Database } from 'bun:sqlite';
import { resolveDatabaseFile } from '../databases/database-file';
import { legacyMessagingRealm } from './test-support/legacy-realm';

async function fixture(legacy = false) {
  const root = await mkdtemp(join(tmpdir(), 'zero-messaging-realm-'));
  let owner!: DatabaseCoordinator, lease!: Awaited<ReturnType<DatabaseCoordinator['acquire']>>;
  const open = async () => {
    owner = new DatabaseCoordinator({ rootDirectory: root, realm: legacy ? legacyMessagingRealm : messagingRealm, sqlite: { synchronous: 'FULL' }, maxDatabases: 1, readers: true, sweepIntervalMs: false,
      createExecutor: createSubprocessDatabaseExecutorFactory({ launch: { kind: 'source', entrypoint: new URL(legacy ? './test-support/legacy-actor-entry.ts' : './actor-entry.ts', import.meta.url) }, actorFlag: MESSAGING_ACTOR_FLAG, env: {} }) });
    owner.start(); lease = await owner.acquire('messaging:content'); return createAsyncDatabaseClient({ executor: lease as AsyncDatabaseOperationExecutor });
  };
  let data = await open();
  return {
    async command(name: string, input: unknown, transportId: string = crypto.randomUUID()): Promise<any> {
      try { const result = await data.command(name, input as DatabaseSerializableValue, { idempotencyKey: transportId }); return (result.value as any).output; }
      catch (error) { const domain = readMessagingActorRejection(error); if (!domain) throw error; return { ok: false, code: domain.code, status: domain.status }; }
    },
    async query(name: string, input: unknown): Promise<any> { return (await data.query(name, input as DatabaseSerializableValue, { consistency: { mode: 'strong' } })).value; },
    async restart() { lease.release(); await owner.close(); legacy = false; data = await open(); },
    /** Synthetic offline clock/quota fault injection only, never an application migration or a public escape hatch. */
    async fault(run: (db: Database) => void) { lease.release(); await owner.close(); const database = new Database(resolveDatabaseFile(root, 'messaging:content').path); try { run(database); } finally { database.close(); } data = await open(); },
    async close() { lease.release(); await owner.close(); },
  };
}
const alice = { scopeId: 'application', id: 'user-alice', kind: 'user', staff: false };
const bob = { ...alice, id: 'user-bob' }, carol = { ...alice, id: 'user-carol' };
const staff = { ...alice, id: 'staff-one', staff: true }, customer = { ...alice, id: 'external-one', kind: 'external' };
const create = (actor = alice, contactsOnly = false) => ({ actor, id: 'conversation-one', requestId: 'create-one', kind: 'group', title: 'Synthetic discussion', userIds: [bob.id], contactsOnly, maxParticipants: 100 });
const send = (n: number, actor = alice) => ({ actor, conversationId: 'conversation-one', id: 'message-' + n, requestId: 'send-' + n, text: 'Synthetic message ' + n, maxMessageLength: 20000 });

test('peer notification reviews are sender-only, history-bound and dismissible without granting group-owner operator powers', async () => {
  const f = await fixture();
  const query = (name: string, actor: typeof alice, extra: object = {}) => f.query(name, { actor, conversationId: 'conversation-one', ...extra });
  try {
    await f.command('messaging.conversation.create', create());
    await f.command('messaging.message.send', { ...send(1), notificationsEnabled: true });
    await f.command('messaging.message.send', { ...send(2, bob), notificationsEnabled: true });
    const jobs = (await f.query('messaging.jobs.pending', { scopeId: 'application' })).value as { id: string; message_id: string }[];
    const first = jobs.find(job => job.message_id === 'message-1')!, second = jobs.find(job => job.message_id === 'message-2')!;
    for (const [index, job] of [first, second].entries()) {
      const ref = { scopeId: 'application', id: job.id, nonce: 'review-' + index };
      await f.command('messaging.job.claim', { ...ref, policyHash: null, leaseMs: 30000 });
      await f.command('messaging.job.review', { ...ref, code: 'NOTIFICATIONS_DISABLED' });
    }
    expect((await query('messaging.reviews', alice)).value.items.map((job: any) => job.id)).toEqual([first.id]);
    expect((await query('messaging.reviews', bob)).value.items.map((job: any) => job.id)).toEqual([second.id]);
    expect((await query('messaging.review', alice, { id: second.id })).code).toBe('MESSAGING_NOT_FOUND'); // Even the group owner cannot inspect another sender.
    expect((await query('messaging.review', bob, { id: first.id })).code).toBe('MESSAGING_NOT_FOUND');
    expect((await f.query('messaging.conversation', { actor: alice, id: 'conversation-one' })).value.reviewCount).toBe(1);
    expect((await query('messaging.review', alice, { id: first.id })).value.draftText).toBeNull();
    const dismiss = { actor: alice, conversationId: 'conversation-one', id: first.id, expectedOwnerEpoch: 1, action: 'dismiss', requestId: 'dismiss-own-notice' };
    expect((await f.command('messaging.review.resolve', { ...dismiss, action: 'retry', acknowledgePossibleDuplicate: true })).code).toBe('MESSAGING_STAGE_CONFLICT');
    expect((await f.command('messaging.review.resolve', { ...dismiss, actor: bob })).code).toBe('MESSAGING_NOT_FOUND');
    expect((await f.command('messaging.review.resolve', dismiss)).ok).toBe(true);
    expect((await query('messaging.reviews', alice)).value.items).toHaveLength(0);
    expect((await query('messaging.reviews', bob)).value.items).toHaveLength(1);
    await f.restart();
    expect((await f.command('messaging.review.resolve', dismiss)).ok).toBe(true);
    const detail = (await query('messaging.review', alice, { id: first.id })).value;
    expect(detail.reason).toBe('NOTIFICATIONS_DISABLED'); expect(detail.resolution.action).toBe('dismiss');
    expect((await f.command('messaging.conversation.change', { actor: alice, id: 'conversation-one', requestId: 'remove-notice-author', expectedRevision: 1, action: 'remove', value: bob.id })).ok).toBe(true);
    expect((await query('messaging.reviews', bob)).code).toBe('MESSAGING_NOT_FOUND');
    expect((await f.command('messaging.conversation.change', { actor: alice, id: 'conversation-one', requestId: 'rejoin-notice-author', expectedRevision: 2, action: 'add', value: bob.id, contactsOnly: false, history: 'since-join', maxParticipants: 100 })).ok).toBe(true);
    expect((await query('messaging.reviews', bob)).value.items).toHaveLength(0);
    expect((await query('messaging.review', bob, { id: second.id })).code).toBe('MESSAGING_NOT_FOUND');
  } finally { await f.close(); }
}, 30000);

test('retained v7 messages, identities, reactions and exact receipts survive additive queue/visitor migrations without reinitializing their database', async () => {
  const f = await fixture(true);
  try {
    expect(legacyMessagingRealm.migrationChecksums).toEqual(messagingRealm.migrationChecksums.slice(0, 7));
    await f.command('messaging.conversation.create', create()); await f.command('messaging.message.send', send(1));
    await f.command('messaging.message.react', { actor: bob, conversationId: 'conversation-one', id: 'message-1', requestId: 'legacy-reaction', emoji: '👍', selected: true });
    const receipt = (await f.query('messaging.receipt', { actor: alice, requestId: 'send-1' })).value;
    await f.restart();
    const message = (await f.query('messaging.messages', { actor: bob, conversationId: 'conversation-one' })).value.items[0];
    expect(message).toMatchObject({ id: 'message-1', authorId: alice.id, sequence: 1, text: 'Synthetic message 1', reactions: [{ emoji: '👍', count: 1, selected: true }] });
    expect((await f.query('messaging.receipt', { actor: alice, requestId: 'send-1' })).value).toEqual(receipt);
    expect((await f.command('messaging.message.send', send(1))).value.id).toBe('message-1');
    expect((await f.query('messaging.messages', { actor: alice, conversationId: 'conversation-one' })).value.items).toHaveLength(1);
    await f.fault(db => {
      expect(db.query("SELECT name FROM sqlite_schema WHERE name='messaging_support_queue'").get()).toBeTruthy();
      expect(db.query("SELECT name FROM sqlite_schema WHERE name='messaging_visitor_budgets'").get()).toBeTruthy();
    });
    expect((await f.command('messaging.message.send', send(2))).value.sequence).toBe(2);
  } finally { await f.close(); }
}, 30000);

test('canonical visitor capabilities enforce entry routing, current expiry/revocation, rollback and duplicate-safe durable quotas', async () => {
  const f = await fixture(), hash = 'a'.repeat(64), token = 'b'.repeat(64);
  const input = { scopeId: 'application', entryId: 'website', policyHash: hash, id: 'session-one', customerId: 'visitor-one', conversationId: 'conversation-one', tokenHash: token, ttlSeconds: 60, maxVisitors: 1, title: 'Website', owner: 'triage', assistantId: null };
  try {
    expect((await f.command('messaging.visitor.create', input)).ok).toBe(true);
    const session = (await f.query('messaging.visitor.session', { scopeId: 'application', entryId: 'website', policyHash: hash, id: 'session-one', tokenHash: token })).value;
    const guest = session.actor;
    expect((await f.command('messaging.visitor.create', { ...input, id: 'another-session', customerId: 'another-visitor', conversationId: 'another-chat' })).code).toBe('MESSAGING_CAPACITY');
    expect((await f.query('messaging.support.queue', { actor: staff })).value.items).toHaveLength(0);
    expect((await f.command('messaging.support.claim', { actor: staff, id: 'conversation-one', requestId: 'unrouted', expectedEpoch: 1, maxParticipants: 100 })).code).toBe('MESSAGING_NOT_FOUND');
    const routed = { ...staff, supportPolicies: { website: hash } };
    expect((await f.query('messaging.support.queue', { actor: routed })).value.items).toHaveLength(1);
    await f.command('messaging.support.claim', { actor: routed, id: 'conversation-one', requestId: 'routed', expectedEpoch: 1, maxParticipants: 100 });
    expect((await f.query('messaging.messages', { actor: staff, conversationId: 'conversation-one' })).code).toBe('MESSAGING_NOT_FOUND');
    expect((await f.command('messaging.conversation.create', create(guest))).code).toBe('MESSAGING_FORBIDDEN');
    expect((await f.command('messaging.message.send', { ...send(1, guest), text: '' })).code).toBe('MESSAGING_INPUT_INVALID');
    await f.fault(db => db.query('UPDATE messaging_sessions SET write_window=?,write_count=119 WHERE id=?').run(Math.floor(Date.now() / 60000), 'session-one'));
    expect((await f.command('messaging.message.send', send(1, guest))).ok).toBe(true);
    expect((await f.command('messaging.message.send', send(1, guest))).ok).toBe(true); // A known accepted intent does not consume quota twice.
    expect((await f.command('messaging.message.send', send(2, guest))).code).toBe('MESSAGING_CAPACITY');
    expect((await f.query('messaging.messages', { actor: guest, conversationId: 'conversation-one' })).value.items).toHaveLength(1);
    await f.fault(db => db.query('UPDATE messaging_sessions SET expires_at=? WHERE id=?').run(Date.now() - 1, 'session-one'));
    expect((await f.query('messaging.messages', { actor: guest, conversationId: 'conversation-one' })).code).toBe('MESSAGING_FORBIDDEN');
    expect((await f.command('messaging.message.send', send(1, guest))).code).toBe('MESSAGING_FORBIDDEN'); // Receipts are not an expiry bypass.
    await f.fault(db => db.query('UPDATE messaging_sessions SET expires_at=?,revoked=1 WHERE id=?').run(Date.now() + 60000, 'session-one'));
    expect((await f.query('messaging.receipt', { actor: guest, requestId: 'send-1' })).code).toBe('MESSAGING_FORBIDDEN');
    expect((await f.query('messaging.messages', { actor: routed, conversationId: 'conversation-one' })).value.items).toHaveLength(1); // Retained staff history is not deleted.
  } finally { await f.close(); }
}, 30000);

test('only the current human support owner can resolve/reopen; stale staff cannot hand the conversation back', async () => {
  const f = await fixture(), second = { ...staff, id: 'staff-two' };
  const change = (actor: typeof staff, requestId: string, revision: number, archived: boolean) => f.command('messaging.conversation.change', { actor, id: 'conversation-one', requestId, expectedRevision: revision, action: 'archive', value: archived });
  try {
    await f.command('messaging.support.open', { actor: customer, id: 'conversation-one', requestId: 'support-one', title: '', owner: 'triage', channelId: null });
    await f.command('messaging.support.claim', { actor: staff, id: 'conversation-one', requestId: 'first-claim', expectedEpoch: 1, maxParticipants: 100 });
    await f.command('messaging.support.claim', { actor: second, id: 'conversation-one', requestId: 'take-over', expectedEpoch: 2, maxParticipants: 100 });
    expect((await change(staff, 'old-owner-close', 3, true)).code).toBe('MESSAGING_FORBIDDEN');
    expect((await f.command('messaging.conversation.owner', { actor: staff, id: 'conversation-one', requestId: 'old-owner-handback', expectedEpoch: 3, owner: 'triage' })).code).toBe('MESSAGING_FORBIDDEN');
    expect((await change(second, 'resolve', 3, true)).value).toMatchObject({ revision: 4 });
    expect((await f.query('messaging.conversation', { actor: customer, id: 'conversation-one' })).value).toMatchObject({ archived: true, ownerEpoch: 4 });
    expect((await f.query('messaging.support.queue', { actor: staff })).value.items).toHaveLength(0);
    expect((await f.command('messaging.message.send', send(1, customer))).code).toBe('MESSAGING_ARCHIVED');
    expect((await f.command('messaging.conversation.owner', { actor: second, id: 'conversation-one', requestId: 'closed-handback', expectedEpoch: 4, owner: 'assistant' })).code).toBe('MESSAGING_ARCHIVED');
    expect((await change(second, 'stale-reopen', 3, false)).code).toBe('MESSAGING_REVISION_CONFLICT');
    expect((await change(second, 'reopen', 4, false)).value).toMatchObject({ revision: 5 });
    expect((await f.query('messaging.conversation', { actor: customer, id: 'conversation-one' })).value).toMatchObject({ archived: false, ownerEpoch: 5, ownerId: second.id });
    await f.restart();
    expect((await f.query('messaging.receipt', { actor: second, requestId: 'resolve' })).value).toMatchObject({ operation: 'archive', resourceId: 'conversation-one' });
    expect((await change(second, 'resolve', 3, true)).ok).toBe(true); // Receipt replay does not resolve the reopened conversation again.
    expect((await f.query('messaging.conversation', { actor: customer, id: 'conversation-one' })).value.archived).toBe(false);
  } finally { await f.close(); }
}, 30000);

test('support queue is oldest-first with bounded filter-bound keyset cursors rather than random identity order', async () => {
  const f = await fixture();
  try {
    for (const id of ['z-oldest', 'm-middle', 'a-newest']) await f.command('messaging.support.open', { actor: customer, id, requestId: 'open-' + id, title: '', owner: 'triage', channelId: null });
    const first = (await f.query('messaging.support.queue', { actor: staff, query: { owner: 'triage', limit: 1 } })).value;
    expect(first.items.map((row: any) => row.id)).toEqual(['z-oldest']); expect(first.hasMore).toBe(true);
    const second = (await f.query('messaging.support.queue', { actor: staff, query: { owner: 'triage', limit: 1, after: first.nextCursor } })).value;
    expect(second.items.map((row: any) => row.id)).toEqual(['m-middle']);
    expect((await f.query('messaging.support.queue', { actor: staff, query: { owner: 'human', after: first.nextCursor } })).code).toBe('MESSAGING_INPUT_INVALID');
    expect((await f.query('messaging.support.queue', { actor: staff, query: { after: 'not-a-cursor' } })).code).toBe('MESSAGING_INPUT_INVALID');
    const third = (await f.query('messaging.support.queue', { actor: staff, query: { owner: 'triage', limit: 1, after: second.nextCursor } })).value;
    expect(third.items.map((row: any) => row.id)).toEqual(['a-newest']); expect(third.nextCursor).toBeNull();
  } finally { await f.close(); }
}, 30000);

test('customer escalation preserves the conversation, fences AI ownership and cannot assign or displace a human', async () => {
  const f = await fixture();
  const request = { actor: customer, id: 'conversation-one', requestId: 'ask-person', expectedEpoch: 1 };
  try {
    await f.command('messaging.support.open', { actor: customer, id: 'conversation-one', requestId: 'support-one', title: 'Synthetic question', owner: 'assistant', channelId: null });
    await f.command('messaging.message.send', send(1, customer));
    expect((await f.command('messaging.support.request-human', { ...request, actor: carol })).code).toBe('MESSAGING_NOT_FOUND');
    expect((await f.command('messaging.support.request-human', { ...request, actor: { ...customer, scopeId: 'tenant:other' } })).code).toBe('MESSAGING_NOT_FOUND');
    expect((await f.command('messaging.support.request-human', request)).value).toMatchObject({ id: 'conversation-one', ownerEpoch: 2 });
    const waiting = (await f.query('messaging.conversation', { actor: customer, id: 'conversation-one' })).value;
    expect(waiting).toMatchObject({ owner: 'triage', ownerId: null, ownerEpoch: 2, revision: 2 });
    expect(waiting.participants).toHaveLength(1);
    expect((await f.query('messaging.support.queue', { actor: staff, query: { owner: 'triage' } })).value.items).toHaveLength(1);
    expect((await f.query('messaging.support.queue', { actor: staff, query: { owner: 'assistant' } })).value.items).toEqual([]);
    expect((await f.query('messaging.support.queue', { actor: customer })).code).toBe('MESSAGING_FORBIDDEN');
    expect((await f.query('messaging.messages', { actor: customer, conversationId: 'conversation-one' })).value.items.map((row: any) => row.id)).toEqual(['message-1']);
    await f.command('messaging.support.claim', { actor: staff, id: 'conversation-one', requestId: 'claim-waiting', expectedEpoch: 2, maxParticipants: 100 });
    expect((await f.command('messaging.support.request-human', request)).value.ownerEpoch).toBe(2); // Replay acknowledges the old intent, not another transition.
    expect((await f.command('messaging.support.request-human', { ...request, requestId: 'stale-human', expectedEpoch: 2 })).code).toBe('MESSAGING_OWNER_CONFLICT');
    expect((await f.command('messaging.support.request-human', { ...request, requestId: 'already-human', expectedEpoch: 3 })).value.ownerEpoch).toBe(3);
    expect((await f.query('messaging.conversation', { actor: customer, id: 'conversation-one' })).value).toMatchObject({ owner: 'human', ownerId: staff.id, ownerEpoch: 3 });
    await f.restart();
    expect((await f.query('messaging.receipt', { actor: customer, requestId: 'ask-person' })).value).toMatchObject({ operation: 'support.request-human', resourceId: 'conversation-one' });
    expect((await f.command('messaging.support.request-human', { ...request, requestId: 'forged-person', expectedEpoch: 3, userId: carol.id })).code).toBe('MESSAGING_INPUT_INVALID');
  } finally { await f.close(); }
}, 30000);

test('a private direct conversation cannot silently become a multi-person group', async () => {
  const f = await fixture();
  try {
    expect((await f.command('messaging.conversation.create', { ...create(), kind: 'direct' })).ok).toBe(true);
    expect((await f.command('messaging.conversation.change', { actor: alice, id: 'conversation-one', requestId: 'forbidden-direct-expansion', expectedRevision: 1, action: 'add', value: carol.id, contactsOnly: false, history: 'all', maxParticipants: 100 })).code).toBe('MESSAGING_FORBIDDEN');
    expect((await f.query('messaging.conversation', { actor: alice, id: 'conversation-one' })).value.participants).toHaveLength(2);
  } finally { await f.close(); }
}, 30000);

test('concurrent accepted inserts have stable order, durable replay, scope isolation and monotonic read positions after restart', async () => {
  const f = await fixture();
  try {
    expect((await f.command('messaging.conversation.create', create())).ok).toBe(true);
    const sent = await Promise.all(Array.from({ length: 24 }, (_, i) => f.command('messaging.message.send', send(i + 1))));
    expect(sent.every(value => value.ok)).toBe(true);
    expect(sent.map(value => value.value.sequence).sort((a, b) => a - b)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    expect((await f.query('messaging.conversation', { actor: bob, id: 'conversation-one' })).value.unreadCount).toBe(24);
    const first = await f.query('messaging.messages', { actor: bob, conversationId: 'conversation-one', query: { limit: 10 } });
    expect(first.value.items.map((row: any) => row.sequence)).toEqual([24, 23, 22, 21, 20, 19, 18, 17, 16, 15]);
    expect(first.value.nextCursor).toBe('15');
    await f.restart();
    const exact = send(25);
    const accepted = await f.command('messaging.message.send', exact, 'fixed-transport-identity');
    expect(await f.command('messaging.message.send', exact, 'fixed-transport-identity')).toEqual(accepted);
    // A different Fabric transport key proves the canonical receipt, not just a short-lived actor receipt, is replay-safe.
    expect((await f.command('messaging.message.send', send(1), 'new-transport-key')).value.id).toBe('message-1');
    expect((await f.command('messaging.message.send', { ...send(1), text: 'Different intent' })).code).toBe('MESSAGING_INTENT_CONFLICT');
    expect((await f.query('messaging.messages', { actor: alice, conversationId: 'conversation-one' })).value.items).toHaveLength(25);
    expect((await f.query('messaging.messages', { actor: { ...bob, scopeId: 'tenant:foreign' }, conversationId: 'conversation-one' })).code).toBe('MESSAGING_NOT_FOUND');
    expect((await f.command('messaging.conversation.read', { actor: bob, id: 'conversation-one', throughSequence: 20, requestId: 'read-20' })).value.throughSequence).toBe(20);
    expect((await f.command('messaging.conversation.read', { actor: bob, id: 'conversation-one', throughSequence: 5, requestId: 'read-5' })).value.throughSequence).toBe(20);
    expect((await f.query('messaging.conversation', { actor: bob, id: 'conversation-one' })).value.unreadCount).toBe(5);
    expect((await f.query('messaging.conversation', { actor: alice, id: 'conversation-one' })).value.unreadCount).toBe(0);
  } finally { await f.close(); }
}, 30000);

test('contact acceptance, independent blocks and hidden cross-scope directories enforce new-chat and send admission', async () => {
  const f = await fixture();
  const contact = (actor: typeof alice, action: string, userId: string, requestId: string, expectedRevision?: number) => f.command('messaging.contact', { actor, action, userId, requestId, ...(expectedRevision === undefined ? {} : { expectedRevision }) });
  try {
    expect((await f.command('messaging.conversation.create', create(alice, true))).code).toBe('MESSAGING_CONTACT_REQUIRED');
    expect((await contact(alice, 'request', bob.id, 'request-contact')).value.state).toBe('pending');
    expect((await contact(alice, 'accept', bob.id, 'self-accept', 1)).code).toBe('MESSAGING_FORBIDDEN');
    expect((await contact(bob, 'accept', alice.id, 'accept-contact', 1)).value.state).toBe('accepted');
    expect((await f.command('messaging.conversation.create', create(alice, true))).ok).toBe(true);
    await contact(alice, 'block', bob.id, 'alice-block'); await contact(bob, 'block', alice.id, 'bob-block');
    await contact(alice, 'unblock', bob.id, 'alice-unblock');
    expect((await f.command('messaging.message.send', send(1))).code).toBe('MESSAGING_BLOCKED');
    await contact(bob, 'unblock', alice.id, 'bob-unblock');
    expect((await f.command('messaging.message.send', send(1))).ok).toBe(true);
    expect((await f.query('messaging.contacts', { actor: { ...alice, scopeId: 'tenant:foreign' } })).value.items).toEqual([]);
  } finally { await f.close(); }
}, 30000);

test('new-member history boundary, author-only edits, reaction identity and revocation hold in the canonical transaction', async () => {
  const f = await fixture();
  try {
    await f.command('messaging.conversation.create', create()); await f.command('messaging.message.send', send(1));
    await f.command('messaging.conversation.change', { actor: alice, id: 'conversation-one', requestId: 'add-carol', expectedRevision: 1, action: 'add', value: carol.id, contactsOnly: false, history: 'since-join', maxParticipants: 100 });
    expect((await f.query('messaging.messages', { actor: carol, conversationId: 'conversation-one' })).value.items).toEqual([]);
    await f.command('messaging.message.send', send(2));
    expect((await f.query('messaging.messages', { actor: carol, conversationId: 'conversation-one' })).value.items.map((row: any) => row.id)).toEqual(['message-2']);
    const change = { actor: alice, conversationId: 'conversation-one', id: 'message-2', requestId: 'edit-2', expectedRevision: 1, text: 'Synthetic edited message', maxMessageLength: 20000, action: 'edit' };
    expect((await f.command('messaging.message.change', { ...change, actor: bob })).code).toBe('MESSAGING_FORBIDDEN');
    expect((await f.command('messaging.message.change', change)).value.revision).toBe(2);
    expect((await f.command('messaging.message.change', { ...change, requestId: 'stale-edit' })).code).toBe('MESSAGING_REVISION_CONFLICT');
    const reaction = { actor: bob, conversationId: 'conversation-one', id: 'message-2', requestId: 'react-2', emoji: '👍', selected: true };
    await f.command('messaging.message.react', reaction); await f.command('messaging.message.react', reaction);
    expect((await f.query('messaging.messages', { actor: bob, conversationId: 'conversation-one' })).value.items[0].reactions).toEqual([{ emoji: '👍', count: 1, selected: true }]);
    await f.command('messaging.conversation.change', { actor: alice, id: 'conversation-one', requestId: 'remove-carol', expectedRevision: 2, action: 'remove', value: carol.id });
    expect((await f.query('messaging.messages', { actor: carol, conversationId: 'conversation-one' })).code).toBe('MESSAGING_NOT_FOUND');
    expect((await f.command('messaging.message.send', send(3, carol))).code).toBe('MESSAGING_NOT_FOUND');
  } finally { await f.close(); }
}, 30000);

test('support claims fence ownership and private notes never alter customer history, search, counts or timeline', async () => {
  const f = await fixture();
  try {
    await f.command('messaging.support.open', { actor: customer, id: 'conversation-one', requestId: 'support-one', title: '', owner: 'assistant', channelId: null });
    expect((await f.query('messaging.conversation', { actor: staff, id: 'conversation-one' })).code).toBe('MESSAGING_NOT_FOUND');
    const queue = await f.query('messaging.support.queue', { actor: staff });
    expect(queue.value.items[0]).toMatchObject({ id: 'conversation-one', ownerEpoch: 1 });
    const competing = await Promise.all([f.command('messaging.support.claim', { actor: staff, id: 'conversation-one', requestId: 'claim-one', expectedEpoch: 1, maxParticipants: 100 }),
      f.command('messaging.support.claim', { actor: { ...staff, id: 'staff-two' }, id: 'conversation-one', requestId: 'claim-two', expectedEpoch: 1, maxParticipants: 100 })]);
    expect(competing.filter(row => row.ok)).toHaveLength(1);
    const winner = competing[0].ok ? staff : { ...staff, id: 'staff-two' };
    await f.command('messaging.message.send', { ...send(1, winner), text: 'A public response', expectedOwnerEpoch: 2 });
    const before = (await f.query('messaging.conversation', { actor: customer, id: 'conversation-one' })).value;
    await f.command('messaging.message.send', { ...send(2, winner), visibility: 'staff', text: 'Synthetic private note orchid' });
    const after = (await f.query('messaging.conversation', { actor: customer, id: 'conversation-one' })).value;
    expect(after).toEqual(before);
    expect((await f.query('messaging.messages', { actor: customer, conversationId: 'conversation-one', query: { search: 'orchid' } })).value.items).toEqual([]);
    expect((await f.query('messaging.messages', { actor: winner, conversationId: 'conversation-one', query: { search: 'orchid' } })).value.items).toHaveLength(1);
    await f.command('messaging.message.send', { ...send(3, winner), expectedOwnerEpoch: 2 });
    expect((await f.query('messaging.messages', { actor: customer, conversationId: 'conversation-one' })).value.items.map((row: any) => row.sequence)).toEqual([2, 1]);
    expect((await f.command('messaging.message.send', { ...send(4, customer), visibility: 'staff' })).code).toBe('MESSAGING_INPUT_INVALID');
    expect((await f.query('messaging.messages', { actor: { ...winner, staff: false }, conversationId: 'conversation-one' })).code).toBe('MESSAGING_NOT_FOUND');
  } finally { await f.close(); }
}, 30000);

test('a removed member can reconcile its own accepted operation without regaining text, attachments or another actor receipt', async () => {
  const f = await fixture();
  try {
    await f.command('messaging.conversation.create', create()); await f.command('messaging.message.send', send(1, bob));
    await f.command('messaging.conversation.change', { actor: alice, id: 'conversation-one', requestId: 'remove-bob', expectedRevision: 1, action: 'remove', value: bob.id });
    expect((await f.query('messaging.messages', { actor: bob, conversationId: 'conversation-one' })).code).toBe('MESSAGING_NOT_FOUND');
    const receipt = (await f.query('messaging.receipt', { actor: bob, requestId: 'send-1' })).value;
    expect(receipt).toEqual({ requestId: 'send-1', operation: 'message.send', resourceId: 'message-1', acceptedAt: expect.any(Number) });
    expect(JSON.stringify(receipt)).not.toContain('Synthetic');
    expect((await f.query('messaging.receipt', { actor: alice, requestId: 'send-1' })).value).toBeNull();
    expect((await f.query('messaging.receipt', { actor: { ...bob, scopeId: 'tenant:foreign' }, requestId: 'send-1' })).value).toBeNull();
  } finally { await f.close(); }
}, 30000);
