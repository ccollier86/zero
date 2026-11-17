/** Semantic calendar writes join the existing source transaction/outbox; generic row capture is deliberately disabled. */
import type { DatabaseCoordinator } from '../databases/database-coordinator';
import { createDatabaseCommitAuthority } from '../databases/database-commit-authority';
import { createDatabaseRef } from '../databases/database-file';
import type { AuthorityCommitCoordinator } from '../databases/authority-commit-coordinator';
import { executeCoordinatorLoggingSource } from '../databases/database-coordinator-capability';
import { installDatabaseLoggingBinding, prepareDatabaseLoggingBinding, sealDatabaseLoggingBinding } from '../databases/database-logging-binding';
import { currentLoggingAttribution } from '../logging/logging-attribution';
import type { LoggingRuntime } from '../logging/logging-runtime';
import type { LoggingScope } from '../logging/logging-contracts';
import type { DeliverySourceRegistration } from '../logging/logging-delivery-protocol';
import type { CalendarOwnerRecord } from './owner-schema';
import type { CalendarRuntimeSource } from './runtime';
import { CalendarError } from './error';
import { calendarScope } from './validation';

export function installCalendarLogging(logging: LoggingRuntime, coordinator: DatabaseCoordinator,
  authority: AuthorityCommitCoordinator): CalendarRuntimeSource {
  const registrations = new Map<string, DeliverySourceRegistration>();
  const owners = new Map<string, CalendarOwnerRecord>();
  let closing = false, closeTask: Promise<void> | null = null;
  const remove = installDatabaseLoggingBinding(coordinator, { records: false, workflow: logging.config.policy.capture.workflow,
    policyVersion: logging.config.policyVersion, sourceQueue: logging.config.sourceQueue,
    context: () => currentLoggingAttribution(logging) });
  return {
    prepare(owner) {
      if (closing) throw new CalendarError('CALENDAR_NOT_READY');
      const scopeId = calendarScope(owner.scope_id);
      const bound: LoggingScope = scopeId === 'application' ? { kind: 'application', tenantId: null }
        : { kind: 'tenant', tenantId: scopeId.slice('tenant:'.length) };
      const prior = owners.get(owner.id);
      if (prior && (prior.scope_id !== owner.scope_id || prior.owner_id !== owner.owner_id || prior.root_hash !== owner.root_hash
        || prior.established === 1 && owner.established !== 1)) throw new CalendarError('CALENDAR_STATE_INVALID');
      prepareDatabaseLoggingBinding(coordinator, owner.id, bound);
      // Refresh the established fence after the first canonical owner bind; never retain the initial unestablished snapshot.
      owners.set(owner.id, Object.freeze({ ...owner }));
      const ref = createDatabaseRef(owner.id);
      if (registrations.has(ref)) return;
      const id = owner.id, commitAuthority = createDatabaseCommitAuthority(authority, id, () => undefined);
      registrations.set(ref, logging.registerDeliverySource({
        async page(acknowledge) {
          const state = coordinator.diagnostics().state;
          if (state === 'created') return { rows: [], queued: 0, bytes: 0 };
          if (state !== 'started') throw new CalendarError('CALENDAR_NOT_READY');
          const lease = await coordinator.acquireExisting(id, { commitAuthority });
          if (!lease) {
            if (owners.get(id)?.established === 1) throw new CalendarError('CALENDAR_STATE_INVALID');
            return { rows: [], queued: 0, bytes: 0 };
          }
          try {
            const { sourceId: _sourceId, ...page } = await executeCoordinatorLoggingSource(lease, bound,
              acknowledge.length ? acknowledge : undefined);
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
      closeTask = (async () => {
        try { await logging.closeDeliverySources([...registrations.values()]); }
        finally { registrations.clear(); owners.clear(); remove(); }
      })();
      return closeTask;
    },
  };
}
