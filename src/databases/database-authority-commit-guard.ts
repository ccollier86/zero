/**
 * Bridges the default auth/control-plane ReactiveDB transaction to the
 * tenant-database shared/exclusive commit coordinator.
 *
 * Authority-table triggers advance one durable revision inside the same
 * SQLite transaction. The final commit guard acquires exclusive ownership
 * only when that revision changed. Async auth callers may reserve a fair turn
 * before entering SQLite; direct synchronous callers still fail closed on a
 * conflict. The final guard never waits with SQLite locks held.
 */

import { readAuthAuthorityRevision } from '../auth/auth-authority-revision';
import {
  registerReactiveDBCommitGuard,
  type ReactiveDB,
} from '../sync/reactive-db';
import { AuthorityCommitCoordinator } from './authority-commit-coordinator';
import type { AuthorityCommitLease } from './authority-commit-coordinator';
import { registerReactiveDBCommitAdmission } from '../sync/reactive-db-commit-admission';
import { DatabaseAuthorityCommitFileFence } from './database-authority-commit-file-fence';
import { DatabaseError } from './database-error';

/** Install the authority-revision commit fence on one control-plane DB. */
export function registerDatabaseAuthorityCommitGuard(
  db: ReactiveDB,
  coordinator: AuthorityCommitCoordinator,
  fileFence?: DatabaseAuthorityCommitFileFence,
): () => void {
  if (!(coordinator instanceof AuthorityCommitCoordinator)
    || (fileFence !== undefined
      && !(fileFence instanceof DatabaseAuthorityCommitFileFence))) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database authority commit coordinator is invalid.',
    );
  }
  fileFence?.assertSystemDatabaseBinding(db);

  let active = true;
  const removeGuard = registerReactiveDBCommitGuard(db, {
    capture: () => {
      assertSystemFileCurrent(fileFence, 'not-started');
      return requireAuthorityRevision(
        readAuthAuthorityRevision(db),
        'not-started',
      );
    },
    beforeCommit: (capturedRevision) => {
      const captured = requireAuthorityRevision(
        capturedRevision,
        'not-committed',
      );
      assertSystemFileCurrent(fileFence, 'not-committed');
      const currentRevision = requireAuthorityRevision(
        readAuthAuthorityRevision(db),
        'not-committed',
      );
      if (captured === currentRevision) return undefined;

      const localLease = coordinator.tryAcquireExclusive();
      if (!localLease) throw authorityConflict();
      let fileLease: ReturnType<DatabaseAuthorityCommitFileFence['tryAcquireExclusive']> = null;
      try {
        if (fileFence) {
          fileLease = fileFence.tryAcquireExclusive();
          if (!fileLease) throw authorityConflict();
        }
        return () => {
          try {
            fileLease?.release();
          } finally {
            localLease?.release();
          }
          return undefined;
        };
      } catch (error) {
        try {
          fileLease?.release();
        } finally {
          localLease?.release();
        }
        throw error;
      }
    },
  });
  let removeAdmission: () => void;
  try {
    removeAdmission = registerReactiveDBCommitAdmission(db, async (operation, options) => {
      let lease: AuthorityCommitLease;
      try {
        lease = await coordinator.acquireExclusive({ ...options, timeoutMs: options.timeoutMs ?? 5_000 });
      } catch (error) {
        if (error instanceof DatabaseError
          && (error.code === 'DATABASE_QUEUE_TIMEOUT' || error.code === 'DATABASE_BACKPRESSURE')) {
          throw authorityConflict();
        }
        throw error;
      }
      try {
        if (!active) throw new DatabaseError('DATABASE_CLOSED', 'Authority commit admission is closed.');
        if (options.signal?.aborted) throw authorityConflict();
        return coordinator.runSynchronousExclusiveTurn(lease, operation);
      } finally { lease.release(); }
    });
  } catch (error) {
    removeGuard();
    throw error;
  }
  return () => { active = false; removeAdmission(); removeGuard(); };
}

function assertSystemFileCurrent(
  fileFence: DatabaseAuthorityCommitFileFence | undefined,
  outcome: 'not-started' | 'not-committed',
): void {
  if (!fileFence) return;
  try {
    fileFence.assertSystemDatabaseCurrent();
  } catch {
    throw new DatabaseError(
      'DATABASE_OPEN_FAILED',
      'Guardian system database file identity changed.',
      { retryable: false, outcome },
    );
  }
}

function requireAuthorityRevision(
  value: unknown,
  outcome: 'not-started' | 'not-committed',
): number {
  if (Number.isSafeInteger(value) && (value as number) >= 0) {
    return value as number;
  }
  throw new DatabaseError(
    'DATABASE_SCHEMA_MISMATCH',
    'Guardian authority revision is unavailable.',
    { retryable: false, outcome },
  );
}

function authorityConflict(): DatabaseError {
  return new DatabaseError(
    'DATABASE_CONFLICT',
    'Authorization state changed while an application commit was active; retry the control-plane operation.',
    { retryable: true, outcome: 'not-committed' },
  );
}
