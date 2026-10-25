import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticatedOnly, defineResource, tenantRealm } from '../../resources';
import { createApp } from './app-factory';
import { realm, tables } from './test-fixtures/application-data/realm';

for (const mode of ['ephemeral', 'file', 'hot', 'tenant-file'] as const) {
  test(`managed ${mode}: same public data API, isolated system plane, receipts and live authority`, async () => {
    const root = await mkdtemp(join(process.env.PROJECT_SCRATCH_DIR ?? tmpdir(), 'zero-app-data-proof-'));
    let app: Awaited<ReturnType<typeof createApp>> | undefined;
    try {
      await mkdir(join(root, 'app'));
      app = await createApp({
        projectRoot: root,
        db: mode === 'ephemeral' ? { mode: 'memory' } : mode === 'hot'
          ? { mode: 'hot', path: join(root, 'app.db'), snapshotPath: join(root, 'app.snapshot.db') }
          : { mode: 'file', path: join(root, 'app.db') },
        systemDb: mode === 'ephemeral' ? { mode: 'memory' } : { mode: 'file', path: join(root, 'system.db') },
        tables, dataRealm: realm,
        auth: { bootstrap: 'public', registration: { mode: 'public' }, tenancy: mode === 'tenant-file' ? 'multi' : 'single', accountEmails: { passwordReset: false } },
        ...(mode === 'tenant-file' ? {
          resources: [defineResource({ table: 'notes', exposure: 'all', realm: tenantRealm(), policy: authenticatedOnly() })],
          databaseTopology: { mode: 'multiple' as const, rootDirectory: join(root, 'fabric'), realm, tenantIsolation: 'tenant-database' as const,
            readers: false as const, sweepIntervalMs: false as const,
            actors: { launch: { kind: 'source' as const, entrypoint: fileURLToPath(new URL('./test-fixtures/application-data/actor.ts', import.meta.url)) } } },
        } : {}),
        appDir: join(root, 'app'), outDir: join(root, 'out'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
        serverEndpointsDir: fileURLToPath(new URL('./test-fixtures/application-data/endpoints', import.meta.url)),
        serverRoutesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverResourcesDir: false,
        workflows: false, email: false, stateSync: false, ai: false, vector: false, pdf: false, kv: false,
        observability: { console: false, endpoint: false },
      });
      app.listen({ hostname: '127.0.0.1', port: 0 });
      const base = `http://127.0.0.1:${app.server!.port}`;
      const request = async (method: string, path: string, body?: object, token?: string) => {
        const response = await fetch(base + path, { method, headers: {
          'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
        }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, data: await response.json() as any };
      };
      const registered = await request('POST', '/auth/register', {
        username: 'data-owner', email: 'owner@example.test', password: 'Synthetic-only-password-123',
        ...(mode === 'tenant-file' ? { organizationName: 'Synthetic tenant' } : {}),
      });
      expect(registered.status, JSON.stringify(registered.data)).toBe(200);
      const token = registered.data.accessToken;
      expect((await request('GET', '/proof/count')).status).toBe(401);
      const seeded = await request('POST', '/proof/seed', {}, token);
      expect(seeded.status, JSON.stringify(seeded.data)).toBe(200);
      expect(seeded.data).toMatchObject({ value: { kind: 'command', name: 'notes.seed', output: { total: 25 } }, replayed: false });
      expect((await request('POST', '/proof/seed', {}, token)).data).toMatchObject({ value: { kind: 'command', output: { total: 25 } }, replayed: true });
      const page = await request('GET', '/proof/page', undefined, token);
      expect(page.status, JSON.stringify(page.data)).toBe(200);
      expect(page.data.total).toBe(25);
      expect(page.data.rows.map((r: { id: string }) => r.id)).toEqual(['010', '011', '012', '013', '014']);
      expect((await request('GET', '/proof/count', undefined, token)).data).toEqual({ total: 25 });
      const logout = await request('POST', '/auth/logout', { refreshToken: registered.data.refreshToken }, token);
      expect(logout.status).toBe(200);
      expect((await request('GET', '/proof/count', undefined, token)).status).toBe(401);
    } finally { try { await app?.stop(true); } finally { await rm(root, { recursive: true, force: true }); } }
  }, 45_000);
}
