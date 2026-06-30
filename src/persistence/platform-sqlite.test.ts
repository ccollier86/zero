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
