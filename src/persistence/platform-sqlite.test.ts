/**
 * platform-sqlite.test.ts
 *
 * Verifies the Zero SQLite persistence foundation. These tests own storage
 * mode behavior only; ReactiveDB integration is covered in later slices.
 */

import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';

import { DatabaseError } from '../databases/database-error';
import {
  MemoryEventStore,
  OBS_CODES,
  configureObservability,
  getObservabilityRuntime,
} from '../observability';
import { BufferPool } from './buffer-pool';
import { CheckpointManager } from './checkpoint-manager';
import { createPlatformSQLiteService } from './platform-sqlite';
import { SnapshotManager } from './snapshot-manager';
import { StatementCache } from './statement-cache';
import { resolveSQLiteStorageConfig } from './storage-config';
import type { DefaultPlatformSQLiteService } from './platform-sqlite';
import type {
  PlatformSQLiteDiagnostics,
  ResolvedSQLiteStorageConfig,
} from './storage-types';

let testDir: string | null = null;

describe('platform SQLite persistence', () => {
  afterEach(async () => {
    if (!testDir) return;
    await rm(testDir, { recursive: true, force: true });
    testDir = null;
  });

  it('preserves the four-argument SnapshotManager boolean contract', async () => {
    const dir = await createTestDir();
    const database = new Database(':memory:', { create: true });
    const manager = new SnapshotManager(
      database,
      path.join(dir, 'legacy.snapshot.db'),
      60_000,
      true,
    );
    try {
      expect(await manager.snapshot()).toBe(true);
      expect(manager.snapshotSync()).toBe(true);
    } finally {
      manager.stop();
      database.close();
    }

    const legacyResolved: ResolvedSQLiteStorageConfig = {
      mode: 'file',
      path: path.join(dir, 'legacy.db'),
      snapshotPath: null,
      snapshotEnabled: false,
      snapshotIntervalMs: 30_000,
      cacheSize: -262_144,
      mmapSize: 1_073_741_824,
      walAutocheckpoint: 1_000,
      pageSize: 4_096,
      synchronous: 'NORMAL',
      tempStore: 'MEMORY',
      busyTimeout: 5_000,
      statementCacheSize: 1_000,
      bufferPool: false,
    };
    const legacyDiagnostics: PlatformSQLiteDiagnostics = {
      mode: 'file',
      path: legacyResolved.path,
      snapshotPath: null,
      snapshotEnabled: false,
      statementCacheSize: 1_000,
      bufferPoolEnabled: false,
    };
    expect(legacyDiagnostics.snapshotEnabled).toBe(false);
  });

  it('keeps persistence telemetry app-local, suppressible, and privacy-safe', async () => {
    const dir = await createTestDir();
    const privatePath = path.join(dir, 'private-tenant-name.sqlite');
    const local = new MemoryEventStore();
    const ambient = new MemoryEventStore();
    const previousConfig = getObservabilityRuntime().config;
    configureObservability({ console: false, store: ambient });
    const observability = {
      sink: local,
      store: local,
      config: { console: false, store: local },
    } as const;

    try {
      const service = createPlatformSQLiteService({
        mode: 'file',
        path: privatePath,
      }, { observability });
      service.checkpoint!.checkpoint('PASSIVE');
      service.close();

      const localEvents = local.query({ limit: 100 }).events;
      expect(localEvents.map((event) => event.code)).toContain(
        OBS_CODES.PERSISTENCE_SQL_OPENED.code,
      );
      expect(localEvents.map((event) => event.code)).toContain(
        OBS_CODES.PERSISTENCE_SQL_CHECKPOINT_COMPLETED.code,
      );
      expect(localEvents.map((event) => event.code)).toContain(
        OBS_CODES.PERSISTENCE_SQL_CLOSED.code,
      );
      expect(JSON.stringify(localEvents)).not.toContain(privatePath);
      expect(ambient.query({ limit: 100 }).count).toBe(0);

      const beforeSuppressed = local.query({ limit: 100 }).count;
      const suppressed = createPlatformSQLiteService({
        mode: 'file',
        path: path.join(dir, 'suppressed.sqlite'),
        emitTelemetry: false,
      }, { observability });
      suppressed.checkpoint!.checkpoint('PASSIVE');
      suppressed.close();
      expect(local.query({ limit: 100 }).count).toBe(beforeSuppressed);

      const failing = new CheckpointManager({
        query() {
          throw new Error(`private SQLite failure at ${privatePath}`);
        },
      } as unknown as Database, 60_000, 'PASSIVE', { observability });
      expect(() => failing.checkpoint()).toThrow();
      const [failure] = local.query({
        code: OBS_CODES.PERSISTENCE_SQL_CHECKPOINT_FAILED.code,
      }).events;
      expect(failure?.error).toBeUndefined();
      expect(failure?.metadata).toEqual({ mode: 'PASSIVE' });
      expect(JSON.stringify(failure)).not.toContain(privatePath);
    } finally {
      configureObservability(previousConfig);
    }
  });

  it('fences periodic writes by published image capture time', async () => {
    const dir = await createTestDir();
    const database = new Database(':memory:', { create: true });
    database.run('CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT NOT NULL)');
    let now = 0;
    const manager = new SnapshotManager(
      database,
      path.join(dir, 'capture-time.snapshot.db'),
      100,
      true,
      {
        emitTelemetry: false,
        periodicTimeoutMs: 200,
        now: () => now,
      },
    );
    try {
      expect(manager.requiresPeriodicWriteFence()).toBe(true);
      expect(manager.snapshotSyncDetailed()).toEqual({
        status: 'written', durable: true,
      });
      now = 99;
      expect(manager.requiresPeriodicWriteFence()).toBe(false);
      now = 100;
      expect(manager.requiresPeriodicWriteFence()).toBe(true);
      now = 101;
      expect(manager.requiresPeriodicWriteFence()).toBe(true);

      now = 110;
      const slowSnapshot = manager.snapshotDetailed();
      now = 150;
      database.run("INSERT INTO items (id, name) VALUES ('later', 'not captured')");
      expect(await slowSnapshot).toEqual({ status: 'written', durable: true });
      now = 209;
      expect(manager.requiresPeriodicWriteFence()).toBe(false);
      now = 210;
      expect(manager.requiresPeriodicWriteFence()).toBe(true);
    } finally {
      manager.stop();
      database.close();
    }
  });

  it('keeps writes during snapshot I/O dirty until a covering image publishes', async () => {
    const dir = await createTestDir();
    const database = new Database(':memory:', { create: true });
    database.run('CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT NOT NULL)');
    const events: string[] = [];
    const manager = new SnapshotManager(
      database,
      path.join(dir, 'covering-generation.snapshot.db'),
      1_000,
      true,
      {
        emitTelemetry: false,
        periodicTimeoutMs: 2_000,
        onPeriodicDirty: () => events.push('dirty'),
        onPeriodicClean: () => events.push('clean'),
        onPeriodicStart: () => events.push('start'),
        onPeriodicFinish: () => events.push('finish'),
      },
    );
    try {
      expect(manager.snapshotSyncDetailed()).toMatchObject({ status: 'written' });
      database.run("INSERT INTO items (id, name) VALUES ('first', 'captured')");
      manager.recordPeriodicCommit();
      expect(events).toEqual(['dirty', 'start']);

      // The first async call has already serialized its image before yielding
      // to filesystem I/O. This later commit must force a second capture.
      database.run("INSERT INTO items (id, name) VALUES ('second', 'follow-up')");
      manager.recordPeriodicCommit();
      await waitForCondition(() => events.filter((event) => event === 'finish').length === 2);

      expect(events).toEqual([
        'dirty',
        'start',
        'finish',
        'start',
        'clean',
        'finish',
      ]);
      const restored = new Database(path.join(dir, 'covering-generation.snapshot.db'), {
        readonly: true,
      });
      try {
        expect(restored.query('SELECT COUNT(*) AS count FROM items').get())
          .toEqual({ count: 2 });
      } finally {
        restored.close();
      }
    } finally {
      manager.stop();
      database.close();
    }
  });

  it('retries abort cleanup without publishing hot startup state', async () => {
    const dir = await createTestDir();
    const snapshotPath = path.join(dir, 'discarded.snapshot.db');
    const service = createPlatformSQLiteService({
      mode: 'hot',
      path: path.join(dir, 'source.db'),
      snapshotPath,
      emitTelemetry: false,
    });
    service.raw.run('CREATE TABLE discarded (id TEXT PRIMARY KEY)');
    service.raw.run("INSERT INTO discarded (id) VALUES ('never-published')");
    const pendingSnapshot = service.snapshot!.snapshotDetailed();

    const originalClear = service.statements.clear.bind(service.statements);
    let clearAttempts = 0;
    service.statements.clear = () => {
      clearAttempts += 1;
      if (clearAttempts === 1) throw new Error('injected cache clear failure');
      originalClear();
    };

    expect(() => service.abort()).toThrow('SQLite startup state could not be discarded.');
    expect(await pendingSnapshot).toEqual({ status: 'superseded', durable: false });
    // The dependent raw handle remains usable so the failed cache cleanup can
    // be retried against its original SQLite authority.
    expect(service.raw.query('SELECT COUNT(*) AS count FROM discarded').get())
      .toEqual({ count: 1 });
    expect(existsSync(snapshotPath)).toBe(false);

    service.abort();
    expect(clearAttempts).toBe(2);
    expect(existsSync(snapshotPath)).toBe(false);
    expect(() => service.abort()).not.toThrow();
  });

  it('retries a failed deferred raw close instead of publishing service closure', () => {
    const events = new MemoryEventStore();
    const service = createPlatformSQLiteService({
      mode: 'ephemeral',
    }, {
      observability: {
        sink: events,
        store: events,
        config: { console: false, store: events },
      },
    });
    const close = service.raw.close.bind(service.raw);
    let attempts = 0;
    service.raw.close = (throwOnError = false) => {
      attempts += 1;
      expect(throwOnError).toBe(false);
      if (attempts === 1) throw new Error('injected raw close failure');
      close(throwOnError);
    };

    expect(() => service.close()).toThrow('injected raw close failure');
    expect(events.query({ code: OBS_CODES.PERSISTENCE_SQL_CLOSED.code }).count).toBe(0);
    expect(service.raw.query('SELECT 1 AS value').get()).toEqual({ value: 1 });
    expect(() => service.close()).not.toThrow();
    expect(attempts).toBe(2);
    expect(events.query({ code: OBS_CODES.PERSISTENCE_SQL_CLOSED.code }).count).toBe(1);
  });

  it('keeps abort cleanup retryable until deferred raw close succeeds', () => {
    const service = createPlatformSQLiteService({
      mode: 'ephemeral',
      emitTelemetry: false,
    });
    const close = service.raw.close.bind(service.raw);
    let attempts = 0;
    service.raw.close = (throwOnError = false) => {
      attempts += 1;
      expect(throwOnError).toBe(false);
      if (attempts === 1) throw new Error('injected raw abort failure');
      close(throwOnError);
    };

    expect(() => service.abort()).toThrow('SQLite startup state could not be discarded.');
    expect(service.raw.query('SELECT 1 AS value').get()).toEqual({ value: 1 });
    expect(() => service.abort()).not.toThrow();
    expect(attempts).toBe(2);
  });

  it('defers physical close until application-owned statements finish', () => {
    const service = createPlatformSQLiteService({
      mode: 'ephemeral',
      emitTelemetry: false,
    });
    const external = service.raw.prepare('SELECT 1 AS value');
    expect(external.get()).toEqual({ value: 1 });

    service.close();

    expect(external.get()).toEqual({ value: 1 });
    external.finalize();
    expect(() => service.raw.run('SELECT 1')).toThrow();
    expect(() => service.close()).not.toThrow();
  });

  it('restores hot-mode rows from a graceful snapshot', async () => {
    const dir = await createTestDir();
    const dbPath = path.join(dir, 'app.db');
    const snapshotPath = path.join(dir, 'app.snapshot.db');

    let service = createPlatformSQLiteService({
      mode: 'hot',
      path: dbPath,
      snapshotPath,
      snapshotIntervalMs: 60_000,
    });
    createItems(service);
    insertItem(service, 'alpha');
    service.close();

    expect(existsSync(snapshotPath)).toBe(true);

    service = createPlatformSQLiteService({
      mode: 'hot',
      path: dbPath,
      snapshotPath,
      snapshotIntervalMs: 60_000,
    });

    expect(countItems(service)).toBe(1);
    expect(readFirstItemName(service)).toBe('alpha');
    service.close();
  });

  it('returns a safe configuration error when a hot source exceeds maxBytes', async () => {
    const dir = await createTestDir();
    const dbPath = path.join(dir, 'private-tenant-source.db');
    const seed = createPlatformSQLiteService({ mode: 'file', path: dbPath });
    createItems(seed);
    insertItem(seed, 'source-row');
    seed.close();

    const error = captureDatabaseError(() => createPlatformSQLiteService({
      mode: 'hot',
      path: dbPath,
      snapshotPath: dbPath,
      hotMaxBytes: 1,
    }));
    expect(error).toMatchObject({
      code: 'DATABASE_CONFIG_INVALID',
      retryable: false,
      outcome: 'not-started',
      details: { phase: 'restore', reason: 'max-bytes' },
    });
    expect(error.message).toBe('Hot SQLite source exceeds the configured memory limit.');
    expect(error.message).not.toContain(dbPath);
  });

  it('recovers a crash-left WAL before applying the logical hot image limit', async () => {
    const dir = await createTestDir();
    const dbPath = path.join(dir, 'crash-wal-source.db');
    const readyPath = path.join(dir, 'crash-wal-ready');
    const maxBytes = 64 * 1_024;
    const writerSource = `
      import { Database } from 'bun:sqlite';
      import { writeFileSync } from 'node:fs';

      const [, dbPath, readyPath] = Bun.argv;
      const db = new Database(dbPath, { create: true, readwrite: true });
      db.run('PRAGMA journal_mode = WAL');
      db.run('PRAGMA wal_autocheckpoint = 0');
      db.run('CREATE TABLE item (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, payload TEXT NOT NULL)');
      db.run("INSERT INTO item VALUES (1, 0, 'seed')");
      db.run('PRAGMA wal_checkpoint(TRUNCATE)');
      const payload = 'x'.repeat(1_024);
      for (let version = 1; version <= 200; version += 1) {
        db.run('UPDATE item SET version = ?, payload = ? WHERE id = 1', [version, payload]);
      }
      writeFileSync(readyPath, 'ready');
      await new Promise(() => undefined);
    `;
    const writer = Bun.spawn([
      process.execPath,
      '-e',
      writerSource,
      dbPath,
      readyPath,
    ], {
      cwd: process.cwd(),
      env: Bun.env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const writerStdout = new Response(writer.stdout).text();
    const writerStderr = new Response(writer.stderr).text();

    try {
      await waitForFile(readyPath);
      expect(statSync(`${dbPath}-wal`).size).toBeGreaterThan(maxBytes);
      writer.kill(9);
      const [stdout, stderr] = await Promise.all([
        writerStdout,
        writerStderr,
        writer.exited,
      ]);
      expect(writer.exitCode, `${stdout}\n${stderr}`).not.toBe(0);

      const service = createPlatformSQLiteService({
        mode: 'hot',
        path: dbPath,
        snapshotPath: dbPath,
        snapshotEnabled: false,
        hotMaxBytes: maxBytes,
        busyTimeout: 2_000,
      });
      try {
        expect(service.raw.query(
          'SELECT version, length(payload) AS payloadBytes FROM item WHERE id = 1',
        ).get()).toEqual({ version: 200, payloadBytes: 1_024 });
      } finally {
        service.close();
      }
    } finally {
      if (writer.exitCode === null) writer.kill(9);
      await writer.exited;
    }
  }, 15_000);

  it('returns a safe typed open failure for an invalid hot source', async () => {
    const dir = await createTestDir();
    const snapshotPath = path.join(dir, 'private-corrupt-source.db');
    await Bun.write(snapshotPath, 'not-a-sqlite-database');

    const error = captureDatabaseError(() => createPlatformSQLiteService({
      mode: 'hot',
      path: snapshotPath,
      snapshotPath,
      hotMaxBytes: 1_024 * 1_024,
    }));
    expect(error).toMatchObject({
      code: 'DATABASE_OPEN_FAILED',
      retryable: false,
      outcome: 'not-started',
      details: { phase: 'open' },
    });
    expect(error.message).toBe('SQLite database could not be opened.');
    expect(error.message).not.toContain(snapshotPath);
  });

  it('keeps the final hot-mode write when close overlaps an async snapshot', async () => {
    const dir = await createTestDir();
    const dbPath = path.join(dir, 'app.db');
    const snapshotPath = path.join(dir, 'app.snapshot.db');

    let service = createPlatformSQLiteService({
      mode: 'hot',
      path: dbPath,
      snapshotPath,
      snapshotIntervalMs: 60_000,
    });
    createItems(service);
    insertItem(service, 'before-async-snapshot');

    const olderSnapshot = service.snapshot!.snapshotDetailed();
    insertItem(service, 'before-graceful-close');
    service.close();

    // The in-flight image must recognize that the synchronous shutdown image
    // superseded it instead of replacing the newer snapshot after close.
    await expect(olderSnapshot).resolves.toEqual({
      status: 'superseded',
      durable: false,
    });

    service = createPlatformSQLiteService({
      mode: 'hot',
      path: dbPath,
      snapshotPath,
      snapshotIntervalMs: 60_000,
    });
    expect(service.raw.query('SELECT name FROM items ORDER BY name').all()).toEqual([
      { name: 'before-async-snapshot' },
      { name: 'before-graceful-close' },
    ]);
    service.close();
  });

  it('keeps hot SQLite open when its final durability snapshot fails', async () => {
    const dir = await createTestDir();
    const service = createPlatformSQLiteService({
      mode: 'hot',
      path: path.join(dir, 'app.db'),
      snapshotPath: path.join(dir, 'app.snapshot.db'),
    });
    createItems(service);
    insertItem(service, 'retryable-close');
    const snapshot = service.snapshot!;
    const originalSnapshotSync = snapshot.snapshotSyncDetailed.bind(snapshot);
    snapshot.snapshotSyncDetailed = () => ({
      status: 'failed',
      durable: false,
      error: new Error('injected final snapshot failure'),
    });

    try {
      expect(() => service.close()).toThrow('final snapshot failed');
      expect(readFirstItemName(service)).toBe('retryable-close');
    } finally {
      snapshot.snapshotSyncDetailed = originalSnapshotSync;
      service.close();
    }
  });

  it('publishes private atomic snapshots and reports explicit request outcomes', async () => {
    const dir = await createTestDir();
    const snapshotPath = path.join(dir, 'private.snapshot.db');
    const service = createPlatformSQLiteService({
      mode: 'hot',
      path: path.join(dir, 'app.db'),
      snapshotPath,
      snapshotEnabled: true,
    });
    createItems(service);
    insertItem(service, 'private-image');

    const first = service.snapshot!.snapshotDetailed();
    expect(await service.snapshot!.snapshotDetailed()).toEqual({
      status: 'in-progress',
      durable: false,
    });
    expect(await first).toEqual({ status: 'written', durable: true });
    expect(statSync(snapshotPath).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir).filter((entry) => entry.includes('.tmp.'))).toEqual([]);

    service.close();
    expect(statSync(snapshotPath).mode & 0o777).toBe(0o600);
  });

  it('distinguishes disabled snapshots from durable writes', async () => {
    const dir = await createTestDir();
    const service = createPlatformSQLiteService({
      mode: 'hot',
      path: path.join(dir, 'app.db'),
      snapshotPath: path.join(dir, 'disabled.snapshot.db'),
      snapshotEnabled: false,
    });

    expect(await service.snapshot!.snapshotDetailed()).toEqual({
      status: 'disabled',
      durable: false,
    });
    expect(service.snapshot!.snapshotSyncDetailed()).toEqual({
      status: 'disabled',
      durable: false,
    });
    expect(existsSync(path.join(dir, 'disabled.snapshot.db'))).toBe(false);
    service.close();
  });

  it('latches a real snapshot failure even after a successful retry', async () => {
    const dir = await createTestDir();
    const snapshotPath = path.join(dir, 'app.snapshot.db');
    const service = createPlatformSQLiteService({
      mode: 'hot',
      path: path.join(dir, 'app.db'),
      snapshotPath,
    });
    createItems(service);
    // Force atomic publication to fail only after the private temporary image
    // has been written and fsynced.
    mkdirSync(snapshotPath);

    const failure = service.snapshot!.snapshotSyncDetailed();
    expect(failure.status).toBe('failed');
    expect(service.snapshot!.isHealthy).toBe(false);
    expect(service.snapshot!.failure).not.toBeNull();
    expect(service.diagnostics().snapshotHealthy).toBe(false);
    expect(readdirSync(dir).filter((entry) => entry.includes('.tmp.'))).toEqual([]);

    await rm(snapshotPath, { recursive: true, force: true });
    expect(service.snapshot!.snapshotSyncDetailed()).toEqual({
      status: 'written',
      durable: true,
    });
    expect(service.snapshot!.isHealthy).toBe(false);
    service.close();
  });

  it('serializes concurrent hot-mode source opens without journal-mode races', async () => {
    const dir = await createTestDir();
    const dbPath = path.join(dir, 'shared-hot-source.db');
    const seed = createPlatformSQLiteService({ mode: 'file', path: dbPath });
    createItems(seed);
    insertItem(seed, 'shared-source');
    seed.close();

    const connectionModuleUrl = new URL('./sqlite-connection.ts', import.meta.url).href;
    const configModuleUrl = new URL('./storage-config.ts', import.meta.url).href;
    const openerSource = `
      import { openSQLiteDatabase } from ${JSON.stringify(connectionModuleUrl)};
      import { resolveSQLiteStorageConfig } from ${JSON.stringify(configModuleUrl)};

      const [, dbPath, startAtValue] = Bun.argv;
      await Bun.sleep(Math.max(0, Number(startAtValue) - Date.now()));
      const db = openSQLiteDatabase(resolveSQLiteStorageConfig({
        mode: 'hot',
        path: dbPath,
        snapshotPath: dbPath,
        snapshotEnabled: false,
        // This test intentionally launches multiple processes at once. Give
        // the lock owner enough wall-clock budget to resume even when the
        // complete test suite is saturating the CI worker; the assertion is
        // about serialization correctness, not a two-second scheduler SLA.
        busyTimeout: 10_000,
      }));
      const row = db.query('SELECT name FROM items LIMIT 1').get();
      if (row?.name !== 'shared-source') throw new Error('Hot source row was not restored.');
      db.close();
    `;
    const startAt = String(Date.now() + 200);
    const openers = Array.from({ length: 3 }, () => Bun.spawn([
      process.execPath,
      '-e',
      openerSource,
      dbPath,
      startAt,
    ], {
      cwd: process.cwd(),
      env: Bun.env,
      stdout: 'pipe',
      stderr: 'pipe',
    }));

    try {
      const results = await Promise.all(openers.map(async (opener) => {
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(opener.stdout).text(),
          new Response(opener.stderr).text(),
          opener.exited,
        ]);
        return { stdout, stderr, exitCode };
      }));
      for (const result of results) {
        expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
      }

      const observer = new Database(dbPath, { create: false, readwrite: true });
      try {
        expect(observer.query('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
        expect(observer.query('SELECT name FROM items LIMIT 1').get()).toEqual({
          name: 'shared-source',
        });
      } finally {
        observer.close();
      }
    } finally {
      for (const opener of openers) {
        if (opener.exitCode === null) opener.kill();
      }
      await Promise.all(openers.map((opener) => opener.exited));
    }
  }, 30_000);

  it('persists file-mode rows through SQLite WAL/file recovery', async () => {
    const dir = await createTestDir();
    const dbPath = path.join(dir, 'app.db');

    let service = createPlatformSQLiteService({
      mode: 'file',
      path: dbPath,
    });
    createItems(service);
    insertItem(service, 'file-row');
    service.close();

    service = createPlatformSQLiteService({
      mode: 'file',
      path: dbPath,
    });

    expect(countItems(service)).toBe(1);
    expect(readFirstItemName(service)).toBe('file-row');
    service.close();
  });

  it('installs the busy timeout before lock-taking file initialization', async () => {
    const dir = await createTestDir();
    const dbPath = path.join(dir, 'locked-startup.db');
    const readyPath = path.join(dir, 'lock-ready');
    const openAttemptPath = path.join(dir, 'open-attempted');
    const holderSource = `
      import { Database } from 'bun:sqlite';
      import { existsSync, writeFileSync } from 'node:fs';

      const [, dbPath, readyPath, openAttemptPath] = Bun.argv;
      const db = new Database(dbPath, { create: true, readwrite: true });
      db.run('PRAGMA journal_mode = WAL');
      db.run('CREATE TABLE lock_holder (id INTEGER PRIMARY KEY)');
      db.run('BEGIN EXCLUSIVE');
      writeFileSync(readyPath, 'ready');
      while (!existsSync(openAttemptPath)) await Bun.sleep(5);
      await Bun.sleep(200);
      db.run('COMMIT');
      db.close();
    `;
    const holder = Bun.spawn([
      process.execPath,
      '-e',
      holderSource,
      dbPath,
      readyPath,
      openAttemptPath,
    ], {
      cwd: process.cwd(),
      env: Bun.env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const holderStdout = new Response(holder.stdout).text();
    const holderStderr = new Response(holder.stderr).text();
    let service: DefaultPlatformSQLiteService | null = null;

    try {
      await waitForFile(readyPath);
      await Bun.write(openAttemptPath, 'open');

      service = createPlatformSQLiteService({
        mode: 'file',
        path: dbPath,
        busyTimeout: 2_000,
      });

      expect(service.raw.query('PRAGMA busy_timeout').get()).toEqual({ timeout: 2_000 });
      const [stdout, stderr, exitCode] = await Promise.all([
        holderStdout,
        holderStderr,
        holder.exited,
      ]);
      expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
    } finally {
      service?.close();
      if (holder.exitCode === null) holder.kill();
      await holder.exited;
    }
  });

  it('keeps ephemeral rows process-local and non-durable', async () => {
    await createTestDir();

    let service = createPlatformSQLiteService({ mode: 'ephemeral' });
    createItems(service);
    insertItem(service, 'temporary');
    expect(countItems(service)).toBe(1);
    service.close();

    service = createPlatformSQLiteService({ mode: 'ephemeral' });
    expect(() => countItems(service)).toThrow();
    service.close();
  });

  it('normalizes legacy config aliases without hiding durability policy', () => {
    expect(resolveSQLiteStorageConfig({ mode: 'memory' }).mode).toBe('ephemeral');
    expect(resolveSQLiteStorageConfig({ mode: ':memory:' }).mode).toBe('ephemeral');

    const fileConfig = resolveSQLiteStorageConfig({ mode: './data/custom.db' });
    expect(fileConfig.mode).toBe('file');
    expect(fileConfig.path).toBe('./data/custom.db');

    const hotConfig = resolveSQLiteStorageConfig({ mode: 'hot', path: './data/app.db' });
    expect(hotConfig.mode).toBe('hot');
    expect(hotConfig.snapshotPath).toBe('./data/app.snapshot.db');
    expect(() => resolveSQLiteStorageConfig({
      mode: 'hot',
      snapshotIntervalMs: 2_147_483_648,
    })).toThrow('snapshotIntervalMs must not exceed 2147483647');
  });

  it('reuses prepared statements through the statement cache', async () => {
    await createTestDir();
    const service = createPlatformSQLiteService({ mode: 'ephemeral' });

    const first = service.statements.prepare('SELECT 1 AS value');
    const second = service.statements.prepare('SELECT 1 AS value');

    expect(second).toBe(first);
    expect(service.statements.stats()).toMatchObject({
      size: 1,
      maxSize: 1000,
    });
    service.close();
  });

  it('retains only failed statement finalizations for a cleanup retry', () => {
    const finalizeCalls = new Map<string, number>();
    const cache = new StatementCache({
      prepare(sql: string) {
        return {
          finalize() {
            const calls = (finalizeCalls.get(sql) ?? 0) + 1;
            finalizeCalls.set(sql, calls);
            if (sql === 'retry' && calls === 1) {
              throw new Error('injected finalize failure');
            }
          },
        };
      },
    } as unknown as Database, 10);
    cache.prepare('retry');
    cache.prepare('complete');

    expect(() => cache.clear()).toThrow('Cached SQLite statements could not be finalized.');
    expect(cache.stats().size).toBe(1);
    expect(finalizeCalls).toEqual(new Map([
      ['retry', 1],
      ['complete', 1],
    ]));

    cache.clear();
    expect(cache.stats().size).toBe(0);
    expect(finalizeCalls.get('retry')).toBe(2);
    expect(finalizeCalls.get('complete')).toBe(1);
  });

  it('supports nested synchronous transaction helpers with savepoints', async () => {
    await createTestDir();
    const service = createPlatformSQLiteService({ mode: 'ephemeral' });
    createItems(service);

    service.transactions.runSync(() => {
      insertItem(service, 'outer');
      service.transactions.runSync(() => {
        insertItem(service, 'inner');
      });
    });

    expect(countItems(service)).toBe(2);

    expect(() => {
      service.transactions.runSync(() => {
        insertItem(service, 'rolled-back-outer');
        service.transactions.runSync(() => {
          insertItem(service, 'rolled-back-inner');
          throw new Error('rollback nested transaction');
        });
      });
    }).toThrow('rollback nested transaction');

    expect(countItems(service)).toBe(2);
    service.close();
  });

  it('zeroes released buffers before reuse', () => {
    const pool = new BufferPool({ maxPoolSize: 1, preallocate: false });
    const buffer = pool.acquire(8);
    buffer[0] = 99;
    pool.release(buffer);

    const reused = pool.acquire(8);

    expect(reused).toBe(buffer);
    expect(reused[0]).toBe(0);
  });
});

async function createTestDir(): Promise<string> {
  testDir = await mkdtemp(path.join(tmpdir(), 'zero-platform-sqlite-'));
  return testDir;
}

function captureDatabaseError(operation: () => unknown): DatabaseError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
  throw new Error('Expected DatabaseError.');
}

async function waitForFile(filePath: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(filePath)) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for child process file: ${filePath}`);
    }
    await Bun.sleep(5);
  }
}

async function waitForCondition(
  condition: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition.');
    await Bun.sleep(1);
  }
}

function createItems(service: DefaultPlatformSQLiteService): void {
  service.raw.run('CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)');
}

function insertItem(service: DefaultPlatformSQLiteService, name: string): void {
  service.raw.query('INSERT INTO items (name) VALUES (?)').run(name);
}

function countItems(service: DefaultPlatformSQLiteService): number {
  const row = service.raw.query('SELECT COUNT(*) AS count FROM items').get() as { count: number };
  return row.count;
}

function readFirstItemName(service: DefaultPlatformSQLiteService): string {
  const row = service.raw.query('SELECT name FROM items ORDER BY id LIMIT 1').get() as { name: string };
  return row.name;
}
