/** Real managed createApp + native Guardian + scoped facade + real isolated task child. Synthetic/private only. */
import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../frontend/server/app-factory';
import { defineEndpoint } from '../frontend/server/server-extensions';
import { resolveConfig, type AppConfig } from '../frontend/server/types';
import { tasks, sumTask } from './test-support/worker-entry';
import { ownedWorkerFixture } from './test-support/owned-fixture';

const launch = { kind: 'source' as const, entrypoint: fileURLToPath(new URL('./test-support/worker-entry.ts', import.meta.url)) };

test('disabled workers are null and invalid worker configuration cannot enable an unauthenticated service', () => {
  const base = { db: { mode: 'memory' as const }, tables: {}, ai: false as const, email: false as const, observability: false as const };
  expect(resolveConfig(base).workers).toBe(false);
  expect(() => resolveConfig({ ...base, auth: false, workers: { tasks, launch } })).toThrow('Guardian');
  expect(() => resolveConfig({ ...base, auth: true, workers: { tasks, launch, processes: 0 } })).toThrow();
});

test('native requests execute registered tasks through zero.workers, enforce task access and close the owned process', async () => {
  const fixture = await ownedWorkerFixture('managed'), root = fixture.root;
  let app: Awaited<ReturnType<typeof createApp>> | null = null, stopped = false;
  try {
    const config: AppConfig = { projectRoot: root, db: { mode: 'memory' }, tables: {},
      auth: { bootstrap: 'public', registration: { mode: 'public' }, accountEmails: { passwordReset: false } },
      workers: { tasks, launch, processes: 1 },
      appDir: join(root, 'app'), outDir: join(root, 'out'), storageDir: join(root, 'storage'),
      workflows: false, ai: false, email: false, vector: false, kv: false, pdf: false, observability: false,
      serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false,
      serverEndpointsDir: false, serverRoutesDir: false, resourceRoutes: false,
      serverExtensions: [defineEndpoint({ method: 'POST', path: '/api/worker-proof', auth: 'user',
        handler: async ({ zero }) => ({ result: await zero.workers!.run('fixture.echo', { synthetic: true }) }) }),
      defineEndpoint({ method: 'POST', path: '/api/worker-sum', auth: 'user',
        handler: async ({ zero }) => { const result: number = await zero.workers!.run(sumTask, [12, 25, 8]); return { result }; } })],
    };
    app = await createApp(config); app.listen(0);
    const url = 'http://127.0.0.1:' + app.server!.port;
    const register = async (username: string) => {
      const response = await fetch(url + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email: username + '@example.test', password: 'Synthetic-Worker-Password-94!' }) });
      expect(response.status).toBe(200); return await response.json() as { accessToken: string };
    };
    const owner = await register('worker-owner');
    const response = await fetch(url + '/api/worker-proof', { method: 'POST', headers: { Authorization: 'Bearer ' + owner.accessToken } });
    expect(response.status).toBe(200);
    const result = await response.json() as { result: { input: { synthetic: boolean }; pid: number } };
    expect(result.result.input).toEqual({ synthetic: true }); expect(result.result.pid).not.toBe(process.pid);
    const sum = await fetch(url + '/api/worker-sum', { method: 'POST', headers: { Authorization: 'Bearer ' + owner.accessToken } });
    expect(sum.status).toBe(200); expect(await sum.json()).toEqual({ result: 45 });
    const member = await register('worker-member');
    const denied = await fetch(url + '/api/worker-proof', { method: 'POST', headers: { Authorization: 'Bearer ' + member.accessToken } });
    expect(denied.status).toBe(403);
    expect((await denied.json() as { code: string }).code).toBe('FORBIDDEN');
    const anonymous = await fetch(url + '/api/worker-proof', { method: 'POST' });
    expect(anonymous.status).toBe(401);
    await app.stop(true); stopped = true;
  } finally {
    if (app && !stopped) { await app.stop(true); stopped = true; }
    // createApp owns failed-construction teardown. Never delete a live fixture.
    if (!app || stopped) await fixture.cleanup();
  }
}, 120_000);
