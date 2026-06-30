/**
 * sqlite-connection.ts
 *
 * Opens Bun SQLite handles for Zero's hot, file, and ephemeral storage modes.
 * This file owns SQLite connection and PRAGMA policy only; snapshots and
 * service lifecycle live in their dedicated managers.
 */

import { Database, constants } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import type { ResolvedSQLiteStorageConfig } from './storage-types';

/** Open a Bun SQLite database according to resolved platform storage config. */
export function openSQLiteDatabase(config: ResolvedSQLiteStorageConfig): Database {
  switch (config.mode) {
    case 'hot':
      return openHotDatabase(config);
    case 'file':
      return openFileDatabase(config);
    case 'ephemeral':
      return openEphemeralDatabase(config);
  }
}

function openHotDatabase(config: ResolvedSQLiteStorageConfig): Database {
  const sourcePath = config.snapshotPath && existsSync(config.snapshotPath)
    ? config.snapshotPath
    : config.path && existsSync(config.path)
      ? config.path
      : null;

  const db = sourcePath ? deserializeSourceDatabase(sourcePath) : new Database(':memory:', {
    create: true,
    readwrite: true,
  });
  applyMemoryPragmas(db, config);
  return db;
}

function openFileDatabase(config: ResolvedSQLiteStorageConfig): Database {
  if (!config.path) throw new Error('SQLite file mode requires a path.');
  ensureParentDir(config.path);
  const db = new Database(config.path, { create: true, readwrite: true });
  db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0);
  applyFilePragmas(db, config);
  return db;
}

function openEphemeralDatabase(config: ResolvedSQLiteStorageConfig): Database {
  const db = new Database(':memory:', { create: true, readwrite: true });
  applyMemoryPragmas(db, config);
  return db;
}

function deserializeSourceDatabase(sourcePath: string): Database {
  const source = new Database(sourcePath, { create: false, readwrite: true });
  try {
    source.run('PRAGMA journal_mode = WAL');
    source.run('PRAGMA wal_checkpoint(TRUNCATE)');
    source.run('PRAGMA journal_mode = DELETE');
    const data = source.serialize();
    source.run('PRAGMA journal_mode = WAL');
    return Database.deserialize(data, { strict: true });
  } finally {
    source.close();
  }
}

function applyMemoryPragmas(db: Database, config: ResolvedSQLiteStorageConfig): void {
  applyPragmas(db, [
    'PRAGMA journal_mode = MEMORY',
    'PRAGMA synchronous = OFF',
    `PRAGMA cache_size = ${config.cacheSize}`,
    `PRAGMA page_size = ${config.pageSize}`,
    `PRAGMA temp_store = ${tempStoreValue(config.tempStore)}`,
    `PRAGMA busy_timeout = ${config.busyTimeout}`,
    'PRAGMA foreign_keys = ON',
    'PRAGMA optimize',
  ]);
}

function applyFilePragmas(db: Database, config: ResolvedSQLiteStorageConfig): void {
  applyPragmas(db, [
    'PRAGMA journal_mode = WAL',
    `PRAGMA synchronous = ${config.synchronous}`,
    `PRAGMA cache_size = ${config.cacheSize}`,
    `PRAGMA mmap_size = ${config.mmapSize}`,
    `PRAGMA page_size = ${config.pageSize}`,
    `PRAGMA wal_autocheckpoint = ${config.walAutocheckpoint}`,
    `PRAGMA temp_store = ${tempStoreValue(config.tempStore)}`,
    `PRAGMA busy_timeout = ${config.busyTimeout}`,
    'PRAGMA foreign_keys = ON',
    'PRAGMA optimize',
    'PRAGMA journal_size_limit = 67108864',
  ]);
}

function applyPragmas(db: Database, pragmas: string[]): void {
  for (const pragma of pragmas) db.run(pragma);
}

function tempStoreValue(value: string): number {
  if (value === 'MEMORY') return 2;
  if (value === 'FILE') return 1;
  return 0;
}

function ensureParentDir(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

