/** Parent-owned source catalog/capabilities. A separate delivery process schedules all reads, retries, batching and acknowledgments. */
import { databaseManagerLoggingPort, type DatabaseManager } from '../databases/database-manager';
import { installDatabaseLoggingBinding, prepareDatabaseLoggingBinding, sealDatabaseLoggingBinding } from '../databases/database-logging-binding';
import { observeDatabaseCoordinatorCommits, observeDatabaseCoordinatorStarted } from '../databases/database-coordinator-commit-notifications';
import { executeCoordinatorLoggingSource } from '../databases/database-coordinator-capability';
import { canonicalDatabaseRootIdentity, createDatabaseRef, normalizeDatabaseId } from '../databases/database-file';
import { deriveTenantDatabaseId } from '../databases/database-binding-ref';
import type { ReactiveDB } from '../sync/reactive-db';
import type { LoggingScope } from './logging-contracts';
import type { LoggingRuntime } from './logging-runtime';
import { currentLoggingAttribution } from './logging-attribution';
import { loggingDigest } from './logging-hash';
import { LoggingError } from './logging-error';
import { loggingId } from './logging-validation';
import type { DeliverySourceRegistration } from './logging-delivery-protocol';

/** Optional app owner. Missing files are never provisioned during recovery. All catalog SQL is fixed/private. */
export function installLoggingFabricCapture(logging: LoggingRuntime, manager: DatabaseManager, system: ReactiveDB, rootDirectory: string, onFailure: () => void) {
  const port = databaseManagerLoggingPort(manager); if (!port) return null;
  if (port.coordinator.diagnostics().state !== 'created') throw new LoggingError('LOGGING_CONFIG_INVALID', 'Managed audit capture must be installed before Fabric admits source databases.');
  const rootId = loggingDigest({ path: canonicalDatabaseRootIdentity(rootDirectory), realm: port.coordinator.realm.name });
  system.exec(`CREATE TABLE IF NOT EXISTS _zero_logging_fabric_sources (
    id TEXT PRIMARY KEY, scope_kind TEXT NOT NULL, tenant_id TEXT, root_id TEXT NOT NULL
  )`);
  const sources = new Map<string, LoggingScope>(), refs = new Map<string, string>();
  const registrations = new Map<string, DeliverySourceRegistration>();
  for (const row of system.prepare('SELECT id,scope_kind,tenant_id,root_id FROM _zero_logging_fabric_sources LIMIT 10001').all() as { id: string; scope_kind: string; tenant_id: string | null; root_id: string }[]) {
    if (sources.size >= 10000 || row.root_id !== rootId) throw new LoggingError('LOGGING_NOT_READY', 'Fabric audit source catalog requires explicit recovery; its owner changed or its budget is exceeded.');
    const id = String(normalizeDatabaseId(row.id));
    if (row.scope_kind !== 'tenant' && row.scope_kind !== 'application' || row.scope_kind === 'application' && row.tenant_id !== null) throw new LoggingError('LOGGING_NOT_READY', 'Fabric audit source scope is inconsistent.');
    const scope: LoggingScope = row.scope_kind === 'tenant' ? Object.freeze({ kind: 'tenant', tenantId: loggingId(row.tenant_id)! }) : Object.freeze({ kind: 'application', tenantId: null });
    if (scope.kind === 'tenant' && deriveTenantDatabaseId(scope.tenantId) !== id) throw new LoggingError('LOGGING_NOT_READY', 'Fabric audit source does not match its tenant binding.');
    sources.set(id, scope); refs.set(createDatabaseRef(id), id);
  }
  let closing = false, closeTask: Promise<void> | null = null;
  const register = (id: string, scope: LoggingScope) => {
    registrations.set(id, logging.registerDeliverySource({
      async page(acknowledge) {
        // The existing owner alone resolves the private binding. The delivery
        // worker receives no application path, SQL, Guardian access or lease.
        const state = port.coordinator.diagnostics().state;
        if (state === 'created') return { rows: [], queued: 0, bytes: 0 };
        if (state !== 'started') throw new LoggingError('LOGGING_NOT_READY', 'Fabric source owner is unavailable.');
        const lease = await port.recover(id, scope);
        if (!lease) {
          if (logging.admission.required) throw new LoggingError('LOGGING_AUDIT_UNAVAILABLE', 'A retained audit source is missing; restore or reconcile its source before protected work resumes.');
          return { rows: [], queued: 0, bytes: 0 };
        }
        try {
          const { sourceId, ...page } = await executeCoordinatorLoggingSource(lease, scope, acknowledge.length ? acknowledge : undefined);
          return page;
        } finally { lease.release(); }
      },
      failed: onFailure,
    }));
  };
  installDatabaseLoggingBinding(port.coordinator, { records: logging.config.policy.capture.records, policyVersion: logging.config.policyVersion, sourceQueue: logging.config.sourceQueue,
    context: () => currentLoggingAttribution(logging) });
  for (const [id, scope] of sources) { prepareDatabaseLoggingBinding(port.coordinator, id, scope); register(id, scope); }
  const prepare = (id: string, scope: LoggingScope) => {
    const prior = sources.get(id);
    if (prior) {
      if (prior.kind !== scope.kind || prior.tenantId !== scope.tenantId) throw new LoggingError('LOGGING_FORBIDDEN', 'Fabric audit source changed scope.');
      return;
    }
    if (closing || sources.size >= 10000) throw new LoggingError('LOGGING_AUDIT_UNAVAILABLE', 'Fabric audit source admission is unavailable.');
    // Catalog before any source file is created. A crash can leave a missing
    // file entry, never an untracked committed source; recovery uses existing-only acquisition.
    system.transaction(() => system.prepare('INSERT INTO _zero_logging_fabric_sources(id,scope_kind,tenant_id,root_id) VALUES(?,?,?,?)').run(id, scope.kind, scope.tenantId, rootId));
    sources.set(id, scope); refs.set(createDatabaseRef(id), id);
    register(id, scope);
  };
  const removeSource = port.install(prepare);
  const wake = () => { if (!closing) for (const registration of registrations.values()) registration.wake(); };
  const removeCommit = observeDatabaseCoordinatorCommits(port.coordinator, ref => { const id = refs.get(ref); if (id && !closing) registrations.get(id)?.wake(); });
  const removeStart = observeDatabaseCoordinatorStarted(port.coordinator, wake);
  return Object.freeze({
    flush() { return logging.flushDeliverySources([...registrations.values()]); },
    diagnostics() {
      let pendingSources = 0, queued = 0, bytes = 0, failed = 0;
      for (const registration of registrations.values()) { const state = registration.diagnostics(); if (state.pending) pendingSources++; queued += state.queued; bytes += state.bytes; failed += state.failed; }
      return Object.freeze({ sources: sources.size, pendingSources, queued, bytes, failed });
    },
    close() {
      if (closeTask) return closeTask;
      closing = true; sealDatabaseLoggingBinding(port.coordinator); removeSource(); removeCommit(); removeStart();
      closeTask = logging.closeDeliverySources([...registrations.values()]);
      return closeTask;
    },
  });
}
