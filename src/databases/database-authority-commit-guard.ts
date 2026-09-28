/**
 * Bridges the default auth/control-plane ReactiveDB transaction to the
 * tenant-database shared/exclusive commit coordinator.
 *
 * Authority-table triggers advance one durable revision inside the same
 * SQLite transaction. The final commit guard acquires exclusive ownership
 * only when that revision changed. It never waits with SQLite locks held: a
 * concurrent tenant commit causes a retryable rollback instead.
 */

import { readAuthAuthorityRevision } from '../auth/auth-authority-revision';
import {
  registerReactiveDBCommitGuard,
  type ReactiveDB,
} from '../sync/reactive-db';
import { AuthorityCommitCoordinator } from './authority-commit-coordinator';
import { DatabaseError } from './database-error';

/** Install the authority-revision commit fence on one control-plane DB. */
export function registerDatabaseAuthorityCommitGuard(
  db: ReactiveDB,
  coordinator: AuthorityCommitCoordinator,
): () => void {
  if (!(coordinator instanceof AuthorityCommitCoordinator)) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database authority commit coordinator is invalid.',
    );
  }

  return registerReactiveDBCommitGuard(db, {
    capture: () => readAuthAuthorityRevision(db),
    beforeCommit: (capturedRevision) => {
      const currentRevision = readAuthAuthorityRevision(db);
      if (capturedRevision === currentRevision) return undefined;

      const lease = coordinator.tryAcquireExclusive();
      if (!lease) {
        throw new DatabaseError(
          'DATABASE_CONFLICT',
          'Authorization state changed while a tenant commit was active; retry the control-plane operation.',
          { retryable: true, outcome: 'not-committed' },
        );
      }
      return () => {
        lease.release();
        return undefined;
      };
    },
  });
}
