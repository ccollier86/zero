/** Real managed createApp HTTP/Sync qualification on synthetic account data and external scratch. */
import { describe, expect, test } from 'bun:test';
// Bun has no direct directory creation/removal or general path-join API.
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp } from '../frontend/server/app-factory';
import { MemoryEmailProvider } from '../email/memory-email-provider';
import type { ReactiveDB } from '../sync/reactive-db';
import type { UserStore } from '../auth/user-store';
import type { TokenService } from '../auth/token-service';
import type { TenancyService } from '../auth/tenancy/tenancy-service';
import { NativeSessionStore } from '../auth/oidc/native-session-store';
import { prepareNativeSession } from '../auth/oidc/native-session-factory';
import { defineResource, tenantRealm, tenantKindPolicy } from '../resources';
import { presenceActorRealm } from './test-fixtures/presence-actor-realm';
import { PRESENCE_TABLE, PRESENCE_OWNER_TABLE } from './presence-client-tables';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
async function fixture(enabled = true, fileWithoutMigrations = false, tenancy: 'single' | 'shared' | 'fabric' = 'single') {
  await mkdir(SCRATCH, { recursive: true });
  const root = await mkdtemp(`${SCRATCH}/presence-http-`); await mkdir(join(root, 'app'));
  let app: Awaited<ReturnType<typeof createApp>> | null = null;
  try {
    app = await createApp({ appDir: join(root, 'app'), outDir: join(root, 'out'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
      db: fileWithoutMigrations ? { mode: 'file', path: join(root, 'app.sqlite') } : { mode: 'memory' },
      systemDb: fileWithoutMigrations ? { mode: 'file', path: join(root, 'system.sqlite') } : { mode: 'memory' },
      app: { name: 'Presence test', publicUrl: 'http://localhost' },
      auth: { bootstrap: 'public', tenancy: tenancy === 'single' ? 'single' : 'multi', presence: { enabled }, userProfile: { enabled: true },
        nativeApps: { clients: [{ clientId: 'presence-native', name: 'Presence Native', redirectUris: ['com.example.presence:/callback'],
          scopes: ['openid', 'profile', 'profile:write'] }] } },
      email: { provider: new MemoryEmailProvider(), from: 'no-reply@example.test' },
      tables: tenancy === 'fabric' ? presenceActorRealm.tables : {},
      resources: tenancy === 'fabric' ? [defineResource({ table: 'notes', exposure: 'all', realm: tenantRealm(), policy: tenantKindPolicy('organization') })] : [],
      ...(tenancy === 'fabric' ? { databaseTopology: { mode: 'multiple' as const, rootDirectory: join(root, 'actors'), realm: presenceActorRealm,
        actors: { launch: { kind: 'source' as const, entrypoint: Bun.fileURLToPath(new URL('./test-fixtures/presence-actor-child.ts', import.meta.url)) } },
        tenantIsolation: 'tenant-database' as const } } : {}),
      serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false,
      ...(tenancy === 'fabric' ? {} : { resourceRoutes: false as const }), observability: false, ai: false, vector: false, pdf: false, kv: false, workflows: false, migrate: false });
    let system!: ReactiveDB, users!: UserStore, tokens!: TokenService, tenants!: TenancyService;
    app.get('/__presence_probe', context => {
      const scoped = context as unknown as { authStore: UserStore; tokenService: TokenService; tenancyService: TenancyService };
      users = scoped.authStore; system = (users as unknown as { db: ReactiveDB }).db;
      tokens = scoped.tokenService; tenants = scoped.tenancyService; return { ready: Boolean(system) };
    });
    app.listen(0); const base = `http://localhost:${app.server!.port}`;
    const request = async (method: string, path: string, body?: unknown, token?: string) => {
      const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, headers: response.headers, body: await response.json() as any };
    };
    await request('GET', '/__presence_probe');
    const register = async (username: string) => {
      const result = await request('POST', '/auth/register', { username, email: `${username}@example.test`, password: 'password123',
        ...(tenancy === 'single' ? {} : { organizationName: 'Bootstrap organization' }) });
      expect(result.status).toBe(200); return result.body as { accessToken: string; user: { userId: string } };
    };
    return { base, request, register, getSystem: () => system, getUsers: () => users, getTokens: () => tokens, getTenants: () => tenants,
      close: async () => { await app!.stop(true); await rm(root, { recursive: true, force: true }); } };
  } catch (error) { await app?.stop(true).catch(() => {}); await rm(root, { recursive: true, force: true }); throw error; }
}

async function connect(base: string, token: string) {
  const ws = new WebSocket(`${base.replace('http:', 'ws:')}/sync`), messages: any[] = [];
  ws.addEventListener('message', event => { messages.push(JSON.parse(String(event.data))); });
  await new Promise<void>((resolve, reject) => { ws.addEventListener('open', () => resolve(), { once: true }); ws.addEventListener('error', () => reject(new Error('Synthetic socket failed')), { once: true }); });
  const wait = async (predicate: (message: any) => boolean) => {
    for (let attempt = 0; attempt < 300; attempt++) {
      const found = messages.find(predicate); if (found) return found;
      await Bun.sleep(10);
    }
    throw new Error('Synthetic presence message deadline exceeded');
  };
  ws.send(JSON.stringify({ type: 'sync.auth', token })); await wait(message => message.type === 'sync.auth.ready');
  return { ws, messages, wait, send: (value: unknown) => ws.send(JSON.stringify(value)), close: () => new Promise<void>(resolve => {
    if (ws.readyState === WebSocket.CLOSED) return resolve(); ws.addEventListener('close', () => resolve(), { once: true }); ws.close();
  }) };
}

describe('managed presence real HTTP and Sync', () => {
  test('native profile-read cannot set intent or emit heartbeats; explicit profile-write can do both', async () => {
    const f = await fixture();
    try {
      const account = await f.register('native-presence');
      const user = f.getUsers().getUserById(account.user.userId)!, generation = f.getUsers().getAuthGeneration(user.userId);
      const sessions = new NativeSessionStore(f.getSystem());
      const native = async (scope: string) => {
        const prepared = prepareNativeSession({ userId: user.userId, clientId: 'presence-native', scope, authGeneration: generation, ttlMs: 3600000,
          authority: { scopeKind: 'application', scopeId: 'application', tenantId: null, membershipId: null,
            tenantAuthorizationGeneration: null, membershipAuthorizationGeneration: null } });
        expect(sessions.consumeCodeAndInsert(() => true, prepared.session)).toBe(true);
        return f.getTokens().signNativeAccessToken(user, 'presence-native', scope, generation, prepared.session.familyId);
      };
      const identity = await native('openid'), reader = await native('openid profile'), writer = await native('openid profile profile:write');
      expect((await f.request('GET', '/auth/presence/config', undefined, identity)).status).toBe(403);
      expect((await f.request('GET', '/auth/presence/config', undefined, reader)).body)
        .toMatchObject({ state: 'ready', canSetIntent: false, canReportActivity: false });
      expect((await f.request('PATCH', '/auth/presence/me', { status: 'busy', expectedRevision: 0 }, reader)).status).toBe(403);
      const readSocket = await connect(f.base, reader);
      try {
        readSocket.send({ type: 'ephemeral.set', topic: 'guardian:presence', key: 'self', value: { sequence: 1, activity: true, visible: true } });
        expect((await readSocket.wait(message => message.type === 'ephemeral.error')).code).toBe('EPHEMERAL_FORBIDDEN');
        expect((await f.request('GET', '/auth/presence/me', undefined, reader)).body.observation.connected).toBe(false);
      } finally { await readSocket.close(); }
      const writeSocket = await connect(f.base, writer);
      try {
        writeSocket.send({ type: 'ephemeral.set', topic: 'guardian:presence', key: 'self', value: { sequence: 1, activity: true, visible: true } });
        await Bun.sleep(20);
        const accepted = await f.request('PATCH', '/auth/presence/me', { status: 'busy', expectedRevision: 0 }, writer);
        expect(accepted.status).toBe(200); expect(accepted.body.observation).toMatchObject({ status: 'busy', connected: true });
      } finally { await writeSocket.close(); }
    } finally { await f.close(); }
  }, 20000);

  test('same-org Guardian feeds work in shared and real Fabric topology, including app-only administration members without unrelated resource powers', async () => {
    for (const topology of ['shared', 'fabric'] as const) {
      const f = await fixture(true, false, topology);
      try {
        const bootstrap = await f.register(`bootstrap-${topology}`), users = f.getUsers(), tenants = f.getTenants();
        const member = await users.createUser({ username: `member-${topology}`, email: `member-${topology}@example.test`, password: 'password123', role: 'user' });
        const other = await users.createUser({ username: `other-${topology}`, email: `other-${topology}@example.test`, password: 'password123', role: 'user' });
        const administration = tenants.getAdministrationTenant()!;
        const administrationMembership = tenants.addMembership({ tenantId: administration.tenantId, userId: member.userId, roleKey: 'member', createdBy: bootstrap.user.userId });
        const organization = tenants.createTenant({ slug: `organization-${topology}`, name: 'Organization', ownerUserId: other.userId });
        const adminTokens = await f.getTokens().issueTokenPair(member, { binding: { tenantId: administration.tenantId, membershipId: administrationMembership.membershipId } });
        const orgTokens = await f.getTokens().issueTokenPair(other, { binding: { tenantId: organization.tenant.tenantId, membershipId: organization.ownerMembership.membershipId } });
        const adminCapabilities = await f.request('GET', '/auth/presence/config', undefined, adminTokens.accessToken);
        const orgCapabilities = await f.request('GET', '/auth/presence/config', undefined, orgTokens.accessToken);
        expect({ topology, state: adminCapabilities.body.state,
          queued: f.getSystem().prepare('SELECT scope_kind,owner_epoch,publication_revision,retry_at FROM _guardian_presence_outbox ORDER BY publication_revision').all() })
          .toMatchObject({ state: 'ready' });
        expect(orgCapabilities.body.state).toBe('ready');
        const adminList = await f.request('GET', '/auth/presence', undefined, adminTokens.accessToken);
        expect(adminList.status).toBe(200); expect(adminList.body.items.map((item: { userId: string }) => item.userId)).toContain(member.userId);
        expect(adminList.body.items.map((item: { userId: string }) => item.userId)).not.toContain(other.userId);
        const orgList = await f.request('GET', '/auth/presence', undefined, orgTokens.accessToken);
        expect(orgList.body.items.map((item: { userId: string }) => item.userId)).toEqual([other.userId]);
        if (topology === 'fabric') {
          expect((await f.request('GET', '/api/resources/notes', undefined, adminTokens.accessToken)).status).toBe(403);
          expect((await f.request('GET', '/api/resources/notes', undefined, orgTokens.accessToken)).status).toBe(200);
        }
        const observer = await connect(f.base, adminTokens.accessToken);
        try {
          observer.send({ type: 'sync.subscribe', tables: [PRESENCE_TABLE, PRESENCE_OWNER_TABLE], snapshot: [PRESENCE_TABLE, PRESENCE_OWNER_TABLE], lastSeq: 0 });
          const snapshot = await observer.wait(message => message.type === 'sync.snapshot' && message.plane === 'system');
          const ids = Object.values(snapshot.tables.guardian_presence).map(row => (row as { user_id: string }).user_id);
          expect(ids).toContain(member.userId); expect(ids).not.toContain(other.userId);
        } finally { await observer.close(); }
      } finally { await f.close(); }
    }
  }, 30000);

  test('actual account routes, canonical system feed and socket leases use accepted status and protected writes', async () => {
    const f = await fixture(); let first: Awaited<ReturnType<typeof connect>> | null = null, second: Awaited<ReturnType<typeof connect>> | null = null;
    try {
      const account = await f.register('presence-user');
      expect((await f.request('GET', '/auth/profile', undefined, account.accessToken)).status).toBe(200);
      const capabilities = await f.request('GET', '/auth/presence/config', undefined, account.accessToken);
      expect(capabilities.status).toBe(200); expect(capabilities.body).toMatchObject({ enabled: true, state: 'ready', topology: 'single-owner' });
      expect(capabilities.body.serverTime).toBeGreaterThan(0); expect(capabilities.headers.get('cache-control')).toContain('no-store');
      first = await connect(f.base, account.accessToken); second = await connect(f.base, account.accessToken);
      first.send({ type: 'sync.subscribe', tables: [PRESENCE_TABLE, PRESENCE_OWNER_TABLE], snapshot: [PRESENCE_TABLE, PRESENCE_OWNER_TABLE], lastSeq: 0 });
      const snapshot = await first.wait(message => message.type === 'sync.snapshot' && message.plane === 'system');
      expect(Object.values(snapshot.tables.guardian_presence)).toMatchObject([{ user_id: account.user.userId, status_key: 'offline' }]);
      first.send({ type: 'ephemeral.set', topic: 'guardian:presence', key: 'self', value: { sequence: 1, activity: true, visible: true } });
      await first.wait(message => message.type === 'sync.change' && message.table === PRESENCE_TABLE && message.row?.status_key === 'available');
      expect((await f.request('GET', '/auth/presence/me', undefined, account.accessToken)).body.observation).toMatchObject({ connected: true, status: 'available' });
      const accepted = await f.request('PATCH', '/auth/presence/me', { status: 'busy', expectedRevision: 0 }, account.accessToken);
      expect(accepted.status).toBe(200); expect(accepted.body.intent).toMatchObject({ status: 'busy', revision: 1 });
      expect(accepted.body.observation.status).toBe('busy');
      expect((await f.request('PATCH', '/auth/presence/me', { status: 'idle', expectedRevision: 1 }, account.accessToken)).status).toBe(422);
      expect((await f.request('PATCH', '/auth/presence/me', { status: 'away', expectedRevision: 0 }, account.accessToken)).status).toBe(409);
      first.send({ type: 'sync.mutate', ref: 'forged-presence', table: PRESENCE_TABLE, op: 'DELETE', rowId: Object.keys(snapshot.tables.guardian_presence)[0] });
      expect((await first.wait(message => message.type === 'sync.ack' && message.ref === 'forged-presence')).ok).toBe(false);
      first.send({ type: 'ephemeral.set', topic: 'guardian:presence', key: 'self', ttl: 999999, value: { sequence: 2, activity: true, visible: true } });
      expect((await first.wait(message => message.type === 'ephemeral.error' && message.topic === 'guardian:presence')).code).toBe('EPHEMERAL_FORBIDDEN');
      second.send({ type: 'ephemeral.set', topic: 'guardian:presence', key: 'self', value: { sequence: 1, activity: true, visible: true } });
      // A real accepted me read crosses the same source/projection barrier before close assertions.
      await Bun.sleep(20); expect((await f.request('GET', '/auth/presence/me', undefined, account.accessToken)).body.observation.connected).toBe(true);
      await first.close(); first = null;
      expect((await f.request('GET', '/auth/presence/me', undefined, account.accessToken)).body.observation.connected).toBe(true);
      await second.close(); second = null;
      expect((await f.request('GET', '/auth/presence/me', undefined, account.accessToken)).body.observation.status).toBe('offline');
      expect((await f.request('GET', '/auth/presence')).status).toBe(401);
      expect((await f.request('GET', '/auth/presence?tenantId=forged', undefined, account.accessToken)).status).toBe(422);
    } finally { await first?.close(); await second?.close(); await f.close(); }
  }, 20000);

  test('disabled and migrate:false file storage do not install feature projections or break normal account use', async () => {
    for (const [enabled, blocked] of [[false, false], [true, true]] as const) {
      const f = await fixture(enabled, blocked);
      try {
        const account = await f.register(enabled ? 'pending-user' : 'disabled-user');
        const result = await f.request('GET', '/auth/presence/config', undefined, account.accessToken);
        expect(result.status).toBe(200); expect(result.body.state).toBe(enabled ? 'pending' : 'disabled');
        expect(f.getSystem().prepare('SELECT 1 FROM sqlite_master WHERE name=?').get('guardian_presence')).toBeNull();
        expect((await f.request('GET', '/auth/me', undefined, account.accessToken)).status).toBe(200);
        const socket = await connect(f.base, account.accessToken);
        try {
          socket.send({ type: 'ephemeral.set', topic: 'guardian:presence', key: 'self', value: { sequence: 1, activity: true, visible: true } });
          expect((await socket.wait(message => message.type === 'ephemeral.error')).code).toBe('EPHEMERAL_FORBIDDEN');
        } finally { await socket.close(); }
      } finally { await f.close(); }
    }
  }, 20000);
});
