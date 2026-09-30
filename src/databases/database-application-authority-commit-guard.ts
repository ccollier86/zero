/**
 * Fences application-plane ReactiveDB commits against independent Guardian
 * authority commits in the system database.
 *
 * The application transaction captures the system authority revision before
 * work begins. Immediately before commit it acquires the coordinator's shared
 * side without waiting, then reads the revision again. An authority commit
 * either wins first (forcing this app transaction to roll back) or waits until
 * this app commit finishes. Existing Resource/Sync commit callbacks still
 * perform the exact session/RBAC comparison; the revision closes the final
 * cross-file gap after that comparison.
 */

import { readAuthAuthorityRevision } from '../auth/auth-authority-revision';
import {
  registerReactiveDBCommitGuard,
  type ReactiveDB,
} from '../sync/reactive-db';
import { AuthorityCommitCoordinator } from './authority-commit-coordinator';
import { DatabaseAuthorityCommitFileFence } from './database-authority-commit-file-fence';
import { DatabaseError } from './database-error';

/** Install one non-blocking shared authority fence on the application DB. */
export function registerApplicationAuthorityCommitGuard(
  applicationDB: ReactiveDB,
  systemDB: ReactiveDB,
  coordinator: AuthorityCommitCoordinator,
  fileFence?: DatabaseAuthorityCommitFileFence,
): () => void {
  if (!(coordinator instanceof AuthorityCommitCoordinator)
    || (fileFence !== undefined
      && !(fileFence instanceof DatabaseAuthorityCommitFileFence))
    || applicationDB === systemDB) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Application authority commit guard configuration is invalid.',
    );
  }
  fileFence?.assertSystemDatabaseBinding(systemDB);

  return registerReactiveDBCommitGuard(applicationDB, {
    capture: () => {
      assertSystemFileCurrent(fileFence, 'not-started');
      return requireAuthorityRevision(
        readAuthAuthorityRevision(systemDB),
        'not-started',
      );
    },
    beforeCommit: (capturedRevision) => {
      const captured = requireAuthorityRevision(
        capturedRevision,
        'not-committed',
      );
      const localLease = coordinator.tryAcquireShared();
      if (!localLease) throw authorityChanged();
      let fileLease: ReturnType<DatabaseAuthorityCommitFileFence['tryAcquireShared']> = null;
      try {
        if (fileFence) {
          fileLease = fileFence.tryAcquireShared();
          if (!fileLease) throw authorityChanged();
        }
        assertSystemFileCurrent(fileFence, 'not-committed');
        if (requireAuthorityRevision(
          readAuthAuthorityRevision(systemDB),
          'not-committed',
        ) !== captured) {
          throw authorityChanged();
        }
        return () => {
          try {
            fileLease?.release();
          } finally {
            localLease.release();
          }
          return undefined;
        };
      } catch (error) {
        try {
          fileLease?.release();
        } finally {
          localLease.release();
        }
        throw error;
      }
    },
  });
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
  if (outcome === 'not-committed') throw authorityChanged();
  throw new DatabaseError(
    'DATABASE_SCHEMA_MISMATCH',
    'Guardian authority revision is unavailable.',
    { retryable: false, outcome },
  );
}

function authorityChanged(): DatabaseError {
  return new DatabaseError(
    'DATABASE_AUTHORITY_CHANGED',
    'Authorization state changed before the application commit.',
    { retryable: false, outcome: 'not-committed' },
  );
}
