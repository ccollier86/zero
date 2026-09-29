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

import { DatabaseError } from '../databases/database-error';
import type { ResolvedSQLiteStorageConfig } from './storage-types';

/** Open a Bun SQLite database according to resolved platform storage config. */
export function openSQLiteDatabase(config: ResolvedSQLiteStorageConfig): Database {
  try {
    switch (config.mode) {
      case 'hot':
        return openHotDatabase(config);
      case 'file':
        return openFileDatabase(config);
      case 'ephemeral':
        return openEphemeralDatabase(config);
    }
  } catch (error) {
    if (error instanceof DatabaseError) {
      throw error;
    }
    if (error instanceof AggregateError) {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'SQLite database initialization cleanup failed.',
        {
          cause: error,
          retryable: false,
          outcome: 'unknown',
          details: { phase: 'cleanup' },
        },
      );
    }
    const sqliteCode = safeSQLiteCode(error);
    throw new DatabaseError(
      'DATABASE_OPEN_FAILED',
      'SQLite database could not be opened.',
      {
        cause: error,
        retryable: isRetryableOpenFailure(error, sqliteCode),
        outcome: 'not-started',
        details: {
          phase: 'open',
          ...(sqliteCode === null ? {} : { sqliteCode }),
        },
      },
    );
  }
}

function openHotDatabase(config: ResolvedSQLiteStorageConfig): Database {
  const hotMaxBytes = config.hotMaxBytes ?? null;
  const sourcePath = config.snapshotPath && existsSync(config.snapshotPath)
    ? config.snapshotPath
    : config.path && existsSync(config.path)
      ? config.path
      : null;

  const db = sourcePath
    ? deserializeSourceDatabase(
        sourcePath,
        config.busyTimeout,
        hotMaxBytes,
      )
    : new Database(':memory:', {
        create: true,
        readwrite: true,
      });
  try {
    applyMemoryPragmas(db, config);
    applyHotPageLimit(db, hotMaxBytes);
    return db;
  } catch (error) {
    closeRejectedDatabase(db, error, 'Hot SQLite initialization cleanup failed.');
    throw error;
  }
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
    closeRejectedDatabase(db, error, 'File SQLite initialization cleanup failed.');
    throw error;
  }
}

function openEphemeralDatabase(config: ResolvedSQLiteStorageConfig): Database {
  const db = new Database(':memory:', { create: true, readwrite: true });
  try {
    applyMemoryPragmas(db, config);
    return db;
  } catch (error) {
    closeRejectedDatabase(db, error, 'Ephemeral SQLite initialization cleanup failed.');
    throw error;
  }
}

function deserializeSourceDatabase(
  sourcePath: string,
  busyTimeout: number,
  maxBytes: number | null,
): Database {
  const source = openExclusivelyLockedSource(sourcePath, busyTimeout);
  let restoreWal = false;
  let restored: Database | null = null;
  let operationFailure: unknown = null;
  try {
    ensureJournalMode(source, 'WAL', busyTimeout);
    restoreWal = true;
    source.run('PRAGMA wal_checkpoint(TRUNCATE)');
    ensureJournalMode(source, 'DELETE', busyTimeout);
    if (maxBytes !== null && databasePageBytes(source) > maxBytes) {
      throw hotSourceLimitExceeded();
    }
    const data = source.serialize();
    if (maxBytes !== null && data.byteLength > maxBytes) {
      throw hotSourceLimitExceeded();
    }
    restored = Database.deserialize(data, { strict: true });
  } catch (error) {
    operationFailure = error;
  }

  const cleanupFailures: unknown[] = [];
  if (restoreWal) {
    try {
      ensureJournalMode(source, 'WAL', busyTimeout);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  closeDatabaseExactly(source, cleanupFailures);

  if (cleanupFailures.length > 0) {
    if (restored) closeDatabaseExactly(restored, cleanupFailures);
    const failures = operationFailure === null
      ? cleanupFailures
      : [operationFailure, ...cleanupFailures];
    throw new AggregateError(failures, 'Hot SQLite source cleanup failed.');
  }
  if (operationFailure !== null) throw operationFailure;
  if (!restored) throw new Error('Hot SQLite source did not produce an image.');
  return restored;
}

function databasePageBytes(database: Database): number {
  const pageCount = readPreparedRow(database, 'PRAGMA page_count') as {
    page_count?: unknown;
  } | null;
  const pageSize = readPreparedRow(database, 'PRAGMA page_size') as {
    page_size?: unknown;
  } | null;
  if (!Number.isSafeInteger(pageCount?.page_count)
    || !Number.isSafeInteger(pageSize?.page_size)) {
    throw new Error('SQLite did not report a bounded source size.');
  }
  const bytes = (pageCount!.page_count as number) * (pageSize!.page_size as number);
  return Number.isSafeInteger(bytes) ? bytes : Number.MAX_SAFE_INTEGER;
}

/**
 * Make the configured hot-memory bound an admission limit, not a post-commit
 * observation. SQLite rejects a transaction with SQLITE_FULL before it can
 * grow the in-memory image beyond this page budget.
 */
function applyHotPageLimit(database: Database, maxBytes: number | null): void {
  if (maxBytes === null) return;
  const pageSize = readPositivePragmaInteger(database, 'page_size');
  const pageCount = readNonNegativePragmaInteger(database, 'page_count');
  const maxPages = Math.floor(maxBytes / pageSize);
  if (maxPages < 1 || pageCount > maxPages) throw hotSourceLimitExceeded();

  const applied = readNonNegativePragmaInteger(
    database,
    `max_page_count = ${maxPages}`,
  );
  if (applied < pageCount || applied > maxPages) {
    throw hotSourceLimitExceeded();
  }
}

function readPositivePragmaInteger(database: Database, pragma: string): number {
  const value = readPragmaInteger(database, pragma);
  if (value <= 0) {
    throw new Error('SQLite did not report a positive page limit value.');
  }
  return value;
}

function readNonNegativePragmaInteger(database: Database, pragma: string): number {
  const value = readPragmaInteger(database, pragma);
  if (value < 0) {
    throw new Error('SQLite did not report a non-negative page limit value.');
  }
  return value;
}

function readPragmaInteger(database: Database, pragma: string): number {
  const row = readPreparedRow(database, `PRAGMA ${pragma}`) as
    | Record<string, unknown>
    | null;
  const value = row ? Object.values(row)[0] : null;
  if (!Number.isSafeInteger(value)) {
    throw new Error('SQLite did not report a bounded page limit value.');
  }
  return value as number;
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
      const row = readPreparedRow(source, 'PRAGMA locking_mode = EXCLUSIVE') as {
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
      const cleanupFailures: unknown[] = [];
      closeDatabaseExactly(source, cleanupFailures);
      if (cleanupFailures.length > 0) {
        throw new AggregateError(
          [error, ...cleanupFailures],
          'Hot SQLite source acquisition cleanup failed.',
        );
      }
      if (!isSQLiteBusy(error)) throw error;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw error;
      Bun.sleepSync(Math.min(retryDelay, remaining));
      retryDelay = Math.min(retryDelay * 2, 25);
    }
  }
}

function closeRejectedDatabase(
  database: Database,
  primaryFailure: unknown,
  message: string,
): void {
  const cleanupFailures: unknown[] = [];
  closeDatabaseExactly(database, cleanupFailures);
  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      [primaryFailure, ...cleanupFailures],
      message,
    );
  }
}

function closeDatabaseExactly(
  database: Database,
  failures: unknown[],
): void {
  try {
    database.close(true);
  } catch (error) {
    failures.push(error);
    // Ask Bun to close once pending work settles, while retaining the throwing
    // close failure as proof that immediate ownership release was not observed.
    try {
      database.close(false);
    } catch (fallbackError) {
      failures.push(fallbackError);
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
  const row = readPreparedRow(db, pragma) as { journal_mode?: unknown } | null;
  return typeof row?.journal_mode === 'string' ? row.journal_mode.toLowerCase() : null;
}

function readPreparedRow(database: Database, sql: string): unknown {
  const statement = database.prepare(sql);
  try {
    return statement.get();
  } finally {
    statement.finalize();
  }
}

function isSQLiteBusy(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && (code === 'SQLITE_BUSY' || code.startsWith('SQLITE_BUSY_'));
}

function hotSourceLimitExceeded(): DatabaseError {
  return new DatabaseError(
    'DATABASE_CONFIG_INVALID',
    'Hot SQLite source exceeds the configured memory limit.',
    {
      retryable: false,
      outcome: 'not-started',
      details: { phase: 'restore', reason: 'max-bytes' },
    },
  );
}

function safeSQLiteCode(error: unknown): string | null {
  try {
    if (typeof error !== 'object' || error === null) return null;
    let cursor: object | null = error;
    for (let depth = 0; cursor && depth < 4; depth += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(cursor, 'code');
      if (descriptor) {
        return 'value' in descriptor
          && typeof descriptor.value === 'string'
          && /^SQLITE_[A-Z0-9_]{1,64}$/u.test(descriptor.value)
          ? descriptor.value
          : null;
      }
      cursor = Object.getPrototypeOf(cursor) as object | null;
    }
  } catch {
    // Hostile proxy traps and exotic prototypes cannot cross this boundary.
  }
  return null;
}

function isRetryableOpenFailure(
  error: unknown,
  sqliteCode: string | null,
): boolean {
  if (sqliteCode !== null) {
    if (/^SQLITE_(CORRUPT|FORMAT|MISMATCH|MISUSE|NOTADB|RANGE)(?:_|$)/u
      .test(sqliteCode)) {
      return false;
    }
    return true;
  }

  const systemCode = safeSystemErrorCode(error);
  if (systemCode === null) return true;
  return systemCode !== 'EACCES'
    && systemCode !== 'EINVAL'
    && systemCode !== 'EISDIR'
    && systemCode !== 'ENOTDIR'
    && systemCode !== 'EPERM';
}

function safeSystemErrorCode(error: unknown): string | null {
  try {
    if (typeof error !== 'object' || error === null) return null;
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor
      && 'value' in descriptor
      && typeof descriptor.value === 'string'
      && /^[A-Z][A-Z0-9_]{0,63}$/u.test(descriptor.value)
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
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
