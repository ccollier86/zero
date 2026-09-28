/**
 * database-root-ownership.ts
 *
 * Process-safe exclusive ownership for one Zero-managed database root. The
 * claim lives in SQLite's OS-backed file lock, not in persistent owner data,
 * so process death releases it without a stale-lock recovery protocol.
 *
 * This contract requires a local filesystem whose SQLite VFS locking works
 * correctly. The private ownership database must never be renamed, unlinked,
 * copied over, or otherwise replaced while a guard is active.
 */

import { Database } from 'bun:sqlite';
import { join } from 'node:path';

import { DatabaseError } from './database-error';
import {
  prepareDatabaseFile,
  prepareDatabaseRoot,
} from './database-file';

const ROOT_OWNERSHIP_DATABASE_ID = '_zero_root_ownership_v1';
const ROOT_OWNERSHIP_INTERNAL_DIRECTORY = '.zero-internal';
const ROOT_OWNERSHIP_REGISTRY_SYMBOL = Symbol.for(
  'zero.database-root-ownership.active.v1',
);

/** A lifetime claim over one canonical Zero-managed database root. */
export interface DatabaseRootOwnershipGuard extends Disposable {
  /** True only after the SQLite handle and OS lock were released cleanly. */
  readonly released: boolean;
  /** Release the SQLite transaction and its OS file lock exactly once. */
  release(): void;
}

/**
 * Acquire exclusive writer-topology ownership of a managed database root.
 *
 * The dedicated ownership database deliberately uses rollback-journal mode.
 * `BEGIN EXCLUSIVE` then holds an exclusive file lock for the guard lifetime;
 * a second process fails immediately because this connection uses a zero busy
 * timeout. Closing or crashing the owner releases the operating-system lock,
 * while the harmless database file can remain for the next claimant.
 */
export function acquireDatabaseRootOwnership(
  rootDirectory: string,
): DatabaseRootOwnershipGuard {
  if (typeof rootDirectory !== 'string' || rootDirectory.length === 0) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database root ownership requires a root directory.',
    );
  }

  let canonicalRoot: string;
  try {
    canonicalRoot = prepareDatabaseRoot(rootDirectory);
  } catch {
    // Filesystem errors can contain the configured path. Keep that value out
    // of both the public error and its in-process cause chain.
    throw ownershipOpenFailed();
  }

  const registry = activeRootRegistry();
  if (registry.has(canonicalRoot)) throw ownershipConflict();

  // Reserve the canonical root in-process before touching the ownership inode.
  // Besides making a second local claim fail cheaply, this avoids opening and
  // closing that inode outside SQLite while its POSIX advisory lock is held.
  registry.add(canonicalRoot);

  let ownershipPath: string;
  try {
    ownershipPath = prepareDatabaseFile(
      join(canonicalRoot, ROOT_OWNERSHIP_INTERNAL_DIRECTORY),
      ROOT_OWNERSHIP_DATABASE_ID,
    ).path;
  } catch {
    registry.delete(canonicalRoot);
    throw ownershipOpenFailed();
  }

  let connection: Database | null = null;
  try {
    connection = new Database(ownershipPath, {
      create: false,
      readwrite: true,
      strict: true,
    });
    connection.run('PRAGMA busy_timeout = 0');

    const journal = connection.query('PRAGMA journal_mode = DELETE').get() as {
      journal_mode?: unknown;
    } | null;
    if (typeof journal?.journal_mode !== 'string'
      || journal.journal_mode.toLowerCase() !== 'delete') {
      throw ownershipOpenFailed();
    }

    connection.run('BEGIN EXCLUSIVE');
    if (!connection.inTransaction) throw ownershipOpenFailed();
    return new SQLiteDatabaseRootOwnershipGuard(
      connection,
      canonicalRoot,
      registry,
    );
  } catch (error) {
    const cleanupFailed = closeFailedClaim(connection);
    if (cleanupFailed) {
      // The handle may still own an OS lock. Retain the process-local
      // reservation rather than admitting an unsafe second owner.
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database root ownership cleanup failed.',
        { retryable: false, outcome: 'unknown' },
      );
    }
    registry.delete(canonicalRoot);
    if (isSQLiteContention(error)) throw ownershipConflict();
    if (error instanceof DatabaseError) throw error;
    throw ownershipOpenFailed();
  }
}

class SQLiteDatabaseRootOwnershipGuard implements DatabaseRootOwnershipGuard {
  constructor(
    private connection: Database | null,
    private readonly canonicalRoot: string,
    private readonly registry: Set<string>,
  ) {}

  get released(): boolean {
    return this.connection === null;
  }

  release(): void {
    const connection = this.connection;
    if (!connection) return;
    if (closeFailedClaim(connection)) {
      // Retain both the handle and registry entry. Calling release() again is
      // allowed, but no second owner is admitted while cleanup is uncertain.
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database root ownership could not be released cleanly.',
        { retryable: false, outcome: 'unknown' },
      );
    }
    this.connection = null;
    this.registry.delete(this.canonicalRoot);
  }

  [Symbol.dispose](): void {
    this.release();
  }
}

function closeFailedClaim(connection: Database | null): boolean {
  if (!connection) return false;
  try {
    if (connection.inTransaction) {
      connection.run('ROLLBACK');
    }
  } catch {
    // A forced close is still authoritative if SQLite accepts it. This also
    // covers a retry after an earlier close left the handle's state uncertain.
  }
  try {
    // Bun's forced close finalizes owned statements, releases the underlying
    // handle immediately, and surfaces SQLite close failures.
    connection.close(true);
    return false;
  } catch {
    return true;
  }
}

function activeRootRegistry(): Set<string> {
  const host = globalThis as unknown as Record<PropertyKey, unknown>;
  const existing = host[ROOT_OWNERSHIP_REGISTRY_SYMBOL];
  if (existing instanceof Set) return existing as Set<string>;
  if (existing !== undefined) {
    throw new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'Database root ownership registry is unavailable.',
      { retryable: false, outcome: 'unknown' },
    );
  }

  const registry = new Set<string>();
  Object.defineProperty(host, ROOT_OWNERSHIP_REGISTRY_SYMBOL, {
    configurable: false,
    enumerable: false,
    value: registry,
    writable: false,
  });
  return registry;
}

function isSQLiteContention(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const sqliteError = error as { code?: unknown; errno?: unknown };
  return sqliteError.errno === 5
    || sqliteError.errno === 6
    || (typeof sqliteError.code === 'string'
      && (sqliteError.code === 'SQLITE_BUSY'
        || sqliteError.code.startsWith('SQLITE_BUSY_')
        || sqliteError.code === 'SQLITE_LOCKED'
        || sqliteError.code.startsWith('SQLITE_LOCKED_')));
}

function ownershipConflict(): DatabaseError {
  return new DatabaseError(
    'DATABASE_CONFLICT',
    'Database root is already owned by another coordinator.',
    { retryable: true, outcome: 'not-started' },
  );
}

function ownershipOpenFailed(): DatabaseError {
  return new DatabaseError(
    'DATABASE_OPEN_FAILED',
    'Database root ownership could not be acquired.',
    { retryable: true, outcome: 'not-started' },
  );
}
