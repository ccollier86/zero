/** Managed private artifacts, durable jobs and independent download authorization with synthetic file-backed state. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app-factory';
import { defineZeroPlugin } from './server-extensions';
import type { ServerRouteServices } from './server-services';

test('managed exports persist privately, deduplicate retries, verify exact bytes and reauthorize every download', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logging-export-api-')); let app: Awaited<ReturnType<typeof createApp>> | undefined, services: ServerRouteServices | null = null;
  try {
    await mkdir(join(root, 'app'));
    app = await createApp({ projectRoot: root, db: { mode: 'file', path: join(root, 'application.db') }, systemDb: { mode: 'file', path: join(root, 'system.db') },
      tables: {}, auth: { bootstrap: 'public', registration: { mode: 'public' }, accountEmails: { passwordReset: false } }, logging: { preset: 'detailed', rootDirectory: 'logging' },
      workflows: false, email: false, ai: false, vector: false, kv: false, pdf: false, appDir: join(root, 'app'), outDir: join(root, 'build'),
      generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'), themeFoundation: 'legacy',
      frontendBuild: { version: 1, frontend: { themeFoundation: 'legacy', plugins: {} }, pluginIdentities: {} }, migrate: false,
      serverPluginsDir: false, serverResourcesDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false, resourceRoutes: false,
      observability: { console: false }, serverExtensions: [defineZeroPlugin({ name: 'export-fixture', setup({ zero }) { services = zero; } })] });
    app.listen({ hostname: '127.0.0.1', port: 0 }); const origin = `http://127.0.0.1:${app.server!.port}`;
    const call = (path: string, body: unknown, token?: string) => fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
    const register = async (name: string) => {
      const response = await call('/auth/register', { username: name, email: name + '@example.test', password: 'Fixture-password-123!' });
      expect(response.status).toBe(200); return await response.json() as any;
    };
    const owner = await register('export-owner'), user = await register('export-user');
    await services!.logging!.flush();
    const request = { id: 'export.fixture-one', stream: 'audit', query: { family: 'security', highWaterOrdinal: Number.MAX_SAFE_INTEGER } };
    expect((await call('/api/_zero/logging/exports/create', request, user.accessToken)).status).toBe(403);
    const created = await call('/api/_zero/logging/exports/create', request, owner.accessToken), value = await created.json() as any;
    expect(created.status, JSON.stringify(value)).toBe(200);
    expect(value.state, JSON.stringify(value)).toBe('ready'); expect(value.count).toBeGreaterThan(0);
    expect(value.highWaterOrdinal).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(value.sha256).toMatch(/^[a-f0-9]{64}$/);
    const duplicate = await call('/api/_zero/logging/exports/create', request, owner.accessToken);
    expect(duplicate.status, await duplicate.clone().text()).toBe(200); expect(await duplicate.json()).toEqual(value);
    const status = await call('/api/_zero/logging/exports/status', { id: request.id }, owner.accessToken);
    expect(status.status).toBe(200); expect(await status.json()).toEqual(value);
    const download = await call('/api/_zero/logging/exports/download', { id: request.id }, owner.accessToken);
    expect(download.status, download.status === 200 ? '' : await download.clone().text()).toBe(200);
    const bytes = new Uint8Array(await download.arrayBuffer());
    expect(new Bun.CryptoHasher('sha256').update(bytes).digest('hex')).toBe(value.sha256);
    const manifest = JSON.parse(new TextDecoder().decode(bytes).split('\n')[0]!).manifest;
    expect(manifest.count).toBe(value.count); expect(manifest.highWaterOrdinal).toBe(value.highWaterOrdinal);
    expect(services!.storage!.listDrives()).toEqual([]); expect(services!.system!.db.list('storage_objects')).toEqual([]);
    expect((await call('/api/_zero/logging/exports/download', { id: request.id }, user.accessToken)).status).toBe(403);
    services!.auth.store!.updateUser(owner.user.userId, { role: 'user' });
    expect((await call('/api/_zero/logging/exports/download', { id: request.id }, owner.accessToken)).status).toBe(403);
  } finally { await app?.stop(true); await rm(root, { recursive: true, force: true }); }
}, 60000);
