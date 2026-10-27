/** Real private file/WAL actor protocol. No real provider calls, app identities, production state or fake final acknowledgments. */
import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { applicationServiceDataScope } from '../auth/service-data-scope';
import { installAuthAuthorityRevision } from '../auth/auth-authority-revision';
import { AuthorityCommitCoordinator } from '../databases/authority-commit-coordinator';
import { DatabaseActorAuthorityContext } from '../databases/database-actor-authority-context';
import { createReactiveDB } from '../sync/reactive-db';
import { resolveMessagingConfig } from './config';
import { MessagingRuntime } from './runtime';
import type { MessagingJobContext } from './job-execution';
import type { MessagingJobRow } from './job-model';

const customer = { scopeId: 'application', id: 'customer-one', kind: 'user', staff: false }, staff = { ...customer, id: 'staff-one', staff: true };
const scope = applicationServiceDataScope(), policy = 'a'.repeat(64), guard = () => {};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'messaging-jobs-')), path = join(root, 'system.db');
  const system = createReactiveDB({ mode: 'file', path }); installAuthAuthorityRevision(system);
  const authority = new AuthorityCommitCoordinator(), actors = new DatabaseActorAuthorityContext(system, path), config = resolveMessagingConfig({ rootDirectory: 'messages' }, root, resolveAuthBehaviorConfig());
  if (!config) throw new Error('Synthetic jobs config is unavailable.');
  const options = { system, config, installAllowed: true, authority: { coordinator: authority, actorContext: actors }, observability: { config: { enabled: false }, store: null, sink: { emit() {} } } };
  let runtime = await MessagingRuntime.open(options);
  const command = (name: string, input: object) => runtime.write<Record<string, unknown>>(scope, name, input, crypto.randomUUID(), guard);
  const context = (id: string) => runtime.read<MessagingJobContext>(scope, 'messaging.job.context', { scopeId: 'application', id }, guard);
  const pending = () => runtime.read<MessagingJobRow[]>(scope, 'messaging.jobs.pending', { scopeId: 'application' }, guard);
  const send = (id: string, extra: object = {}) => command('messaging.message.send', { actor: customer, conversationId: 'support-one', id, requestId: id, text: 'Synthetic customer turn ' + id, assistantEnabled: true, assistantPolicy: policy, maxMessageLength: 20000, ...extra });
  await command('messaging.support.open', { actor: customer, id: 'support-one', requestId: 'open', title: '', owner: 'assistant', channelId: null });
  return { command, context, pending, send, get runtime() { return runtime; }, async restart() { await runtime.close(); runtime = await MessagingRuntime.open({ ...options, installAllowed: false }); },
    async close() { await runtime.close(); await authority.close(); system.dispose(); } };
}
const claim = (id: string, nonce: string) => ({ scopeId: 'application', id, nonce, policyHash: policy, leaseMs: 30000 });
const ref = (id: string, nonce: string) => ({ scopeId: 'application', id, nonce });

test('a received private result resumes after restart without another invocation and publishes one canonical assistant reply', async () => {
  const f = await fixture();
  try {
    await f.send('turn-one'); const job = (await f.pending())[0]!;
    expect(await f.command('messaging.job.claim', claim(job.id, 'attempt-one'))).toEqual({ state: 'claimed' });
    expect(await f.command('messaging.job.call', ref(job.id, 'attempt-one'))).toEqual({ state: 'calling' });
    expect(await f.command('messaging.job.receive', { ...ref(job.id, 'attempt-one'), text: 'Synthetic saved assistant answer', providerId: 'provider-one', maxMessageLength: 20000 })).toEqual({ state: 'received' });
    await f.restart(); expect(await f.command('messaging.job.claim', claim(job.id, 'attempt-two'))).toEqual({ state: 'received' });
    expect((await f.context(job.id)).result?.text).toBe('Synthetic saved assistant answer');
    expect(await f.command('messaging.job.publish', { ...ref(job.id, 'attempt-two'), notificationsEnabled: false })).toEqual({ state: 'accepted' });
    expect(await f.command('messaging.job.publish', { ...ref(job.id, 'attempt-two'), notificationsEnabled: false })).toEqual({ state: 'accepted' });
    const page = await f.runtime.read<{ items: { text: string; authorKind: string }[] }>(scope, 'messaging.messages', { actor: customer, conversationId: 'support-one' }, guard);
    expect(page.items.map(row => row.authorKind)).toEqual(['assistant', 'user']); expect(page.items[0]!.text).toBe('Synthetic saved assistant answer');
    expect((await f.context(job.id)).job.attempts).toBe(1);
  } finally { await f.close(); }
}, 30000);

test('a crash after invocation admission becomes review/triage rather than a second call', async () => {
  const f = await fixture();
  try {
    await f.send('turn-one'); const first = (await f.pending())[0]!;
    await f.command('messaging.job.claim', claim(first.id, 'attempt-one')); await f.command('messaging.job.call', ref(first.id, 'attempt-one'));
    await f.restart(); expect(await f.command('messaging.job.claim', claim(first.id, 'after-restart'))).toEqual({ state: 'needs-review' });
    expect((await f.context(first.id)).job).toMatchObject({ attempts: 1, state: 'needs-review', error_code: 'INVOCATION_UNKNOWN' });
    expect(await f.runtime.read(scope, 'messaging.conversation', { actor: customer, id: 'support-one' }, guard)).toMatchObject({ owner: 'triage' });
    await expect(f.command('messaging.job.call', ref(first.id, 'after-restart'))).rejects.toMatchObject({ code: 'MESSAGING_JOB_CONFLICT' });
  } finally { await f.close(); }
}, 30000);

test('policy drift requires review before any invocation and cannot silently select a different model', async () => {
  const f = await fixture();
  try {
    await f.send('turn-one'); const job = (await f.pending())[0]!;
    expect(await f.command('messaging.job.claim', { ...claim(job.id, 'policy-changed'), policyHash: 'b'.repeat(64) })).toEqual({ state: 'needs-review' });
    expect((await f.context(job.id)).job).toMatchObject({ attempts: 0, error_code: 'POLICY_CHANGED', state: 'needs-review' });
    expect(await f.runtime.read(scope, 'messaging.conversation', { actor: customer, id: 'support-one' }, guard)).toMatchObject({ owner: 'triage' });
  } finally { await f.close(); }
}, 30000);

test('new turns, edits, deletions and human takeover fence old answers; staff notes never enter or invalidate the public model context', async () => {
  const f = await fixture();
  try {
    await f.send('turn-one'); const first = (await f.pending())[0]!;
    await f.command('messaging.job.claim', claim(first.id, 'first')); await f.command('messaging.job.call', ref(first.id, 'first'));
    await f.send('turn-two');
    expect(await f.command('messaging.job.receive', { ...ref(first.id, 'first'), text: 'Obsolete synthetic answer', providerId: null, maxMessageLength: 20000 })).toEqual({ state: 'cancelled' });
    const second = (await f.pending()).find(job => job.message_id === 'turn-two')!;
    await f.command('messaging.job.claim', claim(second.id, 'second'));
    await f.command('messaging.message.change', { actor: customer, conversationId: 'support-one', id: 'turn-two', requestId: 'edit-turn', expectedRevision: 1, text: 'Synthetic revised customer turn', action: 'edit', maxMessageLength: 20000, assistantPolicy: policy });
    expect(await f.command('messaging.job.call', ref(second.id, 'second'))).toEqual({ state: 'cancelled' });
    const edited = (await f.pending()).find(job => job.message_id === 'turn-two')!;
    expect(edited.id).not.toBe(second.id); expect((await f.context(edited.id)).messages.at(-1)!.content).toBe('Synthetic revised customer turn');
    await f.command('messaging.support.claim', { actor: staff, id: 'support-one', requestId: 'takeover', expectedEpoch: 1, maxParticipants: 100 });
    expect(await f.command('messaging.job.claim', claim(edited.id, 'third'))).toEqual({ state: 'cancelled' });
    await f.command('messaging.message.send', { actor: staff, conversationId: 'support-one', id: 'private-note', requestId: 'note', text: 'PRIVATE_SYNTHETIC_NOTE_NOT_FOR_MODEL', visibility: 'staff', maxMessageLength: 20000 });
    await f.command('messaging.conversation.owner', { actor: staff, id: 'support-one', requestId: 'hand-back', expectedEpoch: 2, owner: 'assistant', assistantPolicy: policy });
    const returned = (await f.pending()).find(job => job.state === 'pending')!;
    expect((await f.context(returned.id)).messages.some(row => row.content.includes('PRIVATE_SYNTHETIC_NOTE'))).toBe(false);
    await f.command('messaging.message.change', { actor: customer, conversationId: 'support-one', id: 'turn-two', requestId: 'delete-turn', expectedRevision: 2, action: 'remove', maxMessageLength: 20000, assistantPolicy: policy });
    expect(await f.command('messaging.job.claim', claim(returned.id, 'fourth'))).toEqual({ state: 'cancelled' });
  } finally { await f.close(); }
}, 30000);
