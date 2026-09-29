/**
 * platform-sqlite.test.ts
 *
 * Verifies the Zero SQLite persistence foundation. These tests own storage
 * mode behavior only; ReactiveDB integration is covered in later slices.
 */

import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';

import { BufferPool } from './buffer-pool';
import { createPlatformSQLiteService } from './platform-sqlite';
import { resolveSQLiteStorageConfig } from './storage-config';
import type { DefaultPlatformSQLiteService } from './platform-sqlite';

let testDir: string | null = null;

describe('platform SQLite persistence', () => {
  afterEach(async () => {
    if (!testDir) return;
    await rm(testDir, { recursive: true, force: true });
    testDir = null;
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

    const olderSnapshot = service.snapshot!.snapshot();
    insertItem(service, 'before-graceful-close');
    service.close();

    // The in-flight image must recognize that the synchronous shutdown image
    // superseded it instead of replacing the newer snapshot after close.
    await expect(olderSnapshot).resolves.toBe(false);

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
    const originalSnapshotSync = snapshot.snapshotSync.bind(snapshot);
    snapshot.snapshotSync = () => false;

    try {
      expect(() => service.close()).toThrow('final snapshot failed');
      expect(readFirstItemName(service)).toBe('retryable-close');
    } finally {
      snapshot.snapshotSync = originalSnapshotSync;
      service.close();
    }
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

async function waitForFile(filePath: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(filePath)) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for child process file: ${filePath}`);
    }
    await Bun.sleep(5);
  }
}

function createItems(service: DefaultPlatformSQLiteService): void {
  service.raw.run('CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)');
}

function insertItem(service: DefaultPlatformSQLiteService, name: string): void {
  service.raw.prepare('INSERT INTO items (name) VALUES (?)').run(name);
}

function countItems(service: DefaultPlatformSQLiteService): number {
  const row = service.raw.prepare('SELECT COUNT(*) AS count FROM items').get() as { count: number };
  return row.count;
}

function readFirstItemName(service: DefaultPlatformSQLiteService): string {
  const row = service.raw.prepare('SELECT name FROM items ORDER BY id LIMIT 1').get() as { name: string };
  return row.name;
}
