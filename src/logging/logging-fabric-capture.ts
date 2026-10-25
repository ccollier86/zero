/** Parent-owned Fabric outbox delivery. Catalogs only manager-proven sources, never scans paths or waits inside source authority. */
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

/** Optional app owner. Missing files are never provisioned during recovery. All catalog SQL is fixed/private. */
export function installLoggingFabricCapture(logging: LoggingRuntime, manager: DatabaseManager, system: ReactiveDB, rootDirectory: string, onFailure: () => void) {
  const port = databaseManagerLoggingPort(manager); if (!port) return null;
  if (port.coordinator.diagnostics().state !== 'created') throw new LoggingError('LOGGING_CONFIG_INVALID', 'Managed audit capture must be installed before Fabric admits source databases.');
  const rootId = loggingDigest({ path: canonicalDatabaseRootIdentity(rootDirectory), realm: port.coordinator.realm.name });
  system.exec(`CREATE TABLE IF NOT EXISTS _zero_logging_fabric_sources (
    id TEXT PRIMARY KEY, scope_kind TEXT NOT NULL, tenant_id TEXT, root_id TEXT NOT NULL
  )`);
  const sources = new Map<string, LoggingScope>(), refs = new Map<string, string>(), pending = new Set<string>();
  const active = new Set<string>();
  for (const row of system.prepare('SELECT id,scope_kind,tenant_id,root_id FROM _zero_logging_fabric_sources LIMIT 10001').all() as { id: string; scope_kind: string; tenant_id: string | null; root_id: string }[]) {
    if (sources.size >= 10000 || row.root_id !== rootId) throw new LoggingError('LOGGING_NOT_READY', 'Fabric audit source catalog requires explicit recovery; its owner changed or its budget is exceeded.');
    const id = String(normalizeDatabaseId(row.id));
    if (row.scope_kind !== 'tenant' && row.scope_kind !== 'application' || row.scope_kind === 'application' && row.tenant_id !== null) throw new LoggingError('LOGGING_NOT_READY', 'Fabric audit source scope is inconsistent.');
    const scope: LoggingScope = row.scope_kind === 'tenant' ? Object.freeze({ kind: 'tenant', tenantId: loggingId(row.tenant_id)! }) : Object.freeze({ kind: 'application', tenantId: null });
    if (scope.kind === 'tenant' && deriveTenantDatabaseId(scope.tenantId) !== id) throw new LoggingError('LOGGING_NOT_READY', 'Fabric audit source does not match its tenant binding.');
    sources.set(id, scope); refs.set(createDatabaseRef(id), id); pending.add(id);
  }
  let closing = false, closed = false, task: Promise<void> | null = null, closeTask: Promise<void> | null = null, timer: ReturnType<typeof setTimeout> | null = null;
  let timerAt = Infinity, failed = 0, queued = 0, bytes = 0;
  const retries = new Map<string, { until: number; attempts: number }>();
  const counts = new Map<string, { queued: number; bytes: number }>();
  installDatabaseLoggingBinding(port.coordinator, { records: logging.config.policy.capture.records, policyVersion: logging.config.policyVersion, sourceQueue: logging.config.sourceQueue,
    context: () => currentLoggingAttribution(logging) });
  for (const [id, scope] of sources) prepareDatabaseLoggingBinding(port.coordinator, id, scope);
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
    pending.add(id); schedule();
  };
  const removeSource = port.install(prepare);
  const remember = (id: string, count: { queued: number; bytes: number }) => {
    const previous = counts.get(id); queued += count.queued - (previous?.queued ?? 0); bytes += count.bytes - (previous?.bytes ?? 0); counts.set(id, count);
  };
  const deliver = async (id: string) => {
    const scope = sources.get(id)!;
    const lease = await port.recover(id, scope); if (!lease) { remember(id, { queued: 0, bytes: 0 }); return; }
    try {
      let page = await executeCoordinatorLoggingSource(lease, scope); remember(id, page);
      for (let batch = 0; batch < 4 && page.rows.length && (!closing || batch === 0); batch++) {
        const result = await Promise.allSettled(page.rows.map(row => logging.deliver(row.event)));
        const ids = page.rows.filter((_, i) => result[i]!.status === 'fulfilled').map(row => row.id);
        if (ids.length) { page = await executeCoordinatorLoggingSource(lease, scope, ids); remember(id, page); }
        const rejected = result.find((r): r is PromiseRejectedResult => r.status === 'rejected'); if (rejected) throw rejected.reason;
      }
      if (page.queued) pending.add(id);
    } finally { lease.release(); }
  };
  const drain = (force = false): Promise<void> => {
    if (task) return task;
    if (closed || port.coordinator.diagnostics().state !== 'started') return Promise.resolve();
    task = (async () => {
      const batch = [...pending].filter(id => force || (retries.get(id)?.until ?? 0) <= Date.now()).slice(0, 3); batch.forEach(id => { pending.delete(id); active.add(id); });
      const results = await Promise.allSettled(batch.map(deliver));
      batch.forEach((id, i) => {
        active.delete(id);
        if (results[i]!.status === 'fulfilled') { retries.delete(id); return; }
        pending.add(id); failed++;
        const attempts = (retries.get(id)?.attempts ?? 0) + 1;
        retries.set(id, { attempts, until: Date.now() + Math.min(30000, 1000 * 2 ** Math.min(5, attempts - 1)) });
        if (attempts === 1) try { onFailure(); } catch { /* Failure reporting cannot discard durable evidence. */ }
      });
    })().finally(() => { task = null; if (!closed && !closing && pending.size) schedule(); });
    return task;
  };
  const schedule = () => {
    if (closed || closing || !pending.size) return;
    let earliest = Infinity;
    for (const id of pending) earliest = Math.min(earliest, retries.get(id)?.until ?? 0);
    const at = Math.max(Date.now(), earliest);
    if (timer && timerAt <= at) return;
    if (timer) clearTimeout(timer);
    timerAt = at;
    // Yield between groups: recovery must not monopolize the app event loop or actor pool.
    timer = setTimeout(() => { timer = null; timerAt = Infinity; if (!closed && !closing) void drain(); }, Math.max(0, at - Date.now())); timer.unref?.();
  };
  const removeCommit = observeDatabaseCoordinatorCommits(port.coordinator, ref => { const id = refs.get(ref); if (id) { pending.add(id); schedule(); } });
  const removeStart = observeDatabaseCoordinatorStarted(port.coordinator, schedule);
  if (port.coordinator.diagnostics().state === 'started') schedule();
  return Object.freeze({
    async flush() { await task; for (let pass = 0; pass < 80 && pending.size; pass++) { const before = failed; await drain(true); if (failed !== before) break; } },
    diagnostics() { return Object.freeze({ sources: sources.size, pendingSources: new Set([...pending, ...active]).size, queued, bytes, failed }); },
    close() {
      if (closeTask) return closeTask;
      closing = true; sealDatabaseLoggingBinding(port.coordinator); removeSource(); removeCommit(); removeStart(); if (timer) clearTimeout(timer);
      closeTask = (async () => { try { await task; const deadline = Date.now() + 5000; for (let pass = 0; pass < 80 && pending.size && Date.now() < deadline; pass++) { const before = failed; await drain(true); if (failed !== before) break; } } finally { closed = true; } })();
      return closeTask;
    },
  });
}
