/** Managed same-transaction origin capture and fixed source capabilities. Delivery scheduling lives only in the subprocess. */
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
  const app = new LoggingSourceOutbox(application, logging.config.sourceQueue), auth = new LoggingSourceOutbox(system, logging.config.sourceQueue);
  let closing = false, closeTask: Promise<void> | null = null;
  const registrations = [app, auth].map(source => logging.registerDeliverySource({
    page(acknowledge) {
      if (acknowledge.length) source.acknowledge(acknowledge);
      return { rows: source.page(), ...source.counts() };
    },
    failed: onFailure,
  }));
  type SourceDiagnostics = Readonly<{ application: { queued: number; bytes: number }; guardian: { queued: number; bytes: number }; failed: number }>;
  let finalDiagnostics: SourceDiagnostics | null = null;
  const diagnostics = (): SourceDiagnostics => finalDiagnostics ?? Object.freeze({ application: Object.freeze(app.counts()), guardian: Object.freeze(auth.counts()), failed: registrations.reduce((n, r) => n + r.diagnostics().failed, 0) });
  const committed = (db: ReactiveDB) => db.afterCommit(() => { if (!closing) registrations[db === application ? 0 : 1]!.wake(); });
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
  return Object.freeze({
    flush() { return logging.flushDeliverySources(registrations); },
    diagnostics,
    close() {
      if (closeTask) return closeTask;
      closing = true; removeMutation(); removeAuth();
      closeTask = (async () => {
        try { await logging.closeDeliverySources(registrations); }
        finally { finalDiagnostics = diagnostics(); }
      })();
      return closeTask;
    },
  });
}
