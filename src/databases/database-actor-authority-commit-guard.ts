/** Actor-local final-edge fence against file-backed Guardian authority. */

import { Database } from 'bun:sqlite';

import { AUTH_AUTHORITY_REVISION_TABLE } from '../auth/auth-authority-revision';
import {
  registerReactiveDBCommitGuard,
  type ReactiveDB,
} from '../sync/reactive-db';
import type {
  DatabaseActorAuthorityCommitFenceConfig,
} from './database-actor-protocol';
import { DatabaseAuthorityCommitFileFence } from './database-authority-commit-file-fence';
import { DatabaseError } from './database-error';
import {
  openDatabaseFileIdentityGuard,
  type DatabaseFileIdentityGuard,
} from './database-file-identity';

/**
 * One writer-generation guard. Its operation context exists only for the
 * current synchronous actor request, so no stale ambient authority can leak
 * into a later application write.
 */
export class DatabaseActorAuthorityCommitGuard {
  readonly #systemDatabase: Database;
  readonly #systemIdentity: DatabaseFileIdentityGuard;
  readonly #revisionStatement: ReturnType<Database['prepare']>;
  readonly #fileFence: DatabaseAuthorityCommitFileFence;
  readonly #removeCommitGuard: () => void;
  #operationContext: number | false | null = null;
  #closed = false;

  private constructor(
    targetDB: ReactiveDB,
    config: DatabaseActorAuthorityCommitFenceConfig,
  ) {
    let systemIdentity: DatabaseFileIdentityGuard | null = null;
    let systemDatabase: Database | null = null;
    let revisionStatement: ReturnType<Database['prepare']> | null = null;
    let fileFence: DatabaseAuthorityCommitFileFence | null = null;
    let removeCommitGuard: (() => void) | null = null;
    try {
      systemIdentity = openDatabaseFileIdentityGuard(
        config.systemDatabasePath,
        {
          access: 'read',
          expected: config.systemDatabaseIdentity,
        },
      );
      systemDatabase = new Database(config.systemDatabasePath, {
        readonly: true,
        strict: true,
      });
      systemDatabase.run('PRAGMA busy_timeout = 0');
      systemDatabase.run('PRAGMA query_only = ON');
      systemIdentity.assertCurrent();
      revisionStatement = systemDatabase.prepare(`
        SELECT revision
        FROM ${AUTH_AUTHORITY_REVISION_TABLE}
        WHERE singleton = 1
      `);
      assertAuthorityRevision(readRevision(revisionStatement));
      fileFence = new DatabaseAuthorityCommitFileFence(
        config.systemDatabasePath,
      );

      this.#systemDatabase = systemDatabase;
      this.#systemIdentity = systemIdentity;
      this.#revisionStatement = revisionStatement;
      this.#fileFence = fileFence;
      removeCommitGuard = registerReactiveDBCommitGuard(targetDB, {
        capture: () => this.#captureExpectedRevision(),
        beforeCommit: (revision) => this.#beforeCommit(revision),
      });
      this.#removeCommitGuard = removeCommitGuard;
      return;
    } catch (error) {
      const cleanupFailed = closePartialBinding({
        removeCommitGuard,
        revisionStatement,
        systemDatabase,
        systemIdentity,
        fileFence,
      });
      if (cleanupFailed) throw cleanupFailure();
      if (error instanceof DatabaseError) throw error;
      throw openFailure();
    }
  }

  static open(
    targetDB: ReactiveDB,
    config: DatabaseActorAuthorityCommitFenceConfig,
  ): DatabaseActorAuthorityCommitGuard {
    return new DatabaseActorAuthorityCommitGuard(targetDB, config);
  }

  /** Run one protected actor operation with an explicitly supplied revision. */
  run<T>(authorityRevision: number | undefined, operation: () => T): T {
    if (this.#closed) throw closedFailure();
    if (!Number.isSafeInteger(authorityRevision)
      || (authorityRevision as number) < 0) {
      throw new DatabaseError(
        'DATABASE_PROTOCOL_ERROR',
        'Protected database actor write is missing authority revision.',
        { retryable: false, outcome: 'not-started' },
      );
    }
    if (this.#operationContext !== null) {
      throw new DatabaseError(
        'DATABASE_PROTOCOL_ERROR',
        'Database actor authority context is already active.',
        { retryable: false, outcome: 'not-started' },
      );
    }
    this.#operationContext = authorityRevision as number;
    try {
      return operation();
    } finally {
      this.#operationContext = null;
    }
  }

  /**
   * Run framework-owned monotonic identity-anchor maintenance without an
   * application-authority lease. Anchors provide referential existence only;
   * they never grant live Guardian authority.
   */
  runAuthorityNeutral<T>(operation: () => T): T {
    if (this.#closed) throw closedFailure();
    if (this.#operationContext !== null) {
      throw new DatabaseError(
        'DATABASE_PROTOCOL_ERROR',
        'Database actor authority context is already active.',
        { retryable: false, outcome: 'not-started' },
      );
    }
    this.#operationContext = false;
    try {
      return operation();
    } finally {
      this.#operationContext = null;
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    const cleanupFailed = closePartialBinding({
      removeCommitGuard: this.#removeCommitGuard,
      revisionStatement: this.#revisionStatement,
      systemDatabase: this.#systemDatabase,
      systemIdentity: this.#systemIdentity,
      fileFence: this.#fileFence,
    });
    if (cleanupFailed) throw cleanupFailure();
  }

  #captureExpectedRevision(): number | false {
    if (this.#closed || this.#operationContext === null) {
      throw authorityChanged();
    }
    return this.#operationContext;
  }

  #beforeCommit(snapshot: string | number | boolean | null | undefined):
  (() => undefined) | undefined {
    if (snapshot === false) {
      try {
        // Neutral maintenance does not join the application-authority fence,
        // but it must still belong to the system file proven at actor bind.
        this.#systemIdentity.assertCurrent();
        return undefined;
      } catch (error) {
        throw verificationFailure(error);
      }
    }
    if (!Number.isSafeInteger(snapshot) || (snapshot as number) < 0) {
      throw authorityChanged();
    }
    const lease = this.#fileFence.tryAcquireShared();
    if (!lease) throw authorityChanged();
    try {
      this.#systemIdentity.assertCurrent();
      const currentRevision = readRevision(this.#revisionStatement);
      assertAuthorityRevision(currentRevision);
      if (currentRevision !== snapshot) throw authorityChanged();
      return () => {
        lease.release();
        return undefined;
      };
    } catch (error) {
      lease.release();
      throw verificationFailure(error);
    }
  }
}

interface PartialBinding {
  readonly removeCommitGuard: (() => void) | null;
  readonly revisionStatement: ReturnType<Database['prepare']> | null;
  readonly systemDatabase: Database | null;
  readonly systemIdentity: DatabaseFileIdentityGuard | null;
  readonly fileFence: DatabaseAuthorityCommitFileFence | null;
}

function closePartialBinding(binding: PartialBinding): boolean {
  let failed = false;
  const close = (operation: () => void): void => {
    try {
      operation();
    } catch {
      failed = true;
    }
  };
  if (binding.removeCommitGuard) close(binding.removeCommitGuard);
  if (binding.revisionStatement) {
    close(() => binding.revisionStatement!.finalize());
  }
  if (binding.systemDatabase) {
    close(() => binding.systemDatabase!.close(true));
  }
  if (binding.systemIdentity) close(() => binding.systemIdentity!.release());
  if (binding.fileFence) close(() => binding.fileFence!.close());
  return failed;
}

function readRevision(
  statement: ReturnType<Database['prepare']>,
): unknown {
  const row = statement.get() as { revision?: unknown } | null;
  return row?.revision;
}

function assertAuthorityRevision(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new DatabaseError(
      'DATABASE_SCHEMA_MISMATCH',
      'Guardian authority revision is unavailable to the database actor.',
      { retryable: false, outcome: 'not-started' },
    );
  }
}

function authorityChanged(): DatabaseError {
  return new DatabaseError(
    'DATABASE_AUTHORITY_CHANGED',
    'Guardian authority changed before the tenant database commit.',
    { retryable: false, outcome: 'not-committed' },
  );
}

function verificationFailure(error: unknown): DatabaseError {
  if (error instanceof DatabaseError) {
    if (error.outcome === 'unknown') return error;
    return new DatabaseError(
      error.code,
      'Database actor authority verification failed at the commit edge.',
      {
        retryable: error.retryable,
        outcome: 'not-committed',
      },
    );
  }
  return new DatabaseError(
    'DATABASE_EXECUTOR_FAILED',
    'Database actor authority binding could not be verified.',
    { retryable: true, outcome: 'not-committed' },
  );
}

function openFailure(): DatabaseError {
  return new DatabaseError(
    'DATABASE_OPEN_FAILED',
    'Database actor authority fence could not be opened.',
    { retryable: true, outcome: 'not-started' },
  );
}

function cleanupFailure(): DatabaseError {
  return new DatabaseError(
    'DATABASE_EXECUTOR_FAILED',
    'Database actor authority fence cleanup failed.',
    { retryable: false, outcome: 'unknown' },
  );
}

function closedFailure(): DatabaseError {
  return new DatabaseError(
    'DATABASE_CLOSED',
    'Database actor authority fence is closed.',
    { retryable: false, outcome: 'not-started' },
  );
}
