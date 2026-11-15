/** Canonical schedule writes join the existing actor source/outbox and supervised logging worker. No timer/lease audit spam. */
import type { DatabaseCoordinator } from '../databases/database-coordinator';
import { createDatabaseCommitAuthority } from '../databases/database-commit-authority';
import type { AuthorityCommitCoordinator } from '../databases/authority-commit-coordinator';
import { executeCoordinatorLoggingSource } from '../databases/database-coordinator-capability';
import { installDatabaseLoggingBinding, prepareDatabaseLoggingBinding, sealDatabaseLoggingBinding } from '../databases/database-logging-binding';
import { currentLoggingAttribution } from '../logging/logging-attribution';
import type { LoggingRuntime } from '../logging/logging-runtime';
import type { LoggingScope } from '../logging/logging-contracts';
import type { DeliverySourceRegistration } from '../logging/logging-delivery-protocol';
import type { ServiceDataScope } from '../auth/service-data-scope';
import { JobsError } from './error';

export interface JobsLoggingSource {
  prepare(id: string, scope: ServiceDataScope, established: () => boolean): void;
  wake(id: string): void;
  close(): Promise<void>;
}
export function installJobsLogging(logging: LoggingRuntime, coordinator: DatabaseCoordinator, authority: AuthorityCommitCoordinator): JobsLoggingSource {
  const registrations = new Map<string, DeliverySourceRegistration>();
  let closing = false, closeTask: Promise<void> | null = null;
  const remove = installDatabaseLoggingBinding(coordinator, { records: false, workflow: logging.config.policy.capture.workflow, policyVersion: logging.config.policyVersion,
    sourceQueue: logging.config.sourceQueue, context: () => currentLoggingAttribution(logging) });
  return {
    prepare(id, scope, established) {
      if (closing) throw new JobsError('JOBS_NOT_READY');
      const bound: LoggingScope = scope.scopeKind === 'application' ? { kind: 'application', tenantId: null } : { kind: 'tenant', tenantId: scope.tenantId };
      prepareDatabaseLoggingBinding(coordinator, id, bound);
      if (registrations.has(id)) return;
      const commitAuthority = createDatabaseCommitAuthority(authority, id, () => undefined);
      registrations.set(id, logging.registerDeliverySource({
        async page(acknowledge) {
          const state = coordinator.diagnostics().state;
          if (state === 'created') return { rows: [], queued: 0, bytes: 0 };
          if (state !== 'started') throw new JobsError('JOBS_NOT_READY');
          const lease = await coordinator.acquireExisting(id, { commitAuthority });
          if (!lease) {
            // Catalog admission precedes the first private file. A crash after
            // a business commit cannot erase the established-file fence.
            if (established()) throw new JobsError('JOBS_STATE_INVALID');
            return { rows: [], queued: 0, bytes: 0 };
          }
          try {
            const { sourceId: _sourceId, ...page } = await executeCoordinatorLoggingSource(lease, bound, acknowledge.length ? acknowledge : undefined);
            return page;
          } finally { lease.release(); }
        },
        failed() { if (logging.admission.required) logging.admission.invalidate(); },
      }));
    },
    wake(id) { if (!closing) registrations.get(id)?.wake(); },
    close() {
      if (closeTask) return closeTask;
      closing = true; sealDatabaseLoggingBinding(coordinator);
      closeTask = (async () => { try { await logging.closeDeliverySources([...registrations.values()]); } finally { registrations.clear(); remove(); } })();
      return closeTask;
    },
  };
}
