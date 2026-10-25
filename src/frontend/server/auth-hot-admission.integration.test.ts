/** Real managed hot/on-write Fabric, active outbox, and login without replay/retry. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApp } from './app-factory';
import { authenticatedOnly, defineResource, tenantRealm } from '../../resources';
import { realm, tables } from './test-fixtures/auth-admission-hot/realm';
import { defineZeroPlugin } from './server-extensions';
import type { LoggingRuntime } from '../../logging/logging-runtime';

test('populated hot actors and outbox work admit repeated login, refresh and protected reads without retries', async () => {
  const scratch = Bun.env.PROJECT_SCRATCH_DIR ?? tmpdir();
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'auth-hot-admission-'));
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  let logger: LoggingRuntime | null = null;
  const started = performance.now(), stages: unknown[] = [];
  const mark = (stage: string) => stages.push({ stage, elapsedMs: Math.round(performance.now() - started), sources: logger?.diagnostics().fabricSources });
  try {
    await mkdir(join(root, 'app'));
    app = await createApp({
      db: { mode: 'file', path: join(root, 'application.db') },
      systemDb: { mode: 'file', path: join(root, 'system.db'), synchronous: 'FULL' }, tables,
      resources: Object.keys(tables).map(table => defineResource({ table, exposure: 'all', realm: tenantRealm(), policy: authenticatedOnly() })),
      auth: { bootstrap: 'public', registration: { mode: 'public' }, tenancy: 'multi', accountEmails: { passwordReset: false } },
      databaseTopology: { mode: 'multiple', rootDirectory: join(root, 'fabric'), realm,
        tenantIsolation: 'tenant-database', placement: 'hot', readers: false, sweepIntervalMs: false,
        operationTimeoutMs: 20_000,
        actors: { launch: { kind: 'source', entrypoint: fileURLToPath(new URL('./test-fixtures/auth-admission-hot/actor.ts', import.meta.url)) } },
      },
      appDir: join(root, 'app'), outDir: join(root, 'out'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
      serverEndpointsDir: fileURLToPath(new URL('./test-fixtures/auth-admission-hot/endpoints', import.meta.url)),
      serverRoutesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverResourcesDir: false,
      workflows: false, email: false, stateSync: false, ai: false, vector: false, pdf: false, kv: false,
      observability: { console: false, endpoint: false },
      logging: { preset: 'activity', rootDirectory: join(root, 'logging') },
      serverExtensions: [defineZeroPlugin({ name: 'logging-qualification', setup({ zero }) { logger = zero.logging; } })],
    });
    mark('constructed');
    app.listen({ hostname: '127.0.0.1', port: 0 });
    const origin = `http://127.0.0.1:${app.server!.port}`;
    async function request(path: string, body?: unknown, token?: string) {
      const response = await fetch(`${origin}${path}`, { method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      const value = await response.json() as any;
      expect(response.status, `${path}: ${JSON.stringify(value)}`).toBe(200);
      return value;
    }
    const username = 'hot-proof-owner', password = 'Hot-test-password-123';
    const owner = await request('/auth/register', { username, email: 'hot-proof@example.test', password, organizationName: 'Hot proof' });
    mark('registered');
    expect(await request('/proof/seed', {}, owner.accessToken)).toEqual({
      kind: 'command', name: 'proof.seed', output: { functions: 51, invocations: 768, history: 19_448 },
    });
    mark('seeded');

    // Each real actor work item owns shared authority until its reply settles.
    // Release it only after a competing auth request has had time to queue.
    let sequence = 0;
    async function withBusyActor<T>(operation: () => Promise<T>): Promise<T> {
      const key = `busy-${sequence++}`, enteredPath = join(root, `${key}.entered`), releasePath = join(root, `${key}.release`);
      const work = request('/proof/work', { enteredPath, releasePath, key }, owner.accessToken);
      const deadline = Date.now() + 5_000;
      while (!(await Bun.file(enteredPath).exists()) && Date.now() < deadline) await Bun.sleep(5);
      expect(await Bun.file(enteredPath).exists()).toBe(true);
      const release = setTimeout(() => { void writeFile(releasePath, 'release'); }, 200);
      try {
        const started = performance.now();
        const result = await operation();
        expect(performance.now() - started, 'Auth must not wait for the historical audit backlog.').toBeLessThan(2000);
        return result;
      }
      finally { clearTimeout(release); await writeFile(releasePath, 'release'); await work; }
    }
    for (let i = 0; i < 8; i++) {
      const signedIn = await withBusyActor(() => request('/auth/login', { username, password }));
      expect(signedIn.user.userId).toBe(owner.user.userId);
      const renewed = await withBusyActor(() => request('/auth/refresh', { refreshToken: signedIn.refreshToken }));
      expect(renewed.refreshToken).not.toBe(signedIn.refreshToken);
      await request('/api/resources/functions?limit=1', undefined, renewed.accessToken);
      mark('auth-cycle-' + i);
    }
    const denied = await fetch(`${origin}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'wrong-password' }) });
    expect(denied.status).toBe(401);
    expect((await denied.json() as { code: string }).code).toBe('INVALID_CREDENTIALS');
    // This case now also durably captures the 20,267 seeded mutations. Give
    // background disk work its own budget; auth above keeps a separate strict
    // latency assertion rather than inheriting the backlog-drain allowance.
    const deadline = Date.now() + 45_000;
    let counts = await request('/proof/counts', undefined, owner.accessToken);
    while (counts.deliveries < 51 && Date.now() < deadline) {
      await Bun.sleep(100); counts = await request('/proof/counts', undefined, owner.accessToken);
    }
    mark('deliveries-checked');
    expect(counts, JSON.stringify(stages)).toEqual({ functions: 51, invocations: 768, history: 19_448, deliveries: 51 });
  } finally {
    mark('before-stop');
    try { await app?.stop(true); }
    finally {
      mark('stopped');
      if (Bun.env.ZERO_LOGGING_QUALIFICATION_REPORT) await Bun.write(Bun.env.ZERO_LOGGING_QUALIFICATION_REPORT, JSON.stringify(stages, null, 2));
      await rm(root, { recursive: true, force: true });
    }
  }
}, 90_000);
