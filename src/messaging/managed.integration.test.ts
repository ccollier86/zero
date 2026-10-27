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
  const messaging = createMessagingClient(call), logging = createLoggingClient(call);
  const authenticate = async (path: string, body: unknown) => { const result = await call<any>(path, { method: 'POST', body }); token = result.accessToken; user = result.user; return result; };
  return { messaging, logging, fetch: call, get user() { return user; }, register: input => authenticate('/auth/register', input), login: (username, password) => authenticate('/auth/login', { username, password }), disconnect() { messaging.clear(); logging.clear(); token = null; user = null; } };
}
async function fixture(compliance = false) {
  const root = await mkdtemp(join(tmpdir(), 'zero-messaging-managed-')); await mkdir(join(root, 'app'));
  let zero!: ServerRouteServices;
  const diagnostics = new MemoryEventStore();
  const configuration: AppConfig = { projectRoot: root, db: { mode: 'file', path: join(root, 'app.db'), synchronous: 'FULL' }, systemDb: { mode: 'file', path: join(root, 'system.db'), synchronous: 'FULL' }, tables: {},
    auth: { bootstrap: 'public' }, messaging: { support: {} }, logging: { preset: compliance ? 'compliance' : 'detailed', rootDirectory: join(root, 'logs') },
    appDir: join(root, 'app'), outDir: join(root, 'out'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
    themeFoundation: 'legacy', frontendBuild: { version: 1, frontend: { themeFoundation: 'legacy', plugins: {} }, pluginIdentities: {} },
    workflows: false, email: false, ai: false, vector: false, pdf: false, kv: false, stateSync: false, observability: { console: false, endpoint: false, store: diagnostics },
    serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false,
    serverExtensions: [defineZeroPlugin({ name: 'messaging-fixture', setup(context) { zero = context.zero; } }), defineEndpoint({ method: 'GET', path: '/proof/messaging', auth: 'user', handler: ({ zero }) => zero.messaging!.capabilities() })],
  };
  let app = await createApp(configuration); const listen = () => { app.listen({ hostname: '127.0.0.1', port: 0 }); return 'http://127.0.0.1:' + app.server!.port; }; let origin = listen();
  const client = () => createClient({ url: origin, auth: true, autoConnect: false });
  return { root, diagnostics, configuration, client, peer: () => peer(origin), get zero() { return zero; }, get origin() { return origin; }, async restart() { await app.stop(true); app = await createApp(configuration); origin = listen(); }, async close() { await app.stop(true); } };
}
async function enroll(client: TestClient, name: string) {
  await client.register({ username: name, email: name + '@example.test', password: PASSWORD });
  const policy = await client.logging.collectionPolicy(); if (policy.delivery) await client.logging.observe([], { policyVersion: policy.delivery.policyVersion });
}

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
    alice.disconnect(); bob.disconnect(); await f.restart(); alice = f.client(); bob = f.peer();
    await alice.login('message-alice', PASSWORD); await bob.login('message-bob', PASSWORD);
    expect((await bob.messaging.messages.list(created.id)).items[0]!.id).toBe(sent.id);
    expect((await bob.messaging.conversations.get(created.id)).unreadCount).toBe(0);
    expect(await alice.messaging.receipt('send-one')).toMatchObject({ requestId: 'send-one', resourceId: sent.id });
  } finally { for (const event of f.diagnostics.query({ limit: 1000 }).events.filter(event => event.code === 'messaging.operation.rejected' || event.code.includes('executor.failed'))) console.info('Synthetic messaging storage outcome', event.metadata); alice.disconnect(); bob.disconnect(); await f.close(); }
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
