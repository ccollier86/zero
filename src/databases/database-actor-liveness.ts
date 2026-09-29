/**
 * database-actor-liveness.ts
 *
 * OS-backed restart fence for subprocess actors. Every bound actor holds a
 * rollback-journal SHARED lock for its lifetime. A replacement coordinator must
 * obtain a zero-timeout EXCLUSIVE probe before becoming ready, so an orphaned
 * actor cannot finish an old-generation write after new authority is admitted.
 */

import { randomUUID } from 'node:crypto';

import { Database } from 'bun:sqlite';
import { join } from 'node:path';

import { DatabaseError } from './database-error';
import { prepareDatabaseFile } from './database-file';
import {
  openDatabaseFileIdentityGuard,
  type DatabaseFileIdentityGuard,
  type DatabaseFileIdentityProof,
} from './database-file-identity';

const INTERNAL_DIRECTORY = '.zero-internal';
const LIVENESS_DATABASE_ID = '_zero_actor_liveness_v1';
const LIVENESS_TABLE = '_zero_actor_liveness_v1';
const LIVENESS_GENERATION_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** Trusted bind data for the internal actor-liveness lock database. */
export interface DatabaseActorLivenessBinding {
  readonly filePath: string;
  readonly fileIdentity: DatabaseFileIdentityProof;
  readonly generation: string;
}

/** Lifetime SHARED lease held inside one actor process. */
export interface DatabaseActorLivenessGuard extends Disposable {
  readonly released: boolean;
  assertCurrent(): void;
  release(): void;
}

/**
 * Prepare the internal lock database and prove no actor from an earlier parent
 * generation is still capable of completing work.
 */
export function probeDatabaseActorLiveness(
  rootDirectory: string,
): DatabaseActorLivenessBinding {
  const prepared = prepareDatabaseFile(
    join(rootDirectory, INTERNAL_DIRECTORY),
    LIVENESS_DATABASE_ID,
  );
  const fileGuard = openDatabaseFileIdentityGuard(prepared.path, {
    access: 'readwrite',
    expected: prepared.identity,
  });
  let database: Database | null = null;
  let exclusive = false;
  const generation = randomUUID().toLowerCase();
  try {
    database = new Database(prepared.path, {
      create: false,
      readwrite: true,
      strict: true,
    });
    fileGuard.assertCurrent();
    database.run('PRAGMA busy_timeout = 0');
    assertRollbackJournal(database);
    database.run('BEGIN EXCLUSIVE');
    exclusive = database.inTransaction;
    if (!exclusive) throw livenessOpenFailed();
    writeLivenessGeneration(database, generation);
    database.run('COMMIT');
    exclusive = false;
    fileGuard.assertCurrent();
    return Object.freeze({
      filePath: prepared.path,
      fileIdentity: prepared.identity,
      generation,
    });
  } catch (error) {
    if (isSQLiteContention(error)) throw staleActorConflict();
    if (error instanceof DatabaseError) throw error;
    throw livenessOpenFailed();
  } finally {
    let cleanupFailed = false;
    if (database) {
      if (exclusive || database.inTransaction) {
        try { database.run('ROLLBACK'); } catch { cleanupFailed = true; }
      }
      try { database.close(true); } catch { cleanupFailed = true; }
    }
    try { fileGuard.release(); } catch { cleanupFailed = true; }
    if (cleanupFailed) throw livenessCleanupFailed();
  }
}

/** Acquire the SHARED lifetime lock before an actor opens its assigned file. */
export function acquireDatabaseActorLiveness(
  binding: DatabaseActorLivenessBinding,
): DatabaseActorLivenessGuard {
  const expectedGeneration = validateLivenessGeneration(binding.generation);
  const fileGuard = openDatabaseFileIdentityGuard(binding.filePath, {
    access: 'readwrite',
    expected: binding.fileIdentity,
  });
  let database: Database | null = null;
  try {
    database = new Database(binding.filePath, {
      create: false,
      readwrite: true,
      strict: true,
    });
    fileGuard.assertCurrent();
    database.run('PRAGMA busy_timeout = 0');
    assertRollbackJournal(database);
    assertLivenessTable(database);
    database.run('BEGIN DEFERRED');
    readLivenessSentinel(database, expectedGeneration);
    if (!database.inTransaction) throw livenessOpenFailed();
    fileGuard.assertCurrent();
  } catch (error) {
    if (cleanupFailedGuard(database, fileGuard)) {
      throw livenessCleanupFailed();
    }
    if (error instanceof DatabaseError) throw error;
    throw livenessOpenFailed();
  }

  let released = false;
  const liveDatabase = database;
  const guard: DatabaseActorLivenessGuard = {
    get released() {
      return released;
    },
    assertCurrent() {
      if (released || !liveDatabase.inTransaction) {
        throw new DatabaseError(
          'DATABASE_EXECUTOR_FAILED',
          'Database actor liveness lease is unavailable.',
          { retryable: false, outcome: 'unknown' },
        );
      }
      fileGuard.assertCurrent();
    },
    release() {
      if (released) return;
      const failures: unknown[] = [];
      try {
        if (liveDatabase.inTransaction) liveDatabase.run('ROLLBACK');
      } catch (error) {
        failures.push(error);
      }
      try {
        liveDatabase.close(true);
      } catch (error) {
        failures.push(error);
      }
      try {
        fileGuard.release();
      } catch (error) {
        failures.push(error);
      }
      if (failures.length > 0) {
        throw new DatabaseError(
          'DATABASE_EXECUTOR_FAILED',
          'Database actor liveness lease could not close.',
          {
            cause: failures.length === 1
              ? failures[0]
              : new AggregateError(failures),
            retryable: false,
            outcome: 'unknown',
          },
        );
      }
      released = true;
    },
    [Symbol.dispose]() {
      guard.release();
    },
  };
  return Object.freeze(guard);
}

function writeLivenessGeneration(database: Database, generation: string): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS main.${LIVENESS_TABLE} (
      singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
      format_version INTEGER NOT NULL CHECK (format_version = 1),
      generation TEXT NOT NULL CHECK (length(generation) = 36)
    ) WITHOUT ROWID
  `);
  database.query(`
    INSERT INTO main.${LIVENESS_TABLE} (singleton, format_version, generation)
    VALUES (1, 1, ?)
    ON CONFLICT(singleton) DO UPDATE SET
      format_version = excluded.format_version,
      generation = excluded.generation
  `).run(generation);
  assertLivenessTable(database);
  readLivenessSentinel(database, generation);
}

function assertLivenessTable(database: Database): void {
  const rows = database.query(`
    SELECT singleton, format_version, generation
    FROM main.${LIVENESS_TABLE}
  `).all() as Array<{
    singleton?: unknown;
    format_version?: unknown;
    generation?: unknown;
  }>;
  if (rows.length !== 1
    || rows[0]?.singleton !== 1
    || rows[0]?.format_version !== 1
    || typeof rows[0]?.generation !== 'string'
    || !LIVENESS_GENERATION_PATTERN.test(rows[0].generation)) {
    throw livenessOpenFailed();
  }
}

function readLivenessSentinel(
  database: Database,
  expectedGeneration: string,
): void {
  const row = database.query(`
    SELECT format_version, generation
    FROM main.${LIVENESS_TABLE}
    WHERE singleton = 1
  `).get() as { format_version?: unknown; generation?: unknown } | null;
  if (row?.format_version !== 1
    || row.generation !== expectedGeneration) {
    throw staleActorAuthority();
  }
}

function validateLivenessGeneration(value: unknown): string {
  if (typeof value !== 'string' || !LIVENESS_GENERATION_PATTERN.test(value)) {
    throw livenessOpenFailed();
  }
  return value;
}

function assertRollbackJournal(database: Database): void {
  const row = database.query('PRAGMA journal_mode = DELETE').get() as {
    journal_mode?: unknown;
  } | null;
  if (typeof row?.journal_mode !== 'string'
    || row.journal_mode.toLowerCase() !== 'delete') {
    throw livenessOpenFailed();
  }
}

function cleanupFailedGuard(
  database: Database | null,
  fileGuard: DatabaseFileIdentityGuard,
): boolean {
  let cleanupFailed = false;
  if (database) {
    try {
      if (database.inTransaction) database.run('ROLLBACK');
    } catch {
      cleanupFailed = true;
    }
    try { database.close(true); } catch { cleanupFailed = true; }
  }
  try { fileGuard.release(); } catch { cleanupFailed = true; }
  return cleanupFailed;
}

function isSQLiteContention(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; errno?: unknown };
  return candidate.errno === 5
    || candidate.errno === 6
    || (typeof candidate.code === 'string'
      && (candidate.code === 'SQLITE_BUSY'
        || candidate.code.startsWith('SQLITE_BUSY_')
        || candidate.code === 'SQLITE_LOCKED'
        || candidate.code.startsWith('SQLITE_LOCKED_')));
}

function staleActorConflict(): DatabaseError {
  return new DatabaseError(
    'DATABASE_CONFLICT',
    'Database root still has actors from an earlier coordinator generation.',
    { retryable: true, outcome: 'not-started' },
  );
}

function staleActorAuthority(): DatabaseError {
  return new DatabaseError(
    'DATABASE_AUTHORITY_CHANGED',
    'Database actor belongs to an earlier coordinator generation.',
    { retryable: false, outcome: 'not-started' },
  );
}

function livenessOpenFailed(): DatabaseError {
  return new DatabaseError(
    'DATABASE_OPEN_FAILED',
    'Database actor liveness boundary could not be established.',
    { retryable: true, outcome: 'not-started' },
  );
}

function livenessCleanupFailed(): DatabaseError {
  return new DatabaseError(
    'DATABASE_EXECUTOR_FAILED',
    'Database actor liveness boundary cleanup failed.',
    { retryable: false, outcome: 'unknown' },
  );
}
