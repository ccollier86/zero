/** Managed origin capture and bounded delivery. Never awaits a sink inside a transaction or authority lease. */
import type { ReactiveDB } from '../sync/reactive-db';
import { registerReactiveDBMutationContribution } from '../sync/reactive-db-mutation-interceptor';
import { registerAuthAuditCapture } from '../auth/auth-audit-capture';
import type { LoggingContext } from './logging-contracts';
import { captureLoggingEvent } from './logging-validation';
import { LoggingSourceOutbox } from './logging-source-outbox';
import type { LoggingRuntime } from './logging-runtime';
import { loggingDigest } from './logging-hash';
import { currentLoggingAttribution } from './logging-attribution';

/** Install before source admission; invoke close before closing log/source owners. */
export function installLoggingSourceCapture(logging: LoggingRuntime, application: ReactiveDB, system: ReactiveDB,
  tenantFields: Readonly<Record<string, string>> = {}, onFailure: () => void = () => {}) {
  const app = new LoggingSourceOutbox(application), auth = new LoggingSourceOutbox(system);
  let closed = false, closing = false, task: Promise<void> | null = null, closeTask: Promise<void> | null = null, failed = 0;
  let wakeup = false, retryTimer: ReturnType<typeof setTimeout> | null = null, consecutiveFailures = 0;
  const schedule = () => {
    if (closed || closing || wakeup || retryTimer) return; wakeup = true;
    queueMicrotask(() => { wakeup = false; if (!closed && !closing) void drain(); });
  };
  const committed = (db: ReactiveDB) => db.afterCommit(schedule);
  const context = (sourceId: string): LoggingContext => ({ sourceId, origin: 'system', scope: { kind: 'application', tenantId: null },
    actor: { kind: 'system', id: 'zero.database', sessionId: null, initiatorId: null }, requestId: null, correlationId: null, policyVersion: logging.config.policyVersion });
  const removeMutation = registerReactiveDBMutationContribution(application, ({ change }) => {
    if (!logging.config.policy.capture.records || change.table.startsWith('_')) return;
    const attribution = currentLoggingAttribution(logging);
    const base = { ...(attribution ?? context(app.sourceId)), sourceId: app.sourceId }, field = tenantFields[change.table];
    let scope = base.scope;
    if (field) {
      const tenant = (change.row ?? change.previousRow)?.[field];
      if (typeof tenant !== 'string') throw new Error('Tenant audit attribution is unavailable.');
      scope = { kind: 'tenant', tenantId: tenant };
      if (attribution && (attribution.scope.kind !== 'tenant' || attribution.scope.tenantId !== tenant)) throw new Error('Audit mutation scope does not match admitted authority.');
    }
    const c = { ...base, scope };
    const name = change.table.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const type = name && name.length <= 110 ? 'table.' + name : 'table.' + loggingDigest(change.table);
    app.enqueue(captureLoggingEvent(c, { id: crypto.randomUUID(), family: 'records', action: 'record.' + ({ INSERT: 'created', UPDATE: 'updated', DELETE: 'deleted' }[change.op]),
      outcome: 'succeeded', evidence: 'server-confirmed', occurredAt: change.ts,
      target: { type, id: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(change.rowId) ? change.rowId : 'hash:' + loggingDigest(change.rowId) },
      metadata: { sequence: change.seq } }, ['sequence']));
    committed(application);
  });
  const removeAuth = registerAuthAuditCapture(system, event => {
    if (!logging.config.policy.capture.security) return;
    const c: LoggingContext = { ...context(auth.sourceId),
      scope: event.scopeKind === 'tenant' ? { kind: 'tenant', tenantId: event.tenantId! } : { kind: 'application', tenantId: null },
      actor: { kind: event.actorUserId ? 'user' : 'system', id: event.actorUserId ?? 'guardian', sessionId: event.actorSessionId, initiatorId: null },
      requestId: event.requestId, correlationId: event.correlationId };
    auth.enqueue(captureLoggingEvent(c, { id: event.eventId, family: 'security', action: event.action, outcome: event.outcome, evidence: 'server-confirmed', occurredAt: event.occurredAt }));
    committed(system);
  });
  const drain = (): Promise<void> => {
    if (task) return task;
    task = (async () => {
      for (const source of [app, auth]) for (let batch = 0; batch < 4; batch++) {
        if (closed) return;
        const rows = source.page(); if (!rows.length) break;
        const results = await Promise.allSettled(rows.map(row => logging.deliver(row.event)));
        const acknowledged = rows.filter((_, i) => results[i]!.status === 'fulfilled').map(row => row.id);
        if (acknowledged.length) source.acknowledge(acknowledged);
        const error = results.find((r): r is PromiseRejectedResult => r.status === 'rejected'); if (error) throw error.reason;
      }
      consecutiveFailures = 0;
    })().catch(() => {
      failed++; consecutiveFailures++;
      if (consecutiveFailures === 1) try { onFailure(); } catch { /* Failure counters remain observable even if an external diagnostic sink fails. */ }
      if (!closed && !closing && !retryTimer) { retryTimer = setTimeout(() => { retryTimer = null; void drain(); }, Math.min(30000, 1000 * 2 ** Math.min(5, consecutiveFailures - 1))); retryTimer.unref?.(); }
    }).finally(() => {
      task = null;
      if (!closed && !closing && !retryTimer && (app.counts().queued || auth.counts().queued)) schedule();
    });
    return task;
  };
  schedule();
  return Object.freeze({
    async flush() { await task; await drain(); },
    diagnostics() { return Object.freeze({ application: app.counts(), guardian: auth.counts(), failed }); },
    close() {
      if (closeTask) return closeTask;
      closing = true; removeMutation(); removeAuth(); if (retryTimer) clearTimeout(retryTimer);
      closeTask = (async () => {
        try {
          await task;
          // Admission is closed; the source has a hard 10,000-row budget.
          // Drain that finite backlog, but never spin on an unavailable sink.
          for (let pass = 0; pass < 80 && (app.counts().queued || auth.counts().queued); pass++) {
            const failures = failed; await drain(); if (failed !== failures) break;
          }
        } finally { closed = true; }
      })();
      return closeTask;
    },
  });
}
