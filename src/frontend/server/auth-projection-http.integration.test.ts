import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineResource, globalRealm, ownerPolicy } from '../../resources';
import { defineTable, field } from '../../schema';
import { createApp } from './app-factory';

for (const tenancy of ['single', 'multi'] as const) {
  test(`managed ${tenancy}-tenant bootstrap, admin creation and protected writes compose with identity projection`, async () => {
    const root = await mkdtemp(join(Bun.env.PROJECT_SCRATCH_DIR ?? tmpdir(), 'zero-auth-projection-'));
    let app: Awaited<ReturnType<typeof createApp>> | undefined;
    try {
      const credentials = defineTable('provider_credentials', {
        owner_user_id: field.guardianUser(), label: field.text({ required: true }),
      }, { pk: 'credential_id' });
      await mkdir(join(root, 'app'));
      app = await createApp({
        db: { mode: 'file', path: join(root, 'app.db') },
        systemDb: { mode: 'file', path: join(root, 'system.db'), synchronous: 'FULL' },
        tables: { provider_credentials: credentials.serverTable },
        resources: [defineResource({ table: 'provider_credentials', exposure: 'all', realm: globalRealm(), policy: ownerPolicy({ userField: 'owner_user_id' }) })],
        auth: { bootstrap: 'public', registration: { mode: 'public' }, tenancy, accountEmails: { passwordReset: false } },
        appDir: join(root, 'app'), outDir: join(root, 'out'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
        serverEndpointsDir: false, serverRoutesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverResourcesDir: false,
        workflows: false, email: false, stateSync: false, ai: false, vector: false, pdf: false, kv: false,
        observability: { console: false, endpoint: false },
      });
      app.listen({ hostname: '127.0.0.1', port: 0 });
      const origin = 'http://127.0.0.1:' + app.server!.port;
      let sequence = 0;
      const request = async (method: string, path: string, body?: object, token?: string) => {
        const response = await fetch(origin + path, {
          method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `projection-test:${sequence++}`,
            ...(token ? { Authorization: 'Bearer ' + token } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return { status: response.status, data: await response.json() as any };
      };
      const password = 'Only-test-password-123';
      const owner = await request('POST', '/auth/register', {
        username: 'projection-owner', email: 'owner@projection.test', password,
        ...(tenancy === 'multi' ? { organizationName: 'Projection test' } : {}),
      });
      expect(owner.status, JSON.stringify(owner.data)).toBe(200);
      const token = owner.data.accessToken;
      const created = await request('POST', '/api/resources/provider_credentials', { credential_id: 'first', label: 'Synthetic credential' }, token);
      expect(created.status, JSON.stringify(created.data)).toBe(201);
      const accounts = await Promise.all(Array.from({ length: 4 }, (_, index) => request('POST', '/auth/admin/users', {
        username: `projection-user-${index}`, email: `user-${index}@projection.test`, password,
      }, token)));
      for (const account of accounts) expect(account.status, JSON.stringify(account.data)).toBe(200);
      expect(created.data.row.owner_user_id).toBe(owner.data.user.userId);
      const protectedWrite = await request('POST', '/api/resources/provider_credentials', { credential_id: 'second', label: 'Another synthetic credential' }, token);
      expect(protectedWrite.status, JSON.stringify(protectedWrite.data)).toBe(201);
      const read = await request('GET', '/api/resources/provider_credentials/first', undefined, token);
      expect(read.status, JSON.stringify(read.data)).toBe(200);
      if (tenancy === 'single') {
        const other = await request('POST', '/auth/login', { username: 'projection-user-0', password });
        expect(other.status).toBe(200);
        const forbidden = await request('PATCH', '/api/resources/provider_credentials/first', { label: 'Must not overwrite' }, other.data.accessToken);
        expect(forbidden.status).toBe(403);
      }

      const unauthenticated = await request('POST', '/api/resources/provider_credentials', { credential_id: 'forbidden', label: 'Must not persist' });
      expect(unauthenticated.status).toBe(401);
      expect((await request('POST', '/auth/login', { username: 'projection-owner', password: 'Definitely-wrong-password' })).status).toBe(401);
      const login = await request('POST', '/auth/login', { username: 'projection-owner', password });
      expect(login.status, JSON.stringify(login.data)).toBe(200);
      const refresh = await request('POST', '/auth/refresh', { refreshToken: login.data.refreshToken });
      expect(refresh.status, JSON.stringify(refresh.data)).toBe(200);
      const logout = await request('POST', '/auth/logout', { refreshToken: refresh.data.refreshToken }, refresh.data.accessToken);
      expect(logout.status).toBe(200);
      const revoked = await request('POST', '/api/resources/provider_credentials', { credential_id: 'revoked', label: 'Must not persist' }, refresh.data.accessToken);
      expect(revoked.status).toBe(401);
    } finally { try { await app?.stop(true); } finally { await rm(root, { recursive: true, force: true }); } }
  }, 45_000);
}
