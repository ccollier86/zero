/**
 * Process-safe final-commit fence shared by application and Guardian writers.
 *
 * The fence uses a dedicated rollback-journal SQLite file. A non-blocking
 * `BEGIN EXCLUSIVE` is held only across the final commit of another database.
 * SQLite's operating-system lock is released automatically if the process
 * exits, so the file contains no durable owner or lease state to recover.
 */

import { Database } from 'bun:sqlite';
import {
  closeSync,
  constants as fsConstants,
  openSync,
} from 'node:fs';

import { DatabaseError } from './database-error';
import {
  openDatabaseFileIdentityGuard,
  sameDatabaseFileIdentity,
  type DatabaseFileIdentityGuard,
} from './database-file-identity';
import { canonicalizeDatabasePathCandidate } from './database-path-ownership';
import type { ReactiveDB } from '../sync/reactive-db';
import { proveDatabaseSystemHandleBinding } from './database-system-handle-binding';

export const DATABASE_AUTHORITY_COMMIT_FENCE_SUFFIX =
  '.authority-fence.sqlite' as const;

const FENCE_TABLE = '_zero_authority_commit_fence';
const FENCE_TABLE_SCHEMA = `
  CREATE TABLE ${FENCE_TABLE} (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1)
  )
`;
const FENCE_STARTUP_BUSY_TIMEOUT_MS = 5_000;

export type DatabaseAuthorityCommitFileLeaseMode = 'shared' | 'exclusive';

/** Opaque ownership of one cross-process final-commit boundary. */
export interface DatabaseAuthorityCommitFileLease {
  readonly mode: DatabaseAuthorityCommitFileLeaseMode;
  readonly released: boolean;
  release(): void;
}

/** Derive the Zero-owned fence sidecar for one file-backed system database. */
export function databaseAuthorityCommitFencePath(
  systemDatabasePath: string,
): string {
  if (typeof systemDatabasePath !== 'string' || systemDatabasePath.length === 0) {
    throw configInvalid();
  }
  try {
    return `${canonicalizeDatabasePathCandidate(systemDatabasePath)}`
      + DATABASE_AUTHORITY_COMMIT_FENCE_SUFFIX;
  } catch {
    throw configInvalid();
  }
}

/**
 * A process-local handle to the cross-process authority commit boundary.
 *
 * Every Zero process opens its own handle to the same derived sidecar. The
 * sidecar is coordination state only and never contains identity or app data.
 */
export class DatabaseAuthorityCommitFileFence {
  #database: Database | null = null;
  #fileIdentity: DatabaseFileIdentityGuard | null = null;
  #systemIdentity: DatabaseFileIdentityGuard | null = null;
  #systemDatabasePath: string | null = null;
  #leaseMode: DatabaseAuthorityCommitFileLeaseMode | null = null;

  constructor(systemDatabasePath: string) {
    let canonicalSystemPath: string;
    try {
      canonicalSystemPath = canonicalizeDatabasePathCandidate(systemDatabasePath);
    } catch {
      throw configInvalid();
    }
    const path = databaseAuthorityCommitFencePath(canonicalSystemPath);
    let database: Database | null = null;
    let fileIdentity: DatabaseFileIdentityGuard | null = null;
    let systemIdentity: DatabaseFileIdentityGuard | null = null;
    try {
      systemIdentity = openDatabaseFileIdentityGuard(canonicalSystemPath, {
        access: 'read',
      });
      ensureFenceFile(path);
      // Retain a no-follow proof before SQLite opens the pathname. The checks
      // immediately after open and before every acquisition prevent a replaced
      // sidecar from splitting Guardian and tenant writers across two inodes.
      fileIdentity = openDatabaseFileIdentityGuard(path, {
        access: 'readwrite',
      });
      database = new Database(path, {
        create: false,
        readwrite: true,
        strict: true,
      });
      fileIdentity.assertCurrent();
      // Construction is a startup boundary, not the final commit edge. Wait
      // for a currently active Guardian EXCLUSIVE lease to finish, then switch
      // to non-blocking acquisition before publishing this handle.
      database.run(`PRAGMA busy_timeout = ${FENCE_STARTUP_BUSY_TIMEOUT_MS}`);
      initializeFence(database);
      validateFence(database);
      database.run('PRAGMA busy_timeout = 0');
      systemIdentity.assertCurrent();
      fileIdentity.assertCurrent();
      this.#database = database;
      this.#fileIdentity = fileIdentity;
      this.#systemIdentity = systemIdentity;
      this.#systemDatabasePath = canonicalSystemPath;
    } catch (error) {
      const cleanupFailures = closeRejectedDatabase(
        database,
        fileIdentity,
        systemIdentity,
      );
      if (cleanupFailures.length > 0) {
        throw new DatabaseError(
          'DATABASE_EXECUTOR_FAILED',
          'Authority commit fence startup cleanup failed.',
          {
            cause: new AggregateError([error, ...cleanupFailures]),
            retryable: false,
            outcome: 'unknown',
          },
        );
      }
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError(
        'DATABASE_OPEN_FAILED',
        'Authority commit fence could not be opened.',
        { retryable: true, outcome: 'not-started' },
      );
    }
  }

  /** Acquire the data-writer side without excluding other data databases. */
  tryAcquireShared(): DatabaseAuthorityCommitFileLease | null {
    return this.#tryAcquire('shared');
  }

  /** Acquire the Guardian authority-writer side on the current stack. */
  tryAcquireExclusive(): DatabaseAuthorityCommitFileLease | null {
    return this.#tryAcquire('exclusive');
  }

  /** Assert that the system pathname still names the startup-bound inode. */
  assertSystemDatabaseCurrent(): void {
    const systemIdentity = this.#systemIdentity;
    if (!systemIdentity) throw closedError();
    systemIdentity.assertCurrent();
  }

  /** Prove a registration-time ReactiveDB handle owns this exact system file. */
  assertSystemDatabaseBinding(systemDB: ReactiveDB): void {
    const systemIdentity = this.#systemIdentity;
    const systemDatabasePath = this.#systemDatabasePath;
    if (!systemIdentity || !systemDatabasePath) throw closedError();
    let binding;
    try {
      binding = proveDatabaseSystemHandleBinding(systemDB, systemDatabasePath);
    } catch (error) {
      if (error instanceof DatabaseError && error.outcome === 'unknown') {
        throw error;
      }
      throw configInvalid();
    }
    if (!sameDatabaseFileIdentity(binding.fileIdentity, systemIdentity.proof)) {
      throw configInvalid();
    }
  }

  #tryAcquire(
    mode: DatabaseAuthorityCommitFileLeaseMode,
  ): DatabaseAuthorityCommitFileLease | null {
    const database = this.#database;
    if (!database) throw closedError();
    const fileIdentity = this.#fileIdentity;
    if (!fileIdentity) throw closedError();
    if (this.#leaseMode !== null) {
      throw new DatabaseError(
        'DATABASE_CONFLICT',
        'Authority commit fence is already active in this runtime.',
        { retryable: true, outcome: 'not-committed' },
      );
    }

    try {
      fileIdentity.assertCurrent();
      if (mode === 'exclusive') {
        database.run('BEGIN EXCLUSIVE');
      } else {
        // A deferred transaction does not own a lock until its first read.
        // Reading the singleton establishes a rollback-journal SHARED lock:
        // other data commits may share it, while Guardian's EXCLUSIVE edge
        // fails immediately instead of waiting behind a foreign SQLite lock.
        database.run('BEGIN');
        database.query(`SELECT singleton FROM ${FENCE_TABLE} WHERE singleton = 1`)
          .get();
      }
      fileIdentity.assertCurrent();
    } catch (error) {
      const cleanupFailure = rollbackRejectedAcquisition(database);
      if (cleanupFailure !== null) {
        throw new DatabaseError(
          'DATABASE_OUTCOME_UNKNOWN',
          'Authority commit fence acquisition cleanup failed.',
          {
            cause: new AggregateError([error, cleanupFailure]),
            retryable: false,
            outcome: 'unknown',
          },
        );
      }
      if (isSQLiteContention(error)) return null;
      if (error instanceof DatabaseError
        && error.code === 'DATABASE_OPEN_FAILED') {
        throw new DatabaseError(
          'DATABASE_OPEN_FAILED',
          'Authority commit fence file identity changed.',
          { retryable: false, outcome: 'not-committed' },
        );
      }
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Authority commit fence acquisition failed.',
        { retryable: false, outcome: 'not-committed' },
      );
    }
    if (!database.inTransaction) {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Authority commit fence acquisition failed.',
        { retryable: false, outcome: 'not-committed' },
      );
    }

    this.#leaseMode = mode;
    let released = false;
    return Object.freeze({
      mode,
      get released() {
        return released;
      },
      release: () => {
        if (released) return;
        released = true;
        this.#releaseLease();
      },
    });
  }

  /** Close the sidecar handle after request admission and commit guards stop. */
  close(): void {
    const database = this.#database;
    const fileIdentity = this.#fileIdentity;
    const systemIdentity = this.#systemIdentity;
    if (!database && !fileIdentity && !systemIdentity) return;
    const failures: unknown[] = [];
    if (database && (this.#leaseMode !== null || database.inTransaction)) {
      try {
        database.run('ROLLBACK');
      } catch (error) {
        failures.push(error);
      }
      this.#leaseMode = null;
    }
    if (database) {
      try {
        database.close(true);
        this.#database = null;
      } catch (error) {
        failures.push(error);
      }
    }
    // Keep the pathname identity pinned until the SQLite handle is proven
    // closed. If close is indeterminate, a later close attempt retains both.
    if (this.#database === null && fileIdentity) {
      try {
        fileIdentity.release();
        this.#fileIdentity = null;
      } catch (error) {
        failures.push(error);
      }
    }
    if (this.#database === null
      && this.#fileIdentity === null
      && systemIdentity) {
      try {
        systemIdentity.release();
        this.#systemIdentity = null;
        this.#systemDatabasePath = null;
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Authority commit fence could not be closed.',
        {
          cause: new AggregateError(failures),
          retryable: false,
          outcome: 'unknown',
        },
      );
    }
  }

  #releaseLease(): void {
    const database = this.#database;
    if (!database || this.#leaseMode === null) return;
    try {
      database.run('ROLLBACK');
      this.#leaseMode = null;
    } catch (error) {
      // The protected data transaction has already either committed or rolled
      // back when this callback runs. Never invite a blind retry if releasing
      // the independent fence has an indeterminate outcome.
      throw new DatabaseError(
        'DATABASE_OUTCOME_UNKNOWN',
        'Authority commit fence release failed.',
        { cause: error, retryable: false, outcome: 'unknown' },
      );
    }
  }
}

function initializeFence(database: Database): void {
  if (readFenceDefinition(database) !== null) return;

  const journal = database.query('PRAGMA journal_mode = DELETE').get() as {
    journal_mode?: unknown;
  } | null;
  if (typeof journal?.journal_mode !== 'string'
    || journal.journal_mode.toLowerCase() !== 'delete') {
    throw fenceSchemaMismatch();
  }

  // Recheck after obtaining EXCLUSIVE ownership: multiple brand-new Zero
  // processes may observe the absent table before either one initializes it.
  // DDL and singleton creation commit atomically, so a crash cannot strand a
  // table which all future openers treat as initialized but unusable.
  database.run('BEGIN EXCLUSIVE');
  try {
    if (readFenceDefinition(database) === null) {
      database.run(FENCE_TABLE_SCHEMA);
      database.run(`INSERT INTO ${FENCE_TABLE} (singleton) VALUES (1)`);
    }
    database.run('COMMIT');
  } catch (error) {
    if (database.inTransaction) database.run('ROLLBACK');
    throw error;
  }
}

function validateFence(database: Database): void {
  const journal = database.query('PRAGMA journal_mode').get() as {
    journal_mode?: unknown;
  } | null;
  if (typeof journal?.journal_mode !== 'string'
    || journal.journal_mode.toLowerCase() !== 'delete') {
    throw fenceSchemaMismatch();
  }
  const definition = readFenceDefinition(database);
  if (definition?.type !== 'table'
    || typeof definition.sql !== 'string'
    || normalizeSchema(definition.sql) !== normalizeSchema(FENCE_TABLE_SCHEMA)) {
    throw fenceSchemaMismatch();
  }
  const rows = database.query(`SELECT singleton FROM ${FENCE_TABLE}`).all() as Array<{
    singleton?: unknown;
  }>;
  if (rows.length !== 1 || rows[0]?.singleton !== 1) {
    throw fenceSchemaMismatch();
  }
}

function readFenceDefinition(
  database: Database,
): { readonly type: unknown; readonly sql: unknown } | null {
  const row = database.query(`
    SELECT type, sql
    FROM sqlite_master
    WHERE name = '${FENCE_TABLE}'
    LIMIT 1
  `).get() as { type?: unknown; sql?: unknown } | null;
  return row ? Object.freeze({ type: row.type, sql: row.sql }) : null;
}

function normalizeSchema(sql: string): string {
  return sql.trim().replaceAll(/\s+/gu, ' ').toLowerCase();
}

function rollbackRejectedAcquisition(database: Database): unknown | null {
  if (!database.inTransaction) return null;
  try {
    database.run('ROLLBACK');
    return null;
  } catch (error) {
    return error;
  }
}

function closeRejectedDatabase(
  database: Database | null,
  fileIdentity: DatabaseFileIdentityGuard | null,
  systemIdentity: DatabaseFileIdentityGuard | null,
): unknown[] {
  const failures: unknown[] = [];
  if (database) {
    try {
      if (database.inTransaction) database.run('ROLLBACK');
    } catch (error) {
      failures.push(error);
    }
    try {
      database.close(true);
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    fileIdentity?.release();
  } catch (error) {
    failures.push(error);
  }
  try {
    systemIdentity?.release();
  } catch (error) {
    failures.push(error);
  }
  return failures;
}

function ensureFenceFile(path: string): void {
  const noFollow = typeof fsConstants.O_NOFOLLOW === 'number'
    ? fsConstants.O_NOFOLLOW
    : 0;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(
      path,
      fsConstants.O_CREAT | fsConstants.O_RDWR | noFollow,
      0o600,
    );
    closeSync(descriptor);
    descriptor = null;
  } catch (error) {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch (cleanupError) {
        throw new DatabaseError(
          'DATABASE_EXECUTOR_FAILED',
          'Authority commit fence file cleanup failed.',
          {
            cause: new AggregateError([error, cleanupError]),
            retryable: false,
            outcome: 'unknown',
          },
        );
      }
    }
    throw error;
  }
}

function isSQLiteContention(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const sqlite = error as { code?: unknown; errno?: unknown };
  return sqlite.errno === 5
    || sqlite.errno === 6
    || (typeof sqlite.code === 'string'
      && (sqlite.code === 'SQLITE_BUSY'
        || sqlite.code.startsWith('SQLITE_BUSY_')
        || sqlite.code === 'SQLITE_LOCKED'
        || sqlite.code.startsWith('SQLITE_LOCKED_')));
}

function configInvalid(): DatabaseError {
  return new DatabaseError(
    'DATABASE_CONFIG_INVALID',
    'Authority commit fence requires a file-backed system database path.',
    { retryable: false, outcome: 'not-started' },
  );
}

function fenceSchemaMismatch(): DatabaseError {
  return new DatabaseError(
    'DATABASE_SCHEMA_MISMATCH',
    'Authority commit fence schema is incompatible.',
    { retryable: false, outcome: 'not-started' },
  );
}

function closedError(): DatabaseError {
  return new DatabaseError(
    'DATABASE_CLOSED',
    'Authority commit fence is closed.',
    { retryable: false, outcome: 'not-started' },
  );
}
