/** End-to-end managed Guardian, native HTTP, SDK, private Fabric/logging actors and restart. Only disposable synthetic identities. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../frontend/server/app-factory';
import { createClient } from '../frontend/client/sdk';
import type { Client, FetchInit } from '../frontend/client/sdk';
import { createMessagingClient } from '../frontend/client/messaging-client';
import { createLoggingClient } from '../frontend/client/logging-client';
import { MemoryEventStore } from '../observability/memory-event-store';
import type { AppConfig } from '../frontend/server/types';
import { defineEndpoint, defineZeroPlugin } from '../frontend/server/server-extensions';
import type { ServerRouteServices } from '../frontend/server/server-services';
import { messagingTypingSocket } from './test-support/typing-socket';
import { messagingTypingRoom } from './typing-topic';
import { applicationServiceDataScope } from '../auth/service-data-scope';
const PASSWORD = 'Synthetic-messaging-password-123';
type TestClient = Pick<Client, 'register' | 'login' | 'messaging' | 'logging' | 'fetch' | 'disconnect' | 'user'>;
/** Another actual native HTTP identity, not a second forbidden global browser Client singleton. */
function peer(origin: string): TestClient {
  let token: string | null = null, user: Client['user'] = null;
  const call = async <T>(path: string, init: FetchInit = {}): Promise<T> => {
    const headers = new Headers(init.headers as HeadersInit); if (token) headers.set('Authorization', 'Bearer ' + token);
    const body = init.body === undefined ? undefined : JSON.stringify(init.body); if (body !== undefined) headers.set('Content-Type', 'application/json');
    const response = await fetch(origin + path, { method: init.method, body, signal: init.signal, headers });
    if (!response.ok) { const failure = await response.json() as { code?: string }; throw Object.assign(new Error('Synthetic peer HTTP request was rejected.'), { status: response.status, code: failure.code }); }
    return init.json === false ? response as T : await response.json() as T;
  };
  const messaging = createMessagingClient(call, async (path, init) => { const headers = new Headers(init.headers); if (token) headers.set('Authorization', 'Bearer ' + token); return fetch(origin + path, { ...init, headers }); }), logging = createLoggingClient(call);
  const authenticate = async (path: string, body: unknown) => { const result = await call<any>(path, { method: 'POST', body }); token = result.accessToken; user = result.user; return result; };
  return { messaging, logging, fetch: call, get user() { return user; }, register: input => authenticate('/auth/register', input), login: (username, password) => authenticate('/auth/login', { username, password }), disconnect() { messaging.clear(); logging.clear(); token = null; user = null; } };
}
async function fixture(compliance = false, history: 'all' | 'since-join' = 'all', providerBaseURL?: string, notifications = false, overrides: Pick<Partial<AppConfig>, 'messaging' | 'auth'> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'zero-messaging-managed-')); await mkdir(join(root, 'app'));
  let zero!: ServerRouteServices;
  const diagnostics = new MemoryEventStore();
  const configuration: AppConfig = { projectRoot: root, db: { mode: 'file', path: join(root, 'app.db'), synchronous: 'FULL' }, systemDb: { mode: 'file', path: join(root, 'system.db'), synchronous: 'FULL' }, tables: {},
    auth: { bootstrap: 'public' }, messaging: { support: {}, history, ...(notifications ? { notifications: { path: '/app/messages' } } : {}),
      ...(providerBaseURL ? { assistant: { model: 'synthetic/chat', timeoutMs: 30000 }, jobs: { concurrency: 2 } } : {}) }, logging: { preset: compliance ? 'compliance' : 'detailed', rootDirectory: join(root, 'logs') },
    appDir: join(root, 'app'), outDir: join(root, 'out'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
    themeFoundation: 'legacy', frontendBuild: { version: 1, frontend: { themeFoundation: 'legacy', plugins: {} }, pluginIdentities: {} },
    workflows: providerBaseURL || notifications ? {} : false, email: false,
    ai: providerBaseURL ? { autoDetect: false, providers: { synthetic: { type: 'openai-compatible', apiKey: 'synthetic-local-key', baseURL: providerBaseURL } } } : false,
    vector: false, pdf: false, kv: false, stateSync: false, observability: { console: false, endpoint: false, store: diagnostics },
    serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false,
    serverExtensions: [defineZeroPlugin({ name: 'messaging-fixture', setup(context) { zero = context.zero; } }), defineEndpoint({ method: 'GET', path: '/proof/messaging', auth: 'user', handler: ({ zero }) => zero.messaging!.capabilities() })],
    ...overrides,
  };
  let app = await createApp(configuration); const listen = () => { app.listen({ hostname: '127.0.0.1', port: 0 }); return 'http://127.0.0.1:' + app.server!.port; }; let origin = listen();
  const client = () => createClient({ url: origin, auth: true, autoConnect: false });
  return { root, diagnostics, configuration, client, peer: () => peer(origin), get zero() { return zero; }, get origin() { return origin; }, async restart() { await app.stop(true); app = await createApp(configuration); origin = listen(); }, async close() { await app.stop(true); } };
}
async function enroll(client: TestClient, name: string) {
  await client.register({ username: name, email: name + '@example.test', password: PASSWORD });
  const policy = await client.logging.collectionPolicy(); if (policy.delivery) await client.logging.observe([], { policyVersion: policy.delivery.policyVersion });
}

test('Guardian availability and messaging share native sockets without confusing presence, typing, membership or read receipts', async () => {
  const f = await fixture(false, 'all', undefined, false, { auth: { bootstrap: 'public', presence: { enabled: true } }, messaging: { support: false } });
  const alice = f.client(), bob = f.peer(), outsider = f.peer(), sockets: Awaited<ReturnType<typeof messagingTypingSocket>>[] = [];
  const own = (client: TestClient) => client.fetch<{ intent: { revision: number }; observation: { status: string; connected: boolean } }>('/auth/presence/me');
  const waitForStatus = async (status: string) => {
    const deadline = Date.now() + 5000;
    while ((await own(bob)).observation.status !== status) { if (Date.now() >= deadline) throw new Error('Native presence status deadline.'); await Bun.sleep(10); }
  };
  try {
    await enroll(alice, 'presence-alice'); await enroll(bob, 'presence-bob'); await enroll(outsider, 'presence-outsider');
    const login = await bob.login('presence-bob', PASSWORD);
    if (!('accessToken' in login)) throw new Error('Synthetic presence sign-in did not complete.');
    const first = await messagingTypingSocket(f.origin, login.accessToken), second = await messagingTypingSocket(f.origin, login.accessToken);
    sockets.push(first, second);
    const activity = (socket: typeof first, sequence: number) => socket.send({ type: 'ephemeral.set', topic: 'guardian:presence', key: 'self', value: { sequence, activity: true, visible: true } });
    activity(first, 1); activity(second, 1); await waitForStatus('available');
    const conversation = await alice.messaging.conversations.create({ kind: 'group', userIds: [bob.user!.userId] }, { requestId: 'presence-group' });
    await alice.messaging.messages.send(conversation.id, { text: 'Unread synthetic message' }, { requestId: 'presence-unread' });
    const topic = 'typing:' + messagingTypingRoom(conversation.id), key = 'user:' + bob.user!.userId + ':session:presence01';
    second.send({ type: 'ephemeral.subscribe', topic }); await second.wait(message => message.type === 'ephemeral.snapshot' && message.topic === topic);
    second.send({ type: 'ephemeral.set', topic, key, value: { userId: bob.user!.userId, label: 'Synthetic teammate', since: 1, updatedAt: 1 }, ttl: 5000 });
    expect(await second.wait(message => message.type === 'ephemeral.change' && message.key === key && message.op === 'set'
      || message.type === 'ephemeral.error' && message.key === key)).toMatchObject({ type: 'ephemeral.change', op: 'set' });
    const revision = (await own(bob)).intent.revision;
    expect(await bob.fetch('/auth/presence/me', { method: 'PATCH', body: { status: 'busy', expectedRevision: revision } })).toMatchObject({ observation: { status: 'busy' } });
    await bob.fetch('/auth/presence/config'); activity(first, 2); activity(second, 2); await waitForStatus('busy');
    expect(first.messages.some(message => message.type === 'ephemeral.error' && message.topic === 'guardian:presence')).toBe(false);
    await first.close(); expect((await own(bob)).observation).toMatchObject({ status: 'busy', connected: true });
    expect((await outsider.fetch<{ items: { userId: string; status: string }[] }>('/auth/presence')).items)
      .toContainEqual(expect.objectContaining({ userId: bob.user!.userId, status: 'busy' })); // Same-scope directory is the documented presence policy.
    await expect(outsider.messaging.conversations.get(conversation.id)).rejects.toMatchObject({ status: 404 });
    expect((await bob.messaging.conversations.get(conversation.id)).unreadCount).toBe(1);
    await second.close(); await waitForStatus('offline');
    expect((await bob.messaging.conversations.get(conversation.id)).unreadCount).toBe(1);
  } finally { await Promise.all(sockets.map(socket => socket.close())); alice.disconnect(); bob.disconnect(); outsider.disconnect(); await f.close(); }
}, 90000);

test('internal named assistants work without support, preserve distinct identities and fence a real held response after trusted-property revocation', async () => {
  let release!: () => void, entered = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const input = await request.json(), knowledge = JSON.stringify(input).includes('PRIVATE_KNOWLEDGE_POLICY');
    entered++; if (knowledge) await held;
    return Response.json({ id: knowledge ? 'synthetic-knowledge' : 'synthetic-writing', object: 'chat.completion', created: 1, model: 'chat',
      choices: [{ index: 0, message: { role: 'assistant', content: knowledge ? 'REVOKED_PRIVATE_ANSWER' : 'SYNTHETIC_WRITING_ANSWER' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
  } });
  const f = await fixture(false, 'all', 'http://127.0.0.1:' + provider.port + '/v1', false, {
    auth: { bootstrap: 'public', userProperties: { department: { editableBy: 'admin', useInPolicies: true } } },
    messaging: { support: false, assistants: {
      knowledge: { name: 'Knowledge', model: 'synthetic/chat', instructions: 'PRIVATE_KNOWLEDGE_POLICY', access: { properties: { department: 'clinical' } } },
      writing: { name: 'Writing', model: 'synthetic/chat', instructions: 'PRIVATE_WRITING_POLICY' },
    }, jobs: { concurrency: 2 } },
  }), admin = f.client(), user = f.peer();
  const until = async (ready: () => Promise<boolean>) => { const deadline = Date.now() + 12000; while (!await ready()) { if (Date.now() >= deadline) throw new Error('Synthetic assistant progress deadline.'); await Bun.sleep(40); } };
  const setDepartment = (value: string) => admin.fetch('/auth/admin/users/' + user.user!.userId + '/properties/department', { method: 'PUT', body: { value } });
  try {
    await enroll(admin, 'internal-admin'); await enroll(user, 'internal-user');
    expect((await user.messaging.assistants.list()).items.map(row => row.id)).toEqual(['writing']);
    await expect(user.messaging.assistants.open('knowledge', {}, { requestId: 'forbidden-bot' })).rejects.toMatchObject({ status: 404 });
    await expect(user.messaging.support.open({}, { requestId: 'support-disabled' })).rejects.toMatchObject({ status: 403 });
    await setDepartment('clinical'); await user.login('internal-user', PASSWORD);
    const directory = await user.messaging.assistants.list();
    expect(directory.items.map(row => row.id)).toEqual(['knowledge', 'writing']); expect(JSON.stringify(directory)).not.toContain('PRIVATE_');
    const knowledge = await user.messaging.assistants.open('knowledge', {}, { requestId: 'open-knowledge' });
    const writing = await user.messaging.assistants.open('writing', {}, { requestId: 'open-writing' });
    expect(knowledge).toMatchObject({ kind: 'assistant', assistantId: 'knowledge', owner: 'assistant' });
    expect(knowledge.participants).toContainEqual(expect.objectContaining({ id: 'assistant:knowledge', kind: 'assistant' }));
    expect(knowledge.participants.some(row => row.role === 'customer')).toBe(false);
    expect((await user.messaging.assistants.open('writing', {}, { requestId: 'open-writing' })).id).toBe(writing.id);
    await expect(admin.messaging.conversations.get(knowledge.id)).rejects.toMatchObject({ status: 404 });
    await user.messaging.messages.send(knowledge.id, { text: 'Synthetic knowledge request' }, { requestId: 'knowledge-turn' });
    await user.messaging.messages.send(writing.id, { text: 'Synthetic writing request' }, { requestId: 'writing-turn' });
    await until(async () => (await user.messaging.messages.list(writing.id)).items.some(row => row.authorId === 'assistant:writing'));
    expect(entered).toBe(2); // Writing completed while Knowledge's real provider call is still held.
    await setDepartment('other');
    release();
    // Internal queue inspection establishes settlement; it is not used as an
    // HTTP authorization proof or to grant an administrator transcript access.
    await until(async () => (await f.zero.messaging!.runtime.read<any[]>(applicationServiceDataScope(), 'messaging.jobs.pending', { scopeId: 'application' }, () => {})).length === 0);
    await user.login('internal-user', PASSWORD);
    expect((await user.messaging.assistants.list()).items.map(row => row.id)).toEqual(['writing']);
    expect((await user.messaging.conversations.list()).items.map(row => row.id)).toEqual([writing.id]);
    await expect(user.messaging.conversations.get(knowledge.id)).rejects.toMatchObject({ status: 404 });
    await expect(user.messaging.messages.list(knowledge.id)).rejects.toMatchObject({ status: 404 });
    await expect(user.messaging.assistants.open('knowledge', {}, { requestId: 'open-knowledge' })).rejects.toMatchObject({ status: 404 });
    await setDepartment('clinical'); await user.login('internal-user', PASSWORD);
    expect((await user.messaging.messages.list(knowledge.id)).items.every(row => row.authorKind !== 'assistant')).toBe(true);
    const review = await user.messaging.review.list(knowledge.id);
    expect(review.items).toHaveLength(1); // The bot's human owner needs no support role to inspect recovery.
    const failed = await user.messaging.review.get(knowledge.id, review.items[0]!.id), current = await user.messaging.conversations.get(knowledge.id);
    await expect(user.messaging.review.retry(knowledge.id, failed.id, current.ownerEpoch, false as true, { requestId: 'internal-no-duplicate-ack' })).rejects.toMatchObject({ status: 422 });
    const retryOptions = { requestId: 'internal-explicit-retry' };
    const retried = await user.messaging.review.retry(knowledge.id, failed.id, current.ownerEpoch, true, retryOptions);
    expect(await user.messaging.review.retry(knowledge.id, failed.id, current.ownerEpoch, true, retryOptions)).toEqual(retried);
    await until(async () => (await user.messaging.messages.list(knowledge.id)).items.some(row => row.authorId === 'assistant:knowledge'));
    expect(entered).toBe(3);
    const retained = await user.messaging.review.get(knowledge.id, failed.id);
    expect(retained.reason).toBe(failed.reason); expect(retained.history).toEqual(failed.history); expect(retained.resolution).toEqual(retried);
    await f.zero.logging!.flush();
    const evidence = await admin.logging.page('audit', { family: 'communications' });
    expect(JSON.stringify(evidence)).not.toContain('PRIVATE_KNOWLEDGE_POLICY');
    expect(JSON.stringify(evidence)).not.toContain('SYNTHETIC_WRITING_ANSWER');
  } finally { release(); admin.disconnect(); user.disconnect(); await f.close(); await provider.stop(true); }
}, 90000);

test('native messaging uses current identity, persists accepted messages/reactions/receipts and retains safe source evidence through restart', async () => {
  const f = await fixture(); let alice = f.client(), bob = f.peer();
  try {
    await enroll(alice, 'message-alice'); await enroll(bob, 'message-bob');
    const bobId = bob.user!.userId;
    expect(await alice.fetch('/proof/messaging')).toMatchObject({ enabled: true, canSupport: true });
    const directory = await alice.messaging.directory({ search: 'message-bob' });
    expect(directory.items.map(row => row.id)).toEqual([bobId]); expect(JSON.stringify(directory)).not.toContain('@example.test');
    const created = await alice.messaging.conversations.create({ userIds: [bobId] }, { requestId: 'create-one' }).catch(async error => {
      const receipt = await alice.messaging.receipt('create-one');
      if (receipt?.resourceId) await alice.messaging.conversations.get(receipt.resourceId).catch(failure => { console.info('Synthetic messaging projection failure', { status: failure.status, code: failure.body?.code }); throw failure; });
      throw error;
    });
    expect(created.kind).toBe('direct');
    const sent = await alice.messaging.messages.send(created.id, { text: 'Private synthetic orchid' }, { requestId: 'send-one' });
    expect((await bob.messaging.messages.list(created.id, { search: 'orchid' })).items[0]?.id).toBe(sent.id);
    expect((await alice.messaging.messages.send(created.id, { text: 'Private synthetic orchid' }, { requestId: 'send-one' })).id).toBe(sent.id);
    expect((await bob.messaging.conversations.get(created.id)).unreadCount).toBe(1);
    expect((await bob.messaging.messages.react(created.id, sent.id, '👍', true, { requestId: 'react-one' })).reactions).toEqual([{ emoji: '👍', count: 1, selected: true }]);
    expect(await bob.messaging.conversations.markRead(created.id, sent.sequence, { requestId: 'read-one' })).toEqual({ throughSequence: 1, unreadCount: 0 });
    await expect(bob.messaging.messages.edit(created.id, sent.id, sent.revision, 'Forbidden edit', { requestId: 'edit-other' })).rejects.toBeDefined();
    await expect(alice.fetch('/api/messaging/conversations', { method: 'POST', headers: { 'Idempotency-Key': 'forged' }, body: { userIds: [bobId], actor: { staff: true } } })).rejects.toBeDefined();
    await expect(alice.fetch('/api/messaging/conversations', { method: 'POST', body: { userIds: [bobId] } })).rejects.toBeDefined();
    await f.zero.logging!.flush();
    const audit = await f.zero.logging!.page('audit', { kind: 'platform' }, { family: 'records', actorId: alice.user!.userId });
    expect(audit.events.length).toBeGreaterThan(0); expect(JSON.stringify(audit)).not.toContain('Private synthetic orchid');
    const reads = await alice.logging.page('audit', { family: 'communications', actorId: bobId, action: 'messaging.history.prepared' });
    expect(reads.events.some(row => row.event.target?.id === created.id && row.event.outcome === 'succeeded' && row.event.evidence === 'server-confirmed')).toBe(true);
    expect(JSON.stringify(reads)).not.toContain('orchid');
    alice.disconnect(); bob.disconnect(); await f.restart(); alice = f.client(); bob = f.peer();
    await alice.login('message-alice', PASSWORD); await bob.login('message-bob', PASSWORD);
    expect((await bob.messaging.messages.list(created.id)).items[0]!.id).toBe(sent.id);
    expect((await bob.messaging.conversations.get(created.id)).unreadCount).toBe(0);
    expect(await alice.messaging.receipt('send-one')).toMatchObject({ requestId: 'send-one', resourceId: sent.id });
  } finally { for (const event of f.diagnostics.query({ limit: 1000 }).events.filter(event => event.code === 'messaging.operation.rejected' || event.code.includes('executor.failed'))) console.info('Synthetic messaging storage outcome', event.metadata); alice.disconnect(); bob.disconnect(); await f.close(); }
}, 90000);

test('configured groups reconcile trusted properties without contact requests, revoke access, rejoin safely and preserve manual group ownership transfer', async () => {
  const f = await fixture(false, 'all', undefined, false, {
    auth: { bootstrap: 'public', userProperties: { department: { editableBy: 'admin', useInPolicies: true } } },
    messaging: { directory: 'contacts', support: false, groups: { team: { name: 'Team' }, clinical: { name: 'Clinical', members: { properties: { department: 'clinical' } }, history: 'since-join' } } },
  });
  const admin = f.client(), user = f.peer();
  const setDepartment = (id: string, value: string) => admin.fetch('/auth/admin/users/' + id + '/properties/department', { method: 'PUT', body: { value } });
  try {
    await enroll(admin, 'group-admin'); await enroll(user, 'group-user');
    const adminId = admin.user!.userId, userId = user.user!.userId;
    const team = (await user.messaging.conversations.list()).items.find(row => row.managedGroupId === 'team')!;
    expect(team.participants.map(row => row.id).sort()).toEqual([adminId, userId].sort());
    expect((await user.messaging.contacts.list()).items).toEqual([]);
    await user.messaging.messages.send(team.id, { text: 'Synthetic team message without a contact request.' }, { requestId: 'team-send' });
    expect((await admin.messaging.messages.list(team.id)).items).toHaveLength(1);
    await expect(user.messaging.conversations.removeParticipant(team.id, team.revision, userId, { requestId: 'cannot-edit-policy' })).rejects.toMatchObject({ status: 403 });
    await setDepartment(userId, 'clinical'); await user.login('group-user', PASSWORD);
    const clinical = (await user.messaging.conversations.list()).items.find(row => row.managedGroupId === 'clinical')!;
    expect(clinical.participants.map(row => row.id)).toEqual([userId]);
    await expect(admin.messaging.conversations.get(clinical.id)).rejects.toMatchObject({ status: 404 });
    const bytes = new TextEncoder().encode('Synthetic group attachment'), checksum = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    const attachment = await user.messaging.attachments.allocate(clinical.id, { fileName: 'synthetic-group.txt', mimeType: 'text/plain', sizeBytes: bytes.byteLength, checksum }, { requestId: 'clinical-file' });
    await user.messaging.attachments.upload(clinical.id, attachment.id, bytes, { requestId: 'clinical-file-bytes' });
    await user.messaging.messages.send(clinical.id, { text: 'Synthetic earlier clinical message.', attachmentIds: [attachment.id] }, { requestId: 'clinical-before' });
    await setDepartment(adminId, 'clinical'); await admin.login('group-admin', PASSWORD);
    await admin.messaging.conversations.get(clinical.id);
    let invalidations = 0;
    const detach = f.zero.messaging!.runtime.subscribe(applicationServiceDataScope(), () => { invalidations++; }, { actorId: adminId, conversationId: clinical.id });
    try {
      await setDepartment(userId, 'other');
      const deadline = Date.now() + 5000;
      while (!invalidations && Date.now() < deadline) await Bun.sleep(25);
      expect(invalidations).toBeGreaterThan(0); // No list/get demand read triggered this canonical membership wake-up.
    } finally { detach(); }
    await user.login('group-user', PASSWORD);
    expect((await user.messaging.conversations.list()).items.some(row => row.id === clinical.id)).toBe(false);
    await expect(user.messaging.messages.list(clinical.id)).rejects.toMatchObject({ status: 404 });
    await expect(user.messaging.attachments.download(clinical.id, attachment.id)).rejects.toMatchObject({ status: 404 });
    await expect(user.messaging.messages.send(clinical.id, { text: 'Rejected after property removal.' }, { requestId: 'clinical-revoked' })).rejects.toMatchObject({ status: 404 });
    await admin.messaging.messages.send(clinical.id, { text: 'Synthetic message while the user was absent.' }, { requestId: 'clinical-absent' });
    // A -> B -> A must not replay an old transport acknowledgment and leave
    // canonical membership at B. Rejoining applies the configured history rule.
    await setDepartment(userId, 'clinical'); await user.login('group-user', PASSWORD);
    expect((await user.messaging.conversations.get(clinical.id)).participants.map(row => row.id).sort()).toEqual([adminId, userId].sort());
    expect((await user.messaging.messages.list(clinical.id)).items).toEqual([]);
    await expect(user.messaging.attachments.download(clinical.id, attachment.id)).rejects.toMatchObject({ status: 404 });
    await admin.messaging.messages.send(clinical.id, { text: 'Synthetic new message after rejoin.' }, { requestId: 'clinical-after' });
    expect((await user.messaging.messages.list(clinical.id)).items.map(row => row.text)).toEqual(['Synthetic new message after rejoin.']);
    const request = await admin.messaging.contacts.request(userId, { requestId: 'manual-contact' });
    await user.messaging.contacts.respond(adminId, request.revision, true, { requestId: 'manual-contact-accept' });
    const manual = await admin.messaging.conversations.create({ kind: 'group', userIds: [userId], title: 'Manual' }, { requestId: 'manual-group' });
    const transferred = await admin.messaging.conversations.transferOwnership(manual.id, manual.revision, userId, { requestId: 'manual-transfer' });
    expect(transferred.participants.find(row => row.id === userId)?.role).toBe('owner');
    await admin.messaging.conversations.removeParticipant(manual.id, transferred.revision, adminId, { requestId: 'old-owner-leave' });
    expect((await user.messaging.conversations.get(manual.id)).participants.map(row => row.id)).toEqual([userId]);
  } finally { admin.disconnect(); user.disconnect(); await f.close(); }
}, 90000);

test('multi-tenant configured groups and internal assistants use independent native scopes without cross-tenant discovery or transcript access', async () => {
  const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch() {
    return Response.json({ id: 'synthetic-scoped-reply', object: 'chat.completion', created: 1, model: 'chat',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Synthetic scoped answer.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } });
  } });
  const f = await fixture(false, 'all', 'http://127.0.0.1:' + provider.port + '/v1', false, {
    auth: { tenancy: 'multi', bootstrap: 'public', registration: { mode: 'public' } },
    messaging: { support: false, groups: { team: { name: 'Team' } }, assistants: { helper: { name: 'Helper', model: 'synthetic/chat' } } },
  }), first = f.client(), second = f.peer();
  try {
    await first.register({ username: 'tenant-messages-one', email: 'tenant-one@example.test', password: PASSWORD, organizationName: 'Synthetic one' });
    await second.register({ username: 'tenant-messages-two', email: 'tenant-two@example.test', password: PASSWORD, organizationName: 'Synthetic two' });
    expect((await first.messaging.directory()).items).toEqual([]); expect((await second.messaging.directory()).items).toEqual([]);
    const groupA = (await first.messaging.conversations.list()).items.find(row => row.managedGroupId === 'team')!;
    const groupB = (await second.messaging.conversations.list()).items.find(row => row.managedGroupId === 'team')!;
    expect(groupA.id).not.toBe(groupB.id);
    expect(groupA.participants.map(row => row.id)).toEqual([first.user!.userId]);
    expect(groupB.participants.map(row => row.id)).toEqual([second.user!.userId]);
    await expect(second.messaging.conversations.get(groupA.id)).rejects.toMatchObject({ status: 404 });
    const botA = await first.messaging.assistants.open('helper', {}, { requestId: 'same-scoped-request' });
    const botB = await second.messaging.assistants.open('helper', {}, { requestId: 'same-scoped-request' });
    expect(botA.id).not.toBe(botB.id);
    await Promise.all([first.messaging.messages.send(botA.id, { text: 'Synthetic tenant one question.' }, { requestId: 'same-scoped-turn' }),
      second.messaging.messages.send(botB.id, { text: 'Synthetic tenant two question.' }, { requestId: 'same-scoped-turn' })]);
    const deadline = Date.now() + 12000;
    for (;;) {
      const pages = await Promise.all([first.messaging.messages.list(botA.id), second.messaging.messages.list(botB.id)]);
      if (pages.every(page => page.items.some(row => row.authorId === 'assistant:helper'))) break;
      if (Date.now() >= deadline) throw new Error('Synthetic scoped assistant deadline.'); await Bun.sleep(40);
    }
    await expect(second.messaging.messages.list(botA.id)).rejects.toMatchObject({ status: 404 });
    await expect(first.messaging.conversations.create({ userIds: [second.user!.userId] }, { requestId: 'cross-tenant-contact' })).rejects.toMatchObject({ status: 404 });
    await expect(first.fetch('/api/messaging/assistants/helper/conversations', { method: 'POST', headers: { 'Idempotency-Key': 'forged-scope' }, body: { tenantId: 'foreign' } })).rejects.toMatchObject({ status: 422 });
  } finally { first.disconnect(); second.disconnect(); await f.close(); await provider.stop(true); }
}, 90000);

test('native review HTTP and SDK retain the failed attempt, require an explicit current-owner retry, and never duplicate its replacement', async () => {
  let calls = 0, release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch() {
    if (++calls === 1) return Response.json({ error: { message: 'Synthetic local provider failure.' } }, { status: 503 });
    await held;
    return Response.json({ id: 'synthetic-review-reply', object: 'chat.completion', created: 1, model: 'chat', choices: [{ index: 0, message: { role: 'assistant', content: 'Synthetic reviewed replacement answer.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } });
  } });
  const f = await fixture(false, 'all', 'http://127.0.0.1:' + provider.port + '/v1'), staff = f.client(), customer = f.peer();
  try {
    await enroll(staff, 'review-staff'); await enroll(customer, 'review-customer');
    const conversation = await customer.messaging.support.open({ title: '' }, { requestId: 'review-open' });
    await customer.messaging.messages.send(conversation.id, { text: 'Synthetic review request.' }, { requestId: 'review-customer-turn' });
    const until = Date.now() + 10000; let current = await customer.messaging.conversations.get(conversation.id);
    while (current.owner !== 'triage' && Date.now() < until) { await Bun.sleep(50); current = await customer.messaging.conversations.get(conversation.id); }
    expect(current.owner).toBe('triage'); expect(calls).toBe(1);
    const claimed = await staff.messaging.support.claim(conversation.id, current.ownerEpoch, { requestId: 'review-staff-claim' });
    await expect(customer.messaging.review.list(conversation.id)).rejects.toMatchObject({ status: 403 });
    const items = await staff.messaging.review.list(conversation.id); expect(items.items).toHaveLength(1);
    const old = items.items[0]!, detail = await staff.messaging.review.get(conversation.id, old.id);
    expect(detail).toMatchObject({ reason: 'PROVIDER_OUTCOME_UNKNOWN', draftText: null }); expect(detail.history).toHaveLength(1);
    await expect(staff.messaging.review.retry(conversation.id, old.id, claimed.ownerEpoch, false as true, { requestId: 'review-no-ack' })).rejects.toMatchObject({ status: 422 });
    const options = { requestId: 'review-explicit-retry' }, accepted = await staff.messaging.review.retry(conversation.id, old.id, claimed.ownerEpoch, true, options);
    expect(accepted.replacementJobId).not.toBe(old.id);
    expect(await staff.messaging.review.retry(conversation.id, old.id, claimed.ownerEpoch, true, options)).toEqual(accepted);
    release();
    const deadline = Date.now() + 10000; let messages = await customer.messaging.messages.list(conversation.id);
    while (!messages.items.some(row => row.authorKind === 'assistant') && Date.now() < deadline) { await Bun.sleep(50); messages = await customer.messaging.messages.list(conversation.id); }
    expect(calls).toBe(2); expect(messages.items.filter(row => row.authorKind === 'assistant')).toHaveLength(1);
    const retained = await staff.messaging.review.get(conversation.id, old.id);
    expect(retained.reason).toBe(detail.reason); expect(retained.history).toEqual(detail.history); expect(retained.resolution).toEqual(accepted);
    expect((await staff.messaging.review.list(conversation.id)).items).toEqual([]);
    await f.zero.logging!.flush();
    const evidence = await staff.logging.page('audit', { family: 'communications' });
    expect(evidence.events.some(row => row.event.action === 'messaging.review.detail.prepared')).toBe(true);
    expect(JSON.stringify(evidence)).not.toContain('Synthetic review request.'); expect(JSON.stringify(evidence)).not.toContain('Synthetic reviewed replacement answer.');
  } finally { release(); staff.disconnect(); customer.disconnect(); await f.close(); await provider.stop(true); }
}, 90000);

/** Actual loopback provider transport; the real AI gateway, Torrent, Guardian and private actors remain in the path. */
test('independent assistant jobs run concurrently without holding message commits; takeover fences the old answer and provider evidence remains private', async () => {
  const entered: string[] = [], releases = new Map<string, () => void>(), faults: string[] = [];
  const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname !== '/v1/chat/completions') return new Response(null, { status: 404 });
    const input = await request.json() as { messages?: unknown }, text = JSON.stringify(input.messages);
    const marker = ['CUSTOMER_FIRST_PRIVATE_MARKER', 'CUSTOMER_SECOND_PRIVATE_MARKER'].find(value => text.includes(value));
    if (!marker) { faults.push('Missing synthetic marker'); return new Response(null, { status: 400 }); }
    entered.push(marker);
    await new Promise<void>(resolve => { releases.set(marker, resolve); });
    return Response.json({ id: 'synthetic-' + marker, object: 'chat.completion', created: 1, model: 'chat',
      choices: [{ index: 0, message: { role: 'assistant', content: 'SYNTHETIC_PRIVATE_ANSWER_' + marker }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } });
  } });
  const f = await fixture(false, 'all', 'http://127.0.0.1:' + provider.port + '/v1').catch(async failure => { await provider.stop(true); throw failure; });
  const staff = f.client(), first = f.peer(), second = f.peer();
  const until = async (condition: () => boolean | Promise<boolean>) => {
    const deadline = Date.now() + 10000;
    while (!await condition()) { if (Date.now() >= deadline) throw new Error('Synthetic messaging activity did not reach its expected boundary.'); await Bun.sleep(20); }
  };
  try {
    await enroll(staff, 'assistant-staff'); await enroll(first, 'assistant-first'); await enroll(second, 'assistant-second');
    const a = await first.messaging.support.open({}, { requestId: 'assistant-open-first' });
    const b = await second.messaging.support.open({}, { requestId: 'assistant-open-second' });
    await first.messaging.messages.send(a.id, { text: 'CUSTOMER_FIRST_PRIVATE_MARKER' }, { requestId: 'assistant-turn-first' });
    await second.messaging.messages.send(b.id, { text: 'CUSTOMER_SECOND_PRIVATE_MARKER' }, { requestId: 'assistant-turn-second' });
    await until(() => entered.length === 2);
    expect(new Set(entered).size).toBe(2);
    // Both provider requests are held. Foreground reads and accepted writes
    // above must already have finished instead of waiting behind either call.
    expect((await first.messaging.messages.list(a.id)).items.map(row => row.authorKind)).toEqual(['user']);
    releases.get('CUSTOMER_SECOND_PRIVATE_MARKER')!();
    await until(async () => (await second.messaging.messages.list(b.id)).items.some(row => row.authorKind === 'assistant'));
    expect((await first.messaging.messages.list(a.id)).items.map(row => row.authorKind)).toEqual(['user']);
    const taken = await staff.messaging.support.claim(a.id, a.ownerEpoch, { requestId: 'assistant-human-takeover' });
    expect(taken.owner).toBe('human');
    releases.get('CUSTOMER_FIRST_PRIVATE_MARKER')!();
    await until(() => f.zero.workflows!.list().every(row => ['completed', 'failed', 'cancelled'].includes(row.status)));
    expect((await first.messaging.messages.list(a.id)).items.map(row => row.authorKind)).toEqual(['user']);
    expect(entered).toHaveLength(2); expect(faults).toEqual([]);
    await f.zero.logging!.flush();
    const evidence = await f.zero.logging!.page('audit', { kind: 'platform' }, { family: 'ai', limit: 100 });
    expect(evidence.events.some(row => row.event.action === 'ai.provider.completed' && row.event.origin === 'provider' && row.event.evidence === 'provider-confirmed')).toBe(true);
    const retained = JSON.stringify({ evidence, diagnostics: f.diagnostics.query({ limit: 1000 }), workflows: f.zero.workflows!.list() });
    for (const secret of ['CUSTOMER_FIRST_PRIVATE_MARKER', 'CUSTOMER_SECOND_PRIVATE_MARKER', 'SYNTHETIC_PRIVATE_ANSWER_', 'synthetic-local-key']) expect(retained).not.toContain(secret);
  } finally {
    for (const release of releases.values()) release();
    staff.disconnect(); first.disconnect(); second.disconnect();
    try { await f.close(); } finally { await provider.stop(true); }
  }
}, 90000);

test('exact transport replay cannot disclose a retained message after removal, since-join readmission or deletion', async () => {
  const f = await fixture(false, 'since-join'), alice = f.client(), owner = f.peer();
  try {
    await enroll(alice, 'replay-alice'); await enroll(owner, 'replay-owner');
    const conversation = await owner.messaging.conversations.create({ kind: 'group', userIds: [alice.user!.userId] }, { requestId: 'private-replay-create' });
    const input = { text: 'Synthetic retained private message' }, options = { requestId: 'private-replay-send' };
    const sent = await alice.messaging.messages.send(conversation.id, input, options);
    await owner.messaging.conversations.removeParticipant(conversation.id, conversation.revision, alice.user!.userId, { requestId: 'private-replay-remove' });
    await expect(alice.messaging.messages.send(conversation.id, input, options)).rejects.toMatchObject({ status: 409 });
    const receipt = await alice.messaging.receipt(options.requestId);
    expect(receipt).toMatchObject({ requestId: options.requestId, resourceId: sent.id }); expect(JSON.stringify(receipt)).not.toContain(input.text);
    const updated = await owner.messaging.conversations.get(conversation.id);
    await owner.messaging.conversations.addParticipant(conversation.id, updated.revision, alice.user!.userId, { requestId: 'private-replay-readmit' });
    expect((await alice.messaging.messages.list(conversation.id)).items).toEqual([]);
    await expect(alice.messaging.messages.send(conversation.id, input, options)).rejects.toMatchObject({ status: 409 });
    const freshInput = { text: 'Synthetic current history' }, freshOptions = { requestId: 'private-replay-fresh' };
    const fresh = await alice.messaging.messages.send(conversation.id, freshInput, freshOptions);
    expect((await alice.messaging.messages.remove(conversation.id, fresh.id, fresh.revision, { requestId: 'private-replay-delete' })).deleted).toBe(true);
    const replayed = await alice.messaging.messages.send(conversation.id, freshInput, freshOptions);
    expect(replayed.deleted).toBe(true); expect(replayed.text).toBe('');
  } finally { alice.disconnect(); owner.disconnect(); await f.close(); }
}, 90000);

test('native private attachments qualify allocation, bytes, immutable association, delivery, membership revocation and retained restart', async () => {
  const f = await fixture(); let alice = f.client(), bob = f.peer(); const carol = f.peer();
  try {
    await enroll(alice, 'file-alice'); await enroll(bob, 'file-bob'); await enroll(carol, 'file-carol');
    const conversation = await alice.messaging.conversations.create({ kind: 'group', userIds: [bob.user!.userId] }, { requestId: 'files-conversation' });
    const bytes = new TextEncoder().encode('Synthetic confidential orchid attachment.'), checksum = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    const input = { fileName: 'confidential-synthetic-file.txt', mimeType: 'text/plain', sizeBytes: bytes.byteLength, checksum };
    const allocated = await alice.messaging.attachments.allocate(conversation.id, input, { requestId: 'file-allocate' });
    expect(allocated.state).toBe('allocated');
    await expect(bob.messaging.attachments.get(conversation.id, allocated.id)).rejects.toMatchObject({ status: 404 });
    await expect(carol.messaging.attachments.get(conversation.id, allocated.id)).rejects.toMatchObject({ status: 404 });
    const uploaded = await alice.messaging.attachments.upload(conversation.id, allocated.id, bytes, { requestId: 'file-upload' });
    expect(uploaded).toMatchObject({ state: 'ready', checksum, sizeBytes: bytes.byteLength });
    expect((await alice.messaging.attachments.upload(conversation.id, allocated.id, new Uint8Array([9]), { requestId: 'file-upload' })).checksum).toBe(checksum);
    const sent = await alice.messaging.messages.send(conversation.id, { text: '', attachmentIds: [allocated.id] }, { requestId: 'file-send' });
    expect(sent.attachmentIds).toEqual([allocated.id]);
    const download = await bob.messaging.attachments.download(conversation.id, allocated.id);
    expect(await download.text()).toBe(new TextDecoder().decode(bytes));
    expect((await bob.messaging.attachments.get(conversation.id, allocated.id)).messageId).toBe(sent.id);
    expect((await fetch(f.origin + '/api/messaging/conversations/' + conversation.id + '/attachments/' + allocated.id + '/content')).status).toBe(401);
    await expect(alice.messaging.attachments.remove(conversation.id, allocated.id, { requestId: 'file-remove-attached' })).rejects.toMatchObject({ status: 422 });
    await expect(alice.messaging.attachments.allocate(conversation.id, { ...input, fileName: 'changed.txt' }, { requestId: 'file-allocate' })).rejects.toMatchObject({ status: 409 });
    const bad = await alice.messaging.attachments.allocate(conversation.id, { ...input, checksum: '0'.repeat(64) }, { requestId: 'file-bad-allocate' });
    await expect(alice.messaging.attachments.upload(conversation.id, bad.id, bytes, { requestId: 'file-bad-upload' })).rejects.toMatchObject({ status: 400, code: 'STORAGE_INPUT_INVALID' });
    expect((await alice.messaging.attachments.get(conversation.id, bad.id)).state).toBe('allocated');
    expect(await alice.messaging.attachments.remove(conversation.id, bad.id, { requestId: 'file-bad-remove' })).toEqual({ removed: true });
    expect(await alice.messaging.receipt('file-bad-remove')).toMatchObject({ operation: 'attachment.remove', requestId: 'file-bad-remove' });
    await alice.messaging.conversations.removeParticipant(conversation.id, conversation.revision, bob.user!.userId, { requestId: 'file-remove-bob' });
    await expect(bob.messaging.attachments.download(conversation.id, allocated.id)).rejects.toMatchObject({ status: 404 });
    await f.zero.logging!.flush();
    const audit = await alice.logging.page('audit', { family: 'records' });
    expect(JSON.stringify(audit)).not.toContain(input.fileName); expect(JSON.stringify(audit)).not.toContain('confidential orchid');
    alice.disconnect(); bob.disconnect(); carol.disconnect(); await f.restart(); alice = f.client(); bob = f.peer();
    await alice.login('file-alice', PASSWORD); expect(await (await alice.messaging.attachments.download(conversation.id, allocated.id)).text()).toBe(new TextDecoder().decode(bytes));
  } finally { alice.disconnect(); bob.disconnect(); carol.disconnect(); await f.close(); }
}, 90000);

test('strict audit admission gates native messaging and a healthy live stream observes committed inserts without recreating identities', async () => {
  const f = await fixture(true), alice = f.client(), bob = f.peer(); let stop: (() => void) | undefined;
  try {
    await alice.register({ username: 'strict-alice', email: 'strict-alice@example.test', password: PASSWORD });
    await expect(alice.messaging.capabilities()).rejects.toMatchObject({ status: 428 });
    const policy = await alice.logging.collectionPolicy(); await alice.logging.observe([], { policyVersion: policy.delivery!.policyVersion });
    await enroll(bob, 'strict-bob');
    const conversation = await alice.messaging.conversations.create({ userIds: [bob.user!.userId] }, { requestId: 'strict-create' });
    let resolve!: () => void; const observed = new Promise<void>(done => { resolve = done; }), errors: unknown[] = [], seen: string[] = [];
    stop = bob.messaging.watchMessages(conversation.id, page => { for (const row of page.items) if (!seen.includes(row.id)) seen.push(row.id); if (page.items.length) resolve(); }, { onError: error => errors.push(error) });
    const sent = await alice.messaging.messages.send(conversation.id, { text: 'Synthetic live message' }, { requestId: 'live-message' });
    await Promise.race([observed, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('No native messaging projection.')), 5000))]);
    expect(seen).toContain(sent.id); expect(errors).toEqual([]);
    bob.messaging.clear(); const retired = seen.length; await Bun.sleep(100); expect(seen.length).toBe(retired);
  } finally { stop?.(); alice.disconnect(); bob.disconnect(); await f.close(); }
}, 90000);

test('native sockets bind typing to canonical conversation/staff membership, actor tabs, short expiry and prompt membership revocation', async () => {
  const f = await fixture(), alice = f.client(), bob = f.peer(), outsider = f.peer();
  const sockets: Awaited<ReturnType<typeof messagingTypingSocket>>[] = [];
  try {
    await enroll(alice, 'typing-staff'); await enroll(bob, 'typing-customer'); await enroll(outsider, 'typing-outsider');
    const token = async (client: TestClient, username: string) => {
      const result = await client.login(username, PASSWORD);
      if (!('accessToken' in result)) throw new Error('Synthetic single-tenant sign-in did not complete.');
      return result.accessToken;
    };
    const staffToken = await token(alice, 'typing-staff'), customerToken = await token(bob, 'typing-customer'), outsiderToken = await token(outsider, 'typing-outsider');
    const a = await messagingTypingSocket(f.origin, staffToken); sockets.push(a);
    const b = await messagingTypingSocket(f.origin, customerToken); sockets.push(b);
    const c = await messagingTypingSocket(f.origin, outsiderToken); sockets.push(c);
    const support = await bob.messaging.support.open({ title: '' }, { requestId: 'typing-support' });
    await alice.messaging.support.claim(support.id, support.ownerEpoch, { requestId: 'typing-claim' });
    const publicTopic = 'typing:' + messagingTypingRoom(support.id), privateTopic = 'typing:' + messagingTypingRoom(support.id, 'staff');
    for (const [peer, topic] of [[a, publicTopic], [b, publicTopic], [a, privateTopic]] as const) {
      peer.send({ type: 'ephemeral.subscribe', topic });
      await peer.wait(message => message.type === 'ephemeral.snapshot' && message.topic === topic);
    }
    b.send({ type: 'ephemeral.subscribe', topic: privateTopic });
    expect(await b.wait(message => message.type === 'ephemeral.error' && message.topic === privateTopic)).toMatchObject({ code: 'EPHEMERAL_FORBIDDEN' });
    c.send({ type: 'ephemeral.subscribe', topic: publicTopic });
    expect(await c.wait(message => message.type === 'ephemeral.error' && message.topic === publicTopic)).toMatchObject({ code: 'EPHEMERAL_FORBIDDEN' });
    const first = 'user:' + alice.user!.userId + ':session:tabone01', second = 'user:' + alice.user!.userId + ':session:tabtwo02';
    const value = { userId: alice.user!.userId, label: 'Synthetic staff', since: 1, updatedAt: 1, metadata: { activity: 'typing' } };
    a.send({ type: 'ephemeral.set', topic: publicTopic, key: first, value, ttl: 1000 });
    expect(await b.wait(message => message.type === 'ephemeral.change' && message.topic === publicTopic && message.key === first)).toMatchObject({ value, freshness: { ttlMs: 1000 } });
    a.send({ type: 'ephemeral.set', topic: publicTopic, key: second, value, ttl: 5000 });
    await b.wait(message => message.type === 'ephemeral.change' && message.key === second && message.op === 'set');
    a.send({ type: 'ephemeral.delete', topic: publicTopic, key: first });
    await b.wait(message => message.type === 'ephemeral.change' && message.key === first && message.op === 'delete');
    expect(b.messages.some(message => message.type === 'ephemeral.change' && message.key === second && message.op === 'delete')).toBe(false);
    a.send({ type: 'ephemeral.set', topic: publicTopic, key: 'user:' + bob.user!.userId + ':session:forged01', value, ttl: 5000 });
    expect(await a.wait(message => message.type === 'ephemeral.error' && message.key?.includes('forged01') === true)).toMatchObject({ code: 'EPHEMERAL_KEY_NOT_OWNED' });
    a.send({ type: 'ephemeral.set', topic: publicTopic, key: first, value, ttl: 999 });
    expect(await a.wait(message => message.type === 'ephemeral.error' && message.key === first)).toMatchObject({ code: 'EPHEMERAL_INVALID_TTL' });
    a.send({ type: 'ephemeral.set', topic: privateTopic, key: first, value: { ...value, metadata: { activity: 'recording' } }, ttl: 1000 });
    await a.wait(message => message.type === 'ephemeral.change' && message.topic === privateTopic && message.op === 'set');
    // Values become stale at TTL independently from the normal five-second
    // server cleanup sweep. Observe that sweep, not an assumed sub-4s phase.
    await a.wait(message => message.type === 'ephemeral.change' && message.topic === privateTopic && message.op === 'delete', 7000);
    expect(b.messages.some(message => message.type === 'ephemeral.change' && message.topic === privateTopic)).toBe(false);
    const group = await alice.messaging.conversations.create({ kind: 'group', userIds: [bob.user!.userId] }, { requestId: 'typing-group' });
    const groupTopic = 'typing:' + messagingTypingRoom(group.id);
    b.send({ type: 'ephemeral.subscribe', topic: groupTopic });
    await b.wait(message => message.type === 'ephemeral.snapshot' && message.topic === groupTopic);
    await alice.messaging.conversations.removeParticipant(group.id, group.revision, bob.user!.userId, { requestId: 'typing-remove' });
    expect(await b.wait(message => message.type === 'ephemeral.error' && message.topic === groupTopic && message.revoked === true)).toMatchObject({ code: 'EPHEMERAL_FORBIDDEN' });
  } finally { await Promise.all(sockets.map(socket => socket.close())); alice.disconnect(); bob.disconnect(); outsider.disconnect(); await f.close(); }
}, 90000);

test('accepted public sends create one generic native notification for eligible peers; deletion, replay and restart never recreate it or grant transcript access', async () => {
  const f = await fixture(false, 'all', undefined, true); let alice = f.client(), bob = f.peer(); const outsider = f.peer();
  const notices = async (client: TestClient) => (await client.fetch<{ notifications: { notification_id: string; title: string; body: string | null; metadata: string | null; target_value: string; action_url: string; receipt: unknown }[] }>('/notifications')).notifications;
  try {
    await enroll(alice, 'notice-alice'); await enroll(bob, 'notice-bob'); await enroll(outsider, 'notice-outsider');
    const conversation = await alice.messaging.conversations.create({ kind: 'group', userIds: [bob.user!.userId] }, { requestId: 'notice-group' });
    const options = { requestId: 'notice-send' }, message = { text: 'SYNTHETIC_PRIVATE_NOTICE_SOURCE_TEXT' };
    const sent = await alice.messaging.messages.send(conversation.id, message, options);
    let page = await notices(bob); const deadline = Date.now() + 10000;
    while (!page.length && Date.now() < deadline) { await Bun.sleep(50); page = await notices(bob); }
    expect(page).toHaveLength(1);
    const notice = page[0]!;
    expect(notice).toMatchObject({ title: 'New message', body: null, metadata: null, action_url: '/app/messages?conversation=' + conversation.id, receipt: null });
    expect(JSON.parse(notice.target_value)).toEqual([bob.user!.userId]); expect(JSON.stringify(page)).not.toContain(message.text);
    expect(await notices(alice)).toEqual([]); expect(await notices(outsider)).toEqual([]);
    await bob.messaging.conversations.markRead(conversation.id, sent.sequence, { requestId: 'notice-chat-read' });
    expect((await notices(bob))[0]!.receipt).toBeNull();
    await alice.messaging.conversations.removeParticipant(conversation.id, conversation.revision, bob.user!.userId, { requestId: 'notice-remove-bob' });
    await expect(bob.messaging.messages.list(conversation.id)).rejects.toMatchObject({ status: 404 });
    await alice.fetch('/notifications/' + notice.notification_id, { method: 'DELETE' });
    await alice.messaging.messages.send(conversation.id, message, options); await Bun.sleep(100);
    expect(await notices(bob)).toEqual([]);
    alice.disconnect(); bob.disconnect(); outsider.disconnect(); await f.restart(); alice = f.client(); bob = f.peer();
    await alice.login('notice-alice', PASSWORD); await bob.login('notice-bob', PASSWORD);
    await alice.messaging.messages.send(conversation.id, message, options); await Bun.sleep(100);
    expect(await notices(bob)).toEqual([]);
  } finally { alice.disconnect(); bob.disconnect(); outsider.disconnect(); await f.close(); }
}, 90000);

test('a native notification error after its real receiver commit is reconciled once without another notice or overwriting the failed workflow', async () => {
  const f = await fixture(false, 'all', undefined, true), alice = f.client(), bob = f.peer();
  const service = f.zero.notifications!; const publish = service.notifyUsersOnce.bind(service); let calls = 0;
  service.notifyUsersOnce = (...args) => { const result = publish(...args); if (++calls === 1) throw new Error('Synthetic error after the native receiver committed.'); return result; };
  try {
    await enroll(alice, 'notice-recovery-alice'); await enroll(bob, 'notice-recovery-bob');
    const conversation = await alice.messaging.conversations.create({ userIds: [bob.user!.userId] }, { requestId: 'notice-recovery-conversation' });
    await alice.messaging.messages.send(conversation.id, { text: 'PRIVATE_NATIVE_NOTICE_RECOVERY_SOURCE' }, { requestId: 'notice-recovery-send' });
    const deadline = Date.now() + 10000;
    while (calls < 2 && Date.now() < deadline) await Bun.sleep(20);
    expect(calls).toBe(2);
    const page = await bob.fetch<{ notifications: { notification_id: string; body: string | null }[] }>('/notifications');
    expect(page.notifications).toHaveLength(1); expect(page.notifications[0]!.body).toBeNull();
    let runs = f.zero.workflows!.list();
    while (!runs.some(run => run.name === 'zero.messaging.job.v1' && run.status === 'completed') && Date.now() < deadline) { await Bun.sleep(20); runs = f.zero.workflows!.list(); }
    const failed = runs.filter(run => run.name === 'zero.messaging.job.v1' && run.status === 'failed');
    expect(failed).toHaveLength(1);
    expect(runs.filter(run => run.name === 'zero.messaging.job.v1' && run.status === 'completed')).toHaveLength(1);
    expect(JSON.stringify(runs)).not.toContain('PRIVATE_NATIVE_NOTICE_RECOVERY_SOURCE');
    expect(JSON.stringify(runs)).not.toContain('Synthetic error after the native receiver committed.');
  } finally { service.notifyUsersOnce = publish; alice.disconnect(); bob.disconnect(); await f.close(); }
}, 90000);
