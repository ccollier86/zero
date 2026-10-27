/** Scoped source-transaction evidence delivered by core Logging's supervised worker. Never copies message bodies into logs. */
import { AuthError } from '../auth/types';
import type { AuthorityCommitCoordinator } from '../databases/authority-commit-coordinator';
import type { DatabaseCoordinator } from '../databases/database-coordinator';
import { createDatabaseCommitAuthority } from '../databases/database-commit-authority';
import { executeCoordinatorLoggingSource } from '../databases/database-coordinator-capability';
import { createDatabaseRef } from '../databases/database-file';
import { installDatabaseLoggingBinding, prepareDatabaseLoggingBinding, sealDatabaseLoggingBinding } from '../databases/database-logging-binding';
import { currentLoggingAttribution } from '../logging/logging-attribution';
import type { LoggingScope } from '../logging/logging-contracts';
import type { DeliverySourceRegistration } from '../logging/logging-delivery-protocol';
import type { LoggingRuntime } from '../logging/logging-runtime';
import type { MessagingOwnerRecord, MessagingSourceOwner } from './runtime';

/** Each retained application/organization file has one fixed scope; shutdown drains them as one bounded group. */
export function installMessagingLogging(logging: LoggingRuntime, coordinator: DatabaseCoordinator, authority: AuthorityCommitCoordinator): MessagingSourceOwner {
  let closing = false;
  const sources = new Map<string, { owner: MessagingOwnerRecord; source: DeliverySourceRegistration }>();
  const remove = installDatabaseLoggingBinding(coordinator, { records: logging.config.policy.capture.records,
    policyVersion: logging.config.policyVersion, sourceQueue: logging.config.sourceQueue, context: () => currentLoggingAttribution(logging) });
  return {
    prepare(owner: MessagingOwnerRecord) {
      const ref = createDatabaseRef(owner.id), prior = sources.get(ref);
      if (prior) { prior.owner.established = Math.max(prior.owner.established, owner.established); return; }
      if (closing) throw new AuthError('Messaging audit source admission is closed.', 'MESSAGING_NOT_READY', 503);
      const scope: LoggingScope = owner.scope_id === 'application' ? { kind: 'application', tenantId: null } : { kind: 'tenant', tenantId: owner.scope_id.slice('tenant:'.length) };
      prepareDatabaseLoggingBinding(coordinator, owner.id, scope);
      const commitAuthority = createDatabaseCommitAuthority(authority, owner.id, () => undefined);
      const source = logging.registerDeliverySource({
        async page(acknowledge) {
          const state = coordinator.diagnostics().state;
          if (state === 'created') return { rows: [], queued: 0, bytes: 0 };
          if (state !== 'started') throw new AuthError('Messaging audit source is unavailable.', 'MESSAGING_NOT_READY', 503);
          const lease = await coordinator.acquireExisting(owner.id, { commitAuthority });
          // A cataloged but not yet established owner can be interrupted before
          // first file creation. It has no committed source events to acknowledge.
          if (!lease && !owner.established && !acknowledge.length) return { rows: [], queued: 0, bytes: 0 };
          if (!lease) throw new AuthError('Retained messaging audit source is missing.', 'MESSAGING_NOT_READY', 503);
          try { const { sourceId: _sourceId, ...page } = await executeCoordinatorLoggingSource(lease, scope, acknowledge.length ? acknowledge : undefined); return page; }
          finally { lease.release(); }
        },
        failed() { if (logging.admission.required) logging.admission.invalidate(); },
      });
      sources.set(ref, { owner, source });
    },
    wake(ref: string) { if (!closing) sources.get(ref)?.source.wake(); },
    async close() { if (closing) return; closing = true; sealDatabaseLoggingBinding(coordinator); try { await logging.closeDeliverySources([...sources.values()].map(value => value.source)); } finally { remove(); sources.clear(); } },
  };
}
