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

  const db = sourcePath
    ? deserializeSourceDatabase(sourcePath, config.busyTimeout)
    : new Database(':memory:', {
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
  try {
    applyBusyTimeout(db, config.busyTimeout);
    db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0);
    applyFilePragmas(db, config);
    return db;
  } catch (error) {
    // The service constructor cannot own this handle if initialization fails.
    // Preserve the initialization failure even if SQLite also rejects close.
    try {
      db.close();
    } catch {
      // Best-effort cleanup of a partially initialized connection.
    }
    throw error;
  }
}

function openEphemeralDatabase(config: ResolvedSQLiteStorageConfig): Database {
  const db = new Database(':memory:', { create: true, readwrite: true });
  applyMemoryPragmas(db, config);
  return db;
}

function deserializeSourceDatabase(sourcePath: string, busyTimeout: number): Database {
  const source = openExclusivelyLockedSource(sourcePath, busyTimeout);
  try {
    ensureJournalMode(source, 'WAL', busyTimeout);
    source.run('PRAGMA wal_checkpoint(TRUNCATE)');
    ensureJournalMode(source, 'DELETE', busyTimeout);
    const data = source.serialize();
    ensureJournalMode(source, 'WAL', busyTimeout);
    return Database.deserialize(data, { strict: true });
  } finally {
    source.close();
  }
}

function applyMemoryPragmas(db: Database, config: ResolvedSQLiteStorageConfig): void {
  applyBusyTimeout(db, config.busyTimeout);
  applyPragmas(db, [
    'PRAGMA journal_mode = MEMORY',
    'PRAGMA synchronous = OFF',
    `PRAGMA cache_size = ${config.cacheSize}`,
    `PRAGMA page_size = ${config.pageSize}`,
    `PRAGMA temp_store = ${tempStoreValue(config.tempStore)}`,
    'PRAGMA foreign_keys = ON',
    'PRAGMA optimize',
  ]);
}

function applyFilePragmas(db: Database, config: ResolvedSQLiteStorageConfig): void {
  ensureJournalMode(db, 'WAL', config.busyTimeout);
  applyPragmas(db, [
    `PRAGMA synchronous = ${config.synchronous}`,
    `PRAGMA cache_size = ${config.cacheSize}`,
    `PRAGMA mmap_size = ${config.mmapSize}`,
    `PRAGMA page_size = ${config.pageSize}`,
    `PRAGMA wal_autocheckpoint = ${config.walAutocheckpoint}`,
    `PRAGMA temp_store = ${tempStoreValue(config.tempStore)}`,
    'PRAGMA foreign_keys = ON',
    'PRAGMA optimize',
    'PRAGMA journal_size_limit = 67108864',
  ]);
}

function applyBusyTimeout(db: Database, busyTimeout: number): void {
  // Set the connection's busy handler before any operation that can acquire a
  // database lock. In particular, two processes can race while transitioning
  // a new file to WAL mode; applying this later makes that normal startup race
  // fail immediately with SQLITE_BUSY instead of honoring the configured wait.
  db.run(`PRAGMA busy_timeout = ${busyTimeout}`);
}

function openExclusivelyLockedSource(sourcePath: string, busyTimeout: number): Database {
  const deadline = Date.now() + busyTimeout;
  let retryDelay = 1;

  while (true) {
    const source = new Database(sourcePath, { create: false, readwrite: true });
    try {
      // Do not leave a losing connection open while it waits: merely keeping
      // that handle around can prevent the winner from changing journal mode.
      // Retry the complete open instead, so exactly one source handle remains
      // during the checkpoint -> serialize -> restore sequence.
      applyBusyTimeout(source, 0);
      const row = source.query('PRAGMA locking_mode = EXCLUSIVE').get() as {
        locking_mode?: unknown;
      } | null;
      if (typeof row?.locking_mode !== 'string' || row.locking_mode.toLowerCase() !== 'exclusive') {
        throw new Error('SQLite refused exclusive locking mode for hot source initialization.');
      }
      source.run('BEGIN EXCLUSIVE');
      source.run('COMMIT');
      applyBusyTimeout(source, busyTimeout);
      return source;
    } catch (error) {
      try {
        source.close();
      } catch {
        // Preserve the acquisition error from the connection we could not own.
      }
      if (!isSQLiteBusy(error)) throw error;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw error;
      Bun.sleepSync(Math.min(retryDelay, remaining));
      retryDelay = Math.min(retryDelay * 2, 25);
    }
  }
}

function ensureJournalMode(
  db: Database,
  targetMode: 'DELETE' | 'WAL',
  busyTimeout: number
): void {
  const normalizedTarget = targetMode.toLowerCase();
  const deadline = Date.now() + busyTimeout;
  let retryDelay = 1;
  let lastFailure: unknown = new Error('SQLite did not report a journal mode.');

  while (true) {
    try {
      // Reapplying a persistent journal mode can require a lock even when
      // another process already completed the transition. Read first so
      // concurrent opens do not contend on an unnecessary mode write.
      const currentMode = readJournalMode(db, 'PRAGMA journal_mode');
      if (currentMode === normalizedTarget) return;

      const appliedMode = readJournalMode(db, `PRAGMA journal_mode = ${targetMode}`);
      if (appliedMode === normalizedTarget) return;
      lastFailure = new Error(
        `SQLite refused ${targetMode} journal mode` +
        `${appliedMode ? ` and remained in ${appliedMode} mode` : ''}.`
      );
    } catch (error) {
      if (!isSQLiteBusy(error)) throw error;
      lastFailure = error;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) throw lastFailure;
    Bun.sleepSync(Math.min(retryDelay, remaining));
    retryDelay = Math.min(retryDelay * 2, 25);
  }
}

function readJournalMode(db: Database, pragma: string): string | null {
  const row = db.query(pragma).get() as { journal_mode?: unknown } | null;
  return typeof row?.journal_mode === 'string' ? row.journal_mode.toLowerCase() : null;
}

function isSQLiteBusy(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && (code === 'SQLITE_BUSY' || code.startsWith('SQLITE_BUSY_'));
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
