import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApp } from './app-factory';
import { authenticatedOnly, defineResource, globalRealm, ownerPolicy, tenantRealm } from '../../resources';
import { defineTable, field } from '../../schema';
import { realm, tables } from './test-fixtures/auth-admission-hot/realm';

test('managed auth mutations wait for a busy hot actor without retrying or weakening authority', async () => {
  const root = await mkdtemp(join(Bun.env.PROJECT_SCRATCH_DIR ?? tmpdir(), 'zero-operation-audit-'));
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    await mkdir(join(root, 'app'));
    const credentialsTable = defineTable('provider_credentials', {
      owner_user_id: field.guardianUser(),
      creator_membership_id: field.guardianMembership({ required: false }),
      label: field.text({ required: true }),
    }, { pk: 'credential_id' });
    app = await createApp({
      db: { mode: 'file', path: join(root, 'app.db') },
      systemDb: { mode: 'file', path: join(root, 'system.db'), synchronous: 'FULL' },
      tables: { ...tables, provider_credentials: credentialsTable.serverTable },
      resources: [...Object.keys(tables).map(table => defineResource({
        table, exposure: 'all', realm: tenantRealm(), policy: authenticatedOnly(),
      })), defineResource({ table: 'provider_credentials', exposure: 'all', realm: globalRealm(), policy: ownerPolicy({ userField: 'owner_user_id' }) })],
      auth: { bootstrap: 'public', registration: { mode: 'public' }, tenancy: 'multi', accountEmails: { passwordReset: false } },
      databaseTopology: {
        mode: 'multiple', rootDirectory: join(root, 'fabric'), realm, tenantIsolation: 'tenant-database',
        placement: 'hot', readers: false, sweepIntervalMs: false, operationTimeoutMs: 20_000,
        actors: { launch: { kind: 'source', entrypoint: fileURLToPath(new URL('./test-fixtures/auth-admission-hot/actor.ts', import.meta.url)) } },
      },
      appDir: join(root, 'app'), outDir: join(root, 'out'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
      serverEndpointsDir: fileURLToPath(new URL('./test-fixtures/auth-admission-hot/endpoints', import.meta.url)),
      serverRoutesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverResourcesDir: false,
      workflows: false, email: false, stateSync: false, ai: false, vector: false, pdf: false, kv: false,
      observability: { console: false, endpoint: false },
    });
    app.listen({ hostname: '127.0.0.1', port: 0 });
    const origin = 'http://127.0.0.1:' + app.server!.port;
    const request = async (method: string, path: string, body?: object, token?: string) => {
      const began = performance.now();
      const response = await fetch(origin + path, { method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, data: await response.json() as any, ms: Math.round(performance.now() - began) };
    };
    const credentials = { username: 'operation-audit-owner', email: 'owner@operation-audit.test', password: 'Only-test-password-123', organizationName: 'Audit owner' };
    const owner = await request('POST', '/auth/register', credentials);
    expect(owner.status).toBe(200);
    const protectedCreate = await request('POST', '/api/resources/provider_credentials', {
      credential_id: 'hot-projection-owner', label: 'Synthetic test credential',
    }, owner.data.accessToken);
    expect(protectedCreate.status, JSON.stringify(protectedCreate.data)).toBe(201);
    const target = await request('POST', '/auth/admin/users', {
      username: 'operation-audit-target', email: 'target@operation-audit.test',
      password: 'Only-test-password-456',
    }, owner.data.accessToken);
    expect(target.status).toBe(200);
    const seed = await request('POST', '/proof/seed', {}, owner.data.accessToken);
    expect(seed.status).toBe(200);
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const counts = await request('GET', '/proof/counts', undefined, owner.data.accessToken);
      if (counts.data.deliveries === 51) break;
      await Bun.sleep(30);
    }
    let sequence = 0;
    const busy = async <T>(operation: () => Promise<T>): Promise<T> => {
      const key = 'audit-busy-' + sequence++, enteredPath = join(root, key + '.entered'), releasePath = join(root, key + '.release');
      const work = request('POST', '/proof/work', { key, enteredPath, releasePath }, owner.data.accessToken);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const until = Date.now() + 5_000;
        while (!await Bun.file(enteredPath).exists() && Date.now() < until) await Bun.sleep(5);
        expect(await Bun.file(enteredPath).exists()).toBe(true);
        timer = setTimeout(() => { void writeFile(releasePath, 'release'); }, 300);
        return await operation();
      } finally { clearTimeout(timer); await writeFile(releasePath, 'release'); expect((await work).status).toBe(200); }
    };
    const report = (operation: string, r: Awaited<ReturnType<typeof request>>) => {
      console.log(JSON.stringify({ audit: 'http-contention', operation, status: r.status, code: r.data.code ?? null, ms: r.ms }));
    };
    const login = await busy(() => request('POST', '/auth/login', { username: credentials.username, password: credentials.password }));
    report('login', login); expect(login.status).toBe(200);
    const member = await busy(() => request('POST', '/auth/tenant/members', { email: 'target@operation-audit.test' }, owner.data.accessToken));
    report('add-member-busy', member); expect(member.status, JSON.stringify(member.data)).toBe(200);
    const memberIdle = await request('POST', '/auth/tenant/members', { email: 'target@operation-audit.test' }, owner.data.accessToken);
    report('add-member-idempotency-control', memberIdle);
    expect(memberIdle.status).toBe(409);
    expect(memberIdle.data.code).toBe('TENANT_MEMBERSHIP_EXISTS');
    const suspendPath = '/auth/admin/users/' + target.data.user.userId;
    const suspended = await busy(() => request('PATCH', suspendPath, { status: 'suspended' }, owner.data.accessToken));
    report('suspend-user-busy', suspended); expect(suspended.status, JSON.stringify(suspended.data)).toBe(200);
    const suspendedIdle = await request('PATCH', suspendPath, { status: 'suspended' }, owner.data.accessToken);
    report('suspend-user-idle-control', suspendedIdle); expect(suspendedIdle.status).toBe(200);
    const registered = await busy(() => request('POST', '/auth/register', {
      username: 'operation-audit-new', email: 'new@operation-audit.test',
      password: 'Only-test-password-789', organizationName: 'Audit new',
    }));
    report('register-busy', registered); expect(registered.status, JSON.stringify(registered.data)).toBe(200);
    const protectedWrite = await busy(() => request('PATCH', '/api/resources/provider_credentials/hot-projection-owner', {
      label: 'Updated synthetic credential',
    }, owner.data.accessToken));
    report('protected-write-busy', protectedWrite); expect(protectedWrite.status, JSON.stringify(protectedWrite.data)).toBe(200);
    const loggedOut = await busy(() => request('POST', '/auth/logout', { refreshToken: login.data.refreshToken }, login.data.accessToken));
    report('logout-busy', loggedOut); expect(loggedOut.status, JSON.stringify(loggedOut.data)).toBe(200);
    const logoutIdle = await request('POST', '/auth/logout', { refreshToken: login.data.refreshToken }, login.data.accessToken);
    report('logout-idle-control', logoutIdle); expect(logoutIdle.status).toBe(200);
  } finally { try { await app?.stop(true); } finally { await rm(root, { recursive: true, force: true }); } }
}, 90_000);
