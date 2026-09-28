import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import type { EmailProvider } from '../../email';
import { OBS_CODES, MemoryEventStore } from '../../observability';
import { createPlatformSQLiteService } from '../../persistence';
import type { ReactiveDB } from '../../sync/reactive-db';
import { createApp } from './app-factory';
import type { AppConfig } from './types';

interface DatabaseProbe {
  path: string;
  read(): ReactiveDB | null;
}

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
      const databaseProbe = installDatabaseProbe(app);
      app.listen(0);
      const db = await waitForDatabase(app, databaseProbe);
      const dispose = db.dispose.bind(db);
      db.dispose = () => { disposed = true; dispose(); };
      const sqlite = db.getSQLiteService();
      if (!sqlite) throw new Error('Owned SQLite service was not attached to Sync');
      const close = sqlite.close.bind(sqlite);
      let closeCalls = 0, disposedAtClose = false;
      sqlite.close = () => { closeCalls += 1; disposedAtClose = disposed; close(); };
      const response = await fetch(`http://localhost:${app.server!.port}/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'shutdown', email: 'shutdown@test.com',
          password: 'password123' }),
      });
      expect(response.status).toBe(200);
      const reset = await fetch(`http://localhost:${app.server!.port}/auth/forgot-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'shutdown@test.com' }),
      });
      expect(reset.status).toBe(200);
      await started;
      await Promise.all([app.stop(), app.stop()]);
      await app.stop();
      app = null;
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

function installDatabaseProbe(
  app: Awaited<ReturnType<typeof createApp>>,
): DatabaseProbe {
  const path = `/__zero_test/database-${crypto.randomUUID()}`;
  let db: ReactiveDB | null = null;
  app.get(path, (context) => {
    db = (context as unknown as { syncDB?: ReactiveDB }).syncDB ?? null;
    return { ready: db !== null };
  });
  return { path, read: () => db };
}

async function waitForDatabase(
  app: Awaited<ReturnType<typeof createApp>>,
  probe: DatabaseProbe,
): Promise<ReactiveDB> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await fetch(`http://localhost:${app.server!.port}${probe.path}`);
    await response.arrayBuffer();
    const db = probe.read();
    if (db) return db;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('App-local Sync database did not start');
}

async function testRoot(name: string): Promise<string> {
  await mkdir(join(process.cwd(), '.zero'), { recursive: true });
  const root = await mkdtemp(join(process.cwd(), `.zero/${name}-`));
  await mkdir(join(root, 'app'), { recursive: true });
  return root;
}

function testConfig(root: string, overrides: Partial<AppConfig>): AppConfig {
  return { app: { publicUrl: 'https://app.test' }, db: { mode: 'memory' as const },
    tables: {}, auth: { bootstrap: 'public' }, appDir: join(root, 'app'), outDir: join(root, 'out'), migrate: false,
    serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false,
    serverEndpointsDir: false, serverRoutesDir: false, resourceRoutes: false,
    ai: false, vector: false, pdf: false, kv: false, email: false, ...overrides };
}
