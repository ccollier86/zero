import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createPlatformSQLiteService } from '../../persistence';
import type { PlatformSQLiteService } from '../../persistence';
import { databaseAuthorityCommitFencePath } from '../../databases';
import { createApp } from './app-factory';

describe('createApp system database runtime', () => {
  const roots: string[] = [];

  afterEach(async () => {
    for (const root of roots.splice(0).reverse()) {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('runs platform migrations only on system while app tables stay on db', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zero-system-runtime-'));
    roots.push(root);
    const appDir = join(root, 'app');
    await mkdir(appDir, { recursive: true });
    const appSqlite = createPlatformSQLiteService({
      mode: 'file',
      path: join(root, 'application.db'),
    });
    const systemSqlite = createPlatformSQLiteService({
      mode: 'file',
      path: join(root, 'system.db'),
    });

    const app = await createApp({
      db: { sqlite: appSqlite },
      systemDb: { sqlite: systemSqlite },
      tables: {
        todos: {
          id: 'text primary key',
          title: 'text not null',
        },
      },
      auth: false,
      stateSync: false,
      serverResourcesDir: false,
      serverPluginsDir: false,
      serverMiddlewareDir: false,
      serverEndpointsDir: false,
      serverRoutesDir: false,
      appDir,
      outDir: join(root, 'out'),
      generatedDir: join(root, '.zero', 'generated'),
      observability: false,
      ai: false,
      vector: false,
      pdf: false,
      kv: false,
    });

    try {
      app.listen(0);
      expect(hasTable(appSqlite, 'todos')).toBe(true);
      expect(hasTable(appSqlite, 'users')).toBe(false);
      expect(hasTable(appSqlite, '_zero_migrations')).toBe(false);
      expect(hasTable(appSqlite, '_zero_sync_table_modes')).toBe(false);

      expect(hasTable(systemSqlite, 'todos')).toBe(false);
      expect(hasTable(systemSqlite, 'users')).toBe(true);
      expect(hasTable(systemSqlite, '_zero_migrations')).toBe(true);
      expect(hasTable(systemSqlite, '_zero_sync_table_modes')).toBe(true);
    } finally {
      await app.stop(true);
      appSqlite.close();
      systemSqlite.close();
    }
  }, 20_000);

  test('owns a privacy-empty cross-process authority fence only for file Guardian', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zero-system-authority-fence-'));
    roots.push(root);
    const appDir = join(root, 'app');
    const appPath = join(root, 'application.db');
    const systemPath = join(root, 'system.db');
    const fencePath = databaseAuthorityCommitFencePath(systemPath);
    await mkdir(appDir, { recursive: true });
    const appSqlite = createPlatformSQLiteService({ mode: 'file', path: appPath });
    const systemSqlite = createPlatformSQLiteService({ mode: 'file', path: systemPath });

    const app = await createApp({
      db: { sqlite: appSqlite },
      systemDb: { sqlite: systemSqlite },
      tables: {},
      auth: true,
      stateSync: false,
      serverResourcesDir: false,
      serverPluginsDir: false,
      serverMiddlewareDir: false,
      serverEndpointsDir: false,
      serverRoutesDir: false,
      appDir,
      outDir: join(root, 'out'),
      generatedDir: join(root, '.zero', 'generated'),
      observability: false,
      email: false,
      ai: false,
      vector: false,
      pdf: false,
      kv: false,
    });

    try {
      app.listen(0);
      expect(existsSync(fencePath)).toBe(true);
      expect(existsSync(databaseAuthorityCommitFencePath(appPath))).toBe(false);
    } finally {
      await app.stop(true);
      appSqlite.close();
      systemSqlite.close();
    }

    const fence = new Database(fencePath, { strict: true });
    try {
      const tables = fence.query(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      ).all() as Array<{ name: string }>;
      expect(tables.map((row) => row.name)).toEqual([
        '_zero_authority_commit_fence',
      ]);
    } finally {
      fence.close();
    }
  }, 20_000);

  test('keeps Guardian, API-key, state, and built-in service data on system', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zero-system-services-'));
    roots.push(root);
    const appDir = join(root, 'app');
    await mkdir(appDir, { recursive: true });
    const appSqlite = createPlatformSQLiteService({ mode: 'ephemeral' });
    const systemSqlite = createPlatformSQLiteService({ mode: 'ephemeral' });
    const app = await createApp({
      db: { sqlite: appSqlite },
      systemDb: { sqlite: systemSqlite },
      tables: {
        todos: {
          id: 'text primary key',
          title: 'text not null',
        },
      },
      auth: { apiKeys: true },
      stateSync: true,
      migrate: false,
      serverResourcesDir: false,
      serverPluginsDir: false,
      serverMiddlewareDir: false,
      serverEndpointsDir: false,
      serverRoutesDir: false,
      appDir,
      outDir: join(root, 'out'),
      generatedDir: join(root, '.zero', 'generated'),
      storageDir: join(root, 'storage'),
      observability: false,
      email: false,
      ai: false,
      vector: false,
      pdf: false,
      kv: false,
    });

    try {
      app.listen(0);
      expect(hasTable(appSqlite, 'todos')).toBe(true);
      expect(hasTable(systemSqlite, 'todos')).toBe(false);

      for (const table of systemServiceTables()) {
        expect(hasTable(systemSqlite, table)).toBe(true);
        expect(hasTable(appSqlite, table)).toBe(false);
      }
    } finally {
      await app.stop(true);
      appSqlite.close();
      systemSqlite.close();
    }
  }, 20_000);

  test('allows an auth-disabled app to own an existing users table', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zero-system-app-users-'));
    roots.push(root);
    const appDir = join(root, 'app');
    await mkdir(appDir, { recursive: true });
    const appSqlite = createPlatformSQLiteService({
      mode: 'file',
      path: join(root, 'application.db'),
    });
    const systemSqlite = createPlatformSQLiteService({
      mode: 'file',
      path: join(root, 'system.db'),
    });
    appSqlite.raw.run(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL
      )
    `);

    const app = await createApp({
      db: { sqlite: appSqlite },
      systemDb: { sqlite: systemSqlite },
      tables: {
        users: {
          id: 'text primary key',
          display_name: 'text not null',
        },
      },
      auth: false,
      stateSync: false,
      serverResourcesDir: false,
      serverPluginsDir: false,
      serverMiddlewareDir: false,
      serverEndpointsDir: false,
      serverRoutesDir: false,
      appDir,
      outDir: join(root, 'out'),
      generatedDir: join(root, '.zero', 'generated'),
      observability: false,
      ai: false,
      vector: false,
      pdf: false,
      kv: false,
    });

    try {
      app.listen(0);
      expect(hasTable(appSqlite, 'users')).toBe(true);
      expect(appSqlite.raw.query('PRAGMA table_info("users")').all())
        .toHaveLength(2);
    } finally {
      await app.stop(true);
      appSqlite.close();
      systemSqlite.close();
    }
  }, 20_000);

  test('does not publish Zero-owned system tables when auth is disabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zero-system-authless-sync-'));
    roots.push(root);
    const appDir = join(root, 'app');
    const pluginsDir = join(root, 'server', 'plugins');
    await mkdir(appDir, { recursive: true });
    await mkdir(pluginsDir, { recursive: true });
    const extensionModule = pathToFileURL(
      join(import.meta.dir, 'server-extensions.ts'),
    ).href;
    await writeFile(join(pluginsDir, 'system-fixture.ts'), `
      import { defineZeroPlugin } from ${JSON.stringify(extensionModule)};
      export default defineZeroPlugin({
        name: 'authless-system-sync-fixture',
        setup({ zero }) {
          if (!zero.system) throw new Error('System database unavailable');
          zero.system.db.defineTable('notifications', {
            notification_id: 'text primary key',
            secret: 'text not null',
          });
          zero.system.db.insert('notifications', {
            notification_id: 'private-system-row',
            secret: 'must-not-sync',
          });
        },
      });
    `);
    const appSqlite = createPlatformSQLiteService({ mode: 'ephemeral' });
    const systemSqlite = createPlatformSQLiteService({ mode: 'ephemeral' });
    const app = await createApp({
      db: { sqlite: appSqlite },
      systemDb: { sqlite: systemSqlite },
      tables: { todos: { id: 'text primary key' } },
      auth: false,
      stateSync: false,
      migrate: false,
      serverResourcesDir: false,
      serverPluginsDir: pluginsDir,
      serverMiddlewareDir: false,
      serverEndpointsDir: false,
      serverRoutesDir: false,
      appDir,
      outDir: join(root, 'out'),
      generatedDir: join(root, '.zero', 'generated'),
      observability: false,
      ai: false,
      vector: false,
      pdf: false,
      kv: false,
    });
    let socket: WebSocket | null = null;

    try {
      app.listen(0);
      const connection = await connectSyncSocket(
        `ws://${app.server!.hostname}:${app.server!.port}/sync`,
      );
      socket = connection.ws;
      socket.send(JSON.stringify({
        type: 'sync.subscribe',
        tables: ['notifications'],
        snapshot: ['notifications'],
        lastSeq: 0,
      }));
      const snapshot = await connection.waitForMessage(
        (message) => message.type === 'sync.snapshot',
      );
      expect(snapshot).toMatchObject({ type: 'sync.snapshot', tables: {} });
      expect(snapshot).not.toHaveProperty('plane', 'system');
      await Bun.sleep(25);
      expect(connection.messages.some((message) =>
        message.plane === 'system'
        || (message.type === 'sync.snapshot'
          && Object.hasOwn(message.tables ?? {}, 'notifications')))).toBe(false);
    } finally {
      socket?.close();
      await app.stop(true);
      appSqlite.close();
      systemSqlite.close();
    }
  }, 20_000);
});

function hasTable(sqlite: PlatformSQLiteService, table: string): boolean {
  return Boolean(sqlite.raw.query(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
  ).get(table));
}

function systemServiceTables(): readonly string[] {
  return [
    'users',
    '_auth_api_keys',
    '_zero_action_tokens',
    '_zero_resume_tokens',
    '_user_state',
    'notifications',
    'notification_receipts',
    'rooms',
    'room_members',
    'storage_drives',
    'storage_objects',
    '_storage_blobs',
    '_storage_permissions',
    'workflow_definitions',
    'workflow_instances',
    'workflow_steps',
    'workflow_events',
    '_workflow_execution_authorities',
    '_workflow_step_executions',
  ];
}

async function connectSyncSocket(url: string) {
  type Message = {
    type?: string;
    plane?: string;
    tables?: Record<string, unknown>;
  };
  const messages: Message[] = [];
  const waiters: Array<{
    predicate: (message: Message) => boolean;
    resolve: (message: Message) => void;
  }> = [];
  const ws = new WebSocket(url);
  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    const message = JSON.parse(event.data) as Message;
    messages.push(message);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index]!;
      if (!waiter.predicate(message)) continue;
      waiters.splice(index, 1);
      waiter.resolve(message);
    }
  };
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('Sync WebSocket failed to open'));
  });
  return {
    ws,
    messages,
    waitForMessage(predicate: (message: Message) => boolean, timeoutMs = 3_000) {
      const current = messages.find(predicate);
      if (current) return Promise.resolve(current);
      return new Promise<Message>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Timed out waiting for Sync message')),
          timeoutMs,
        );
        waiters.push({
          predicate,
          resolve(message) {
            clearTimeout(timer);
            resolve(message);
          },
        });
      });
    },
  };
}
