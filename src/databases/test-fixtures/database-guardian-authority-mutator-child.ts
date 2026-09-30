/** Independent Guardian writer used by cross-process Fabric fence tests. */

import { readAuthAuthorityRevision } from '../../auth/auth-authority-revision';
import { createReactiveDB } from '../../sync/reactive-db';
import { AuthorityCommitCoordinator } from '../authority-commit-coordinator';
import { DatabaseAuthorityCommitFileFence } from '../database-authority-commit-file-fence';
import { registerDatabaseAuthorityCommitGuard } from '../database-authority-commit-guard';
import { DatabaseError } from '../database-error';

const systemDatabasePath = process.argv[2];
const userId = process.argv[3];
const nextRole = process.argv[4];
if (!systemDatabasePath || !userId || !nextRole) {
  process.exitCode = 64;
} else {
  const db = createReactiveDB({ mode: 'file', path: systemDatabasePath });
  const coordinator = new AuthorityCommitCoordinator();
  const fence = new DatabaseAuthorityCommitFileFence(systemDatabasePath);
  const removeGuard = registerDatabaseAuthorityCommitGuard(
    db,
    coordinator,
    fence,
  );
  try {
    db.transaction(() => {
      db.prepare('UPDATE users SET role = ? WHERE user_id = ?')
        .run(nextRole, userId);
    });
    process.stdout.write(`${JSON.stringify({
      status: 'committed',
      revision: readAuthAuthorityRevision(db),
    })}\n`);
  } catch (error) {
    const failure = error instanceof DatabaseError
      ? error
      : new DatabaseError('DATABASE_EXECUTOR_FAILED', 'Guardian mutation failed.');
    process.stdout.write(`${JSON.stringify({
      status: 'rejected',
      code: failure.code,
      retryable: failure.retryable,
      outcome: failure.outcome,
    })}\n`);
  } finally {
    removeGuard();
    fence.close();
    await coordinator.close();
    db.dispose();
  }
}
