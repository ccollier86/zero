/** Real managed HTTP/Guardian/source-outbox/Fabric boundary; only synthetic private state and local workers. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app-factory';
import { defineEndpoint, defineRouter, defineZeroPlugin } from './server-extensions';
import type { ServerRouteServices } from './server-services';
import type { AppConfig } from './types';

async function fixture(logging: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'zero-own-profile-audit-'));
  let services!: ServerRouteServices;
  try {
    await mkdir(join(root, 'app'));
    const app = await createApp({ projectRoot: root,
      db: { mode: 'file', path: join(root, 'application.db'), synchronous: 'FULL' },
      systemDb: { mode: 'file', path: join(root, 'system.db'), synchronous: 'FULL' }, tables: {},
      auth: { bootstrap: 'public', registration: { mode: 'public' }, accountEmails: { passwordReset: false },
        userProperties: {
          professional_credentials: { type: 'string', editableBy: 'user' },
          professional_region: { type: 'string', editableBy: 'user' },
          optional: { type: 'string', editableBy: 'user' },
          plan: { type: 'string', editableBy: 'admin', useInPolicies: true, default: 'basic' },
        }, userProfile: { enabled: true, fields: { bio: true, firstName: true } } },
      logging: logging ? { preset: 'compliance', rootDirectory: 'logging' } : false,
      workflows: false, email: false, ai: false, vector: false, kv: false, pdf: false,
      appDir: join(root, 'app'), outDir: join(root, 'build'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
      themeFoundation: 'legacy', frontendBuild: { version: 1, frontend: { themeFoundation: 'legacy', plugins: {} }, pluginIdentities: {} },
      migrate: true, serverPluginsDir: false, serverResourcesDir: false, serverMiddlewareDir: false, serverEndpointsDir: false,
      serverRoutesDir: false, resourceRoutes: false, observability: { console: false },
      serverExtensions: [defineZeroPlugin({ name: 'own-profile-inspection', setup({ zero }) { services = zero; } }),
        defineRouter({ name: 'own-profile-proof', prefix: '/proof', auth: { user: 'required', credentials: ['session'] }, routes: [
          defineEndpoint({ method: 'GET', path: '/read', handler: () => ({ protected: true }) }),
        ] })],
    } as AppConfig);
    app.listen({ hostname: '127.0.0.1', port: 0 }); const origin = 'http://127.0.0.1:' + app.server!.port;
    const call = (method: string, path: string, body?: unknown, token?: string) => fetch(origin + path, { method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const register = async (name: string) => {
      const response = await call('POST', '/auth/register', { username: name, email: name + '@example.test', password: 'Fixture-password-123!' });
      expect(response.status).toBe(200); return response.json() as Promise<{ accessToken: string; user: { userId: string } }>;
    };
    const acknowledge = (token: string) => call('POST', '/api/_zero/logging/observations',
      { observations: [], policyVersion: services.logging!.config.policyVersion }, token);
    return { app, services, call, register, acknowledge, async close() { await app.stop(true); await rm(root, { recursive: true, force: true }); } };
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}

test('managed compliance: self-property and personal-profile commits remain accepted without retiring healthy admission; durable native audit identifies the account', async () => {
  const f = await fixture(true);
  try {
    const user = await f.register('profile-owner');
    expect((await f.call('GET', '/proof/read', undefined, user.accessToken)).status).toBe(428);
    expect((await f.acknowledge(user.accessToken)).status).toBe(200);
    for (const [key, value] of [['professional_credentials', 'PRIVATE_PROFESSIONAL_VALUE'], ['professional_region', 'PRIVATE_REGION_VALUE']]) {
      const saved = await f.call('PUT', '/auth/me/properties/' + key, { value }, user.accessToken);
      expect(saved.status, await saved.clone().text()).toBe(200);
      expect((await f.call('GET', '/proof/read', undefined, user.accessToken)).status).toBe(200);
    }
    const profileResponse = await f.call('GET', '/auth/profile', undefined, user.accessToken);
    expect(profileResponse.status, await profileResponse.clone().text()).toBe(200);
    const before = await profileResponse.json() as { revision: number };
    const savedProfile = await f.call('PATCH', '/auth/profile', { expectedRevision: before.revision,
      changes: { firstName: 'PRIVATE_PROFILE_NAME', bio: 'PRIVATE_BIOGRAPHY_VALUE' } }, user.accessToken);
    expect(savedProfile.status, await savedProfile.clone().text()).toBe(200);
    expect((await f.call('GET', '/proof/read', undefined, user.accessToken)).status).toBe(200);
    // The metadata correction must agree with live Sync admission too.
    const socket = new WebSocket(f.app.server!.url.toString().replace('http:', 'ws:').replace(/\/$/, '') + '/sync');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('Synthetic Sync admission timed out')); }, 5000);
      socket.onopen = () => socket.send(JSON.stringify({ type: 'sync.auth', token: user.accessToken }));
      socket.onmessage = event => { if (typeof event.data === 'string' && JSON.parse(event.data).type === 'sync.auth.ready') { clearTimeout(timer); socket.close(); resolve(); } };
      socket.onerror = () => { clearTimeout(timer); reject(new Error('Synthetic Sync admission failed')); };
      socket.onclose = () => { clearTimeout(timer); reject(new Error('Synthetic Sync admission was rejected')); };
    });
    // Same-value replay and absent optional fields do not manufacture changes.
    expect((await f.call('PUT', '/auth/me/properties/professional_credentials', { value: 'PRIVATE_PROFESSIONAL_VALUE' }, user.accessToken)).status).toBe(200);
    expect(f.services.auth.store!.getProperty(user.user.userId, 'optional')).toBeNull();
    expect((await f.call('PUT', '/auth/me/properties/plan', { value: 'forged' }, user.accessToken)).status).toBe(403);
    await f.services.logging!.flush();
    const retained = [];
    for (const [action, count] of [['account.property-updated', 2], ['account.profile-updated', 1]] as const) {
      const response = await f.call('POST', '/api/_zero/logging/events', { stream: 'audit', query: { action } }, user.accessToken);
      expect(response.status).toBe(200);
      const page = await response.json() as { events: { event: any }[] };
      expect(page.events).toHaveLength(count);
      for (const row of page.events) expect(row.event).toMatchObject({ action, outcome: 'succeeded', evidence: 'server-confirmed',
        actor: { kind: 'user', id: user.user.userId }, target: { type: 'user', id: user.user.userId }, scope: { kind: 'application', tenantId: null } });
      retained.push(...page.events);
    }
    expect(retained.find(row => row.event.action === 'account.profile-updated')!.event.metadata).toEqual({ fields: 'firstName,bio', revision: before.revision + 1 });
    expect(retained.filter(row => row.event.action === 'account.property-updated').map(row => row.event.metadata.field).sort()).toEqual(['professional_credentials', 'professional_region']);
    expect(JSON.stringify(retained)).not.toMatch(/PRIVATE_PROFESSIONAL_VALUE|PRIVATE_REGION_VALUE|PRIVATE_PROFILE_NAME|PRIVATE_BIOGRAPHY_VALUE/);
    const member = await f.register('profile-member');
    expect((await f.acknowledge(member.accessToken)).status).toBe(200);
    expect((await f.call('POST', '/api/_zero/logging/events', { stream: 'audit', query: {} }, member.accessToken)).status).toBe(403);
    const editedOther = await f.call('PUT', '/auth/admin/users/' + member.user.userId + '/properties/professional_credentials', { value: 'PRIVATE_OTHER_VALUE' }, user.accessToken);
    expect(editedOther.status, await editedOther.clone().text()).toBe(200);
    expect((await f.call('GET', '/proof/read', undefined, user.accessToken)).status).toBe(200);
    expect((await f.call('GET', '/proof/read', undefined, member.accessToken)).status).toBe(200);
    expect((await f.call('PUT', '/auth/admin/users/' + member.user.userId + '/properties/plan', { value: 'restricted' }, user.accessToken)).status).toBe(200);
    expect((await f.call('GET', '/proof/read', undefined, member.accessToken)).status).toBe(401);
    expect((await f.call('GET', '/proof/read', undefined, user.accessToken)).status).toBe(200);
  } finally { await f.close(); }
}, 60000);

test('managed post-append failure rolls back personal/property state, Guardian audit and the logging source outbox together', async () => {
  const f = await fixture(true);
  try {
    const user = await f.register('atomic-profile-owner'); expect((await f.acknowledge(user.accessToken)).status).toBe(200);
    const before = await (await f.call('GET', '/auth/profile', undefined, user.accessToken)).json() as { revision: number };
    const store = f.services.auth.store!, append = store.appendControlPlaneAudit.bind(store);
    store.appendControlPlaneAudit = input => { append(input); throw new Error('Synthetic failure after source audit enqueue'); };
    expect((await f.call('PUT', '/auth/me/properties/professional_credentials', { value: 'ROLLED_BACK' }, user.accessToken)).status).toBe(500);
    expect((await f.call('PATCH', '/auth/profile', { expectedRevision: before.revision, changes: { bio: 'ROLLED_BACK' } }, user.accessToken)).status).toBe(500);
    store.appendControlPlaneAudit = append;
    expect(store.getProperty(user.user.userId, 'professional_credentials')).toBeNull();
    const after = await (await f.call('GET', '/auth/profile', undefined, user.accessToken)).json() as { revision: number; values: { bio: unknown } };
    expect(after.revision).toBe(before.revision); expect(after.values.bio).toBeNull();
    await f.services.logging!.flush();
    for (const action of ['account.property-updated', 'account.profile-updated']) {
      expect((await f.services.logging!.page('audit', { kind: 'application' }, { action })).events).toHaveLength(0);
    }
    expect((await f.call('GET', '/proof/read', undefined, user.accessToken)).status).toBe(200);
  } finally { await f.close(); }
}, 60000);

test('declared trusted-property changes still trip final authority and invalidate the old audit grant', async () => {
  const f = await fixture(true);
  try {
    const user = await f.register('security-owner'); expect((await f.acknowledge(user.accessToken)).status).toBe(200);
    // A real security change between source commit and response release must
    // still leave the write unresolved, not silently bless the new authority.
    const store = f.services.auth.store!, append = store.appendControlPlaneAudit.bind(store);
    store.appendControlPlaneAudit = input => {
      append(input);
      store.afterCommit(() => { store.setProperty(user.user.userId, 'plan', 'changed'); });
    };
    const changed = await f.call('PUT', '/auth/me/properties/professional_credentials', { value: 'accepted-before-security-change' }, user.accessToken);
    store.appendControlPlaneAudit = append;
    expect(changed.status).toBe(503); expect(await changed.json()).toMatchObject({ code: 'LOGGING_OUTCOME_UNKNOWN' });
    expect(f.services.auth.store!.getProperty(user.user.userId, 'plan')).toBe('changed');
    expect((await f.call('GET', '/proof/read', undefined, user.accessToken)).status).toBe(428);
    expect((await f.acknowledge(user.accessToken)).status).toBe(200);
    expect((await f.call('GET', '/proof/read', undefined, user.accessToken)).status).toBe(200);
  } finally { await f.close(); }
}, 60000);

test('logging disabled still enforces native property permissions and profile authority', async () => {
  const f = await fixture(false);
  try {
    const user = await f.register('no-logging-owner');
    expect((await f.call('PUT', '/auth/me/properties/professional_credentials', { value: 'changed' }, user.accessToken)).status).toBe(200);
    expect((await f.call('GET', '/proof/read', undefined, user.accessToken)).status).toBe(200);
    expect((await f.call('PUT', '/auth/me/properties/plan', { value: 'forged' }, user.accessToken)).status).toBe(403);
    expect((await f.call('PUT', '/auth/me/properties/professional_credentials', { value: 'anonymous' })).status).toBe(401);
  } finally { await f.close(); }
}, 30000);

test('managed compliance: a persistent Sync reader survives ordinary own metadata but still retires on a trusted property change', async () => {
  const f = await fixture(true); let socket: WebSocket | undefined;
  try {
    const user = await f.register('persistent-profile-owner'); expect((await f.acknowledge(user.accessToken)).status).toBe(200);
    socket = new WebSocket(f.app.server!.url.toString().replace('http:', 'ws:').replace(/\/$/, '') + '/sync');
    const frames: any[] = []; let closed: {code: number; reason: string} | null = null;
    socket.onmessage = event => { if (typeof event.data === 'string') frames.push(JSON.parse(event.data)); };
    socket.onclose = event => { closed = {code: event.code, reason: event.reason}; };
    socket.onopen = () => socket!.send(JSON.stringify({type: 'sync.auth', token: user.accessToken}));
    const until = async (check: () => boolean) => {
      const deadline = Date.now() + 5000;
      while (!check()) { if (Date.now() >= deadline) throw new Error('Synthetic persistent Sync response timed out'); await Bun.sleep(10); }
    };
    await until(() => frames.some(frame => frame.type === 'sync.auth.ready') || closed !== null);
    expect(closed).toBeNull();
    socket.send(JSON.stringify({type: 'sync.subscribe', tables: [], snapshot: [], lastSeq: 0}));
    await until(() => frames.some(frame => frame.type === 'sync.snapshot.end' || frame.type === 'sync.snapshot') || closed !== null);
    expect(closed).toBeNull();
    const cursor = frames.find(frame => frame.type === 'sync.snapshot.begin' || frame.type === 'sync.snapshot');
    expect(cursor).toBeDefined();
    expect((await f.call('PUT', '/auth/me/properties/professional_credentials', {value: 'Ordinary metadata'}, user.accessToken)).status).toBe(200);
    frames.length = 0;
    const subscribe = {type: 'sync.subscribe', tables: [], snapshot: [], lastSeq: cursor.seq, epoch: cursor.epoch, scope: cursor.scope};
    socket.send(JSON.stringify(subscribe));
    await until(() => frames.some(frame => frame.type === 'sync.catchup') || closed !== null);
    expect(closed).toBeNull();
    expect(frames.some(frame => frame.type === 'sync.catchup')).toBe(true);
    f.services.auth.store!.setProperty(user.user.userId, 'plan', 'trusted-change');
    socket.send(JSON.stringify(subscribe));
    await until(() => closed !== null);
    expect(closed).toEqual({ code: 4001, reason: 'Sync access changed' });
  } finally { socket?.close(); await f.close(); }
}, 30000);
