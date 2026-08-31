import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { getAuthEmailOutbox, getAuthStore } from '../../auth/auth.plugin';
import { stopAuthRuntime } from '../../auth/auth-runtime';
import type { EmailProvider } from '../../email';
import { OBS_CODES, MemoryEventStore } from '../../observability';
import { createPlatformSQLiteService, getPlatformSQLiteService } from '../../persistence';
import { getSyncDB } from '../../sync/sync.plugin';
import { createApp } from './app-factory';
import type { AppConfig } from './types';
describe('createApp shutdown ownership', () => {
  test('joins auth delivery before disposing ReactiveDB and owned SQLite', async () => {
    const events = new MemoryEventStore();
    let providerStarted!: () => void;
    const started = new Promise<void>((resolve) => { providerStarted = resolve; });
    let disposed = false, disposedAtAbort: boolean | null = null, aborts = 0;
    const provider: EmailProvider = { name: 'shutdown-probe', send(message) {
      providerStarted();
      return new Promise((_, reject) => message.signal?.addEventListener('abort', () => {
        aborts += 1; disposedAtAbort = disposed; reject(new Error('aborted'));
      }, { once: true }));
    } };
    const root = await testRoot('owned-shutdown');
    let app: Awaited<ReturnType<typeof createApp>> | null = null;
    try {
      app = await createApp(testConfig(root, {
        email: { from: 'Zero <noreply@test.com>', provider },
        observability: { console: false, store: events },
      }));
      const db = getSyncDB()!;
      const dispose = db.dispose.bind(db);
      db.dispose = () => { disposed = true; dispose(); };
      const sqlite = getPlatformSQLiteService()!;
      const close = sqlite.close.bind(sqlite);
      let closeCalls = 0, disposedAtClose = false;
      sqlite.close = () => { closeCalls += 1; disposedAtClose = disposed; close(); };
      app.listen(0);
      const response = await fetch(`http://localhost:${app.server!.port}/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'shutdown', email: 'shutdown@test.com',
          password: 'password123' }),
      });
      expect(response.status).toBe(200);
      expect(getAuthStore()).not.toBeNull();
      getAuthEmailOutbox()!.enqueue({ kind: 'password_reset', recipient: 'shutdown@test.com' });
      await started;
      await Promise.all([app.stop(), app.stop()]);
      await app.stop();
      app = null;
      await stopAuthRuntime();
      expect(aborts).toBe(1);
      expect(disposedAtAbort === false).toBeTrue();
      expect(disposed).toBeTrue();
      expect(closeCalls).toBe(1);
      expect(disposedAtClose).toBeTrue();
      const stopped = events.query({ code: OBS_CODES.AUTH_STOPPED.code }).events;
      expect(stopped).toHaveLength(1);
      expect(events.query({
        code: OBS_CODES.AUTH_EMAIL_OUTBOX_WORKER_FAILED.code,
      }).events.map((event) => event.metadata)).toEqual([]);
    } finally {
      if (app) await app.stop();
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
  test('does not close an injected SQLite service', async () => {
    const root = await testRoot('external-shutdown');
    const sqlite = createPlatformSQLiteService({ mode: 'ephemeral' });
    const close = sqlite.close.bind(sqlite);
    let closeCalls = 0;
    sqlite.close = () => { closeCalls += 1; close(); };
    let app: Awaited<ReturnType<typeof createApp>> | null = null;
    try {
      app = await createApp(testConfig(root, { db: { sqlite }, auth: false, email: false }));
      app.listen(0); await app.stop(); app = null;
      expect(closeCalls).toBe(0);
      expect(sqlite.raw.query('SELECT 1 AS value').get()).toEqual({ value: 1 });
    } finally {
      if (app) await app.stop();
      if (closeCalls === 0) close();
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
async function testRoot(name: string): Promise<string> {
  await mkdir(join(process.cwd(), '.zero'), { recursive: true });
  const root = await mkdtemp(join(process.cwd(), `.zero/${name}-`));
  await mkdir(join(root, 'app'), { recursive: true });
  return root;
}

function testConfig(root: string, overrides: Partial<AppConfig>): AppConfig {
  return { app: { publicUrl: 'https://app.test' }, db: { mode: 'memory' as const },
    tables: {}, auth: true, appDir: join(root, 'app'), outDir: join(root, 'out'), migrate: false,
    serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false,
    serverEndpointsDir: false, serverRoutesDir: false, resourceRoutes: false,
    ai: false, vector: false, pdf: false, kv: false, email: false, ...overrides };
}
