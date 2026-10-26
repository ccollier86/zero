/** Fixed blog source joins core Logging's durable actor outbox and supervised delivery. No separate sink or audit database. */
import type { DatabaseCoordinator } from '../databases/database-coordinator';
import type { LoggingRuntime } from '../logging/logging-runtime';
import { installDatabaseLoggingBinding, prepareDatabaseLoggingBinding, sealDatabaseLoggingBinding } from '../databases/database-logging-binding';
import { executeCoordinatorLoggingSource } from '../databases/database-coordinator-capability';
import { currentLoggingAttribution } from '../logging/logging-attribution';
import { createDatabaseCommitAuthority } from '../databases/database-commit-authority';
import type { AuthorityCommitCoordinator } from '../databases/authority-commit-coordinator';
import { AuthError } from '../auth/types';
const ID = 'blog:content';
const SCOPE = { kind: 'application' as const, tenantId: null };
/** Install before coordinator.start(); the retained source is always the one configured blog file. */
export function installBlogContentLogging(logging: LoggingRuntime, coordinator: DatabaseCoordinator, authority: AuthorityCommitCoordinator) {
  let closing = false;
  const remove = installDatabaseLoggingBinding(coordinator, { records: logging.config.policy.capture.records, policyVersion: logging.config.policyVersion,
    sourceQueue: logging.config.sourceQueue, context: () => {
      const context = currentLoggingAttribution(logging);
      return context ? { ...context, scope: SCOPE } : null;
    } });
  prepareDatabaseLoggingBinding(coordinator, ID, SCOPE);
  const commitAuthority = createDatabaseCommitAuthority(authority, ID, () => undefined);
  const source = logging.registerDeliverySource({
    async page(acknowledge) {
      const state = coordinator.diagnostics().state;
      if (state === 'created') return { rows: [], queued: 0, bytes: 0 };
      if (state !== 'started') throw new AuthError('Blog audit source is unavailable.', 'BLOG_NOT_READY', 503);
      const lease = await coordinator.acquireExisting(ID, { commitAuthority });
      if (!lease) throw new AuthError('Retained blog audit source is missing.', 'BLOG_NOT_READY', 503);
      try { const { sourceId: _sourceId, ...page } = await executeCoordinatorLoggingSource(lease, SCOPE, acknowledge.length ? acknowledge : undefined); return page; }
      finally { lease.release(); }
    },
    failed() { if (logging.admission.required) logging.admission.invalidate(); },
  });
  return {
    wake() { if (!closing) source.wake(); },
    async close() { closing = true; sealDatabaseLoggingBinding(coordinator); try { await logging.closeDeliverySources([source]); } finally { remove(); } },
  };
}
