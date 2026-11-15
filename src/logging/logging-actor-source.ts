/** Actor-local source capture. Synchronous contributions join the business commit; IPC only drains committed envelopes. */
import type { ReactiveDB } from '../sync/reactive-db';
import { registerReactiveDBMutationContribution } from '../sync/reactive-db-mutation-interceptor';
import type { LoggingContext, LoggingEvent, LoggingScope } from './logging-contracts';
import { captureLoggingEvent, loggingArray, loggingByteLength, loggingId, loggingRecord, normalizeLoggingEvent } from './logging-validation';
import { loggingDigest } from './logging-hash';
import { loggingTableTarget } from './logging-table-target';
import { LoggingSourceOutbox } from './logging-source-outbox';
import { LoggingError } from './logging-error';
import { DatabaseError } from '../databases/database-error';
import { normalizeLoggingSourceLimits, LOGGING_SOURCE_HARD_EVENTS, LOGGING_SOURCE_HARD_BYTES, LOGGING_SOURCE_PAGE_EVENTS, type LoggingSourceLimits } from './logging-source-limits';
import type { LoggingResourcePolicies } from './logging-activity-contracts';
import { normalizeLoggingResourcePolicies } from './logging-resource-policy';
import { captureLoggingRecordChange } from './logging-record-change';
import { registerDatabaseCommandSourceAudit, type DatabaseCommandSourceAuditEvent } from '../databases/database-command-source-audit';
import type { LoggingEventInput } from './logging-contracts';

export const LOGGING_ACTOR_SOURCE_OPERATION = 'database.logging.source';
export interface LoggingActorSourceBinding {
  readonly records: boolean;
  /** Explicit command-source workflow events are independent of generic record capture. */
  readonly workflow?: boolean;
  readonly policyVersion: string;
  readonly scope: LoggingScope;
  readonly sourceQueue?: LoggingSourceLimits;
  readonly resources?: LoggingResourcePolicies;
}
export interface LoggingActorSourcePage {
  readonly sourceId: string;
  readonly queued: number;
  readonly bytes: number;
  readonly rows: readonly Readonly<{ id: string; event: LoggingEvent }>[];
}

/** Internal bind policy is detached before IPC and cannot select a physical path or a sink. */
export function normalizeLoggingActorSourceBinding(input: unknown): LoggingActorSourceBinding {
  const value = loggingRecord(input, ['records', 'workflow', 'policyVersion', 'scope', 'sourceQueue', 'resources']);
  if (typeof value.records !== 'boolean' || value.workflow !== undefined && typeof value.workflow !== 'boolean') throw new LoggingError('LOGGING_CONFIG_INVALID', 'Actor logging policy is invalid.');
  const policyVersion = loggingId(value.policyVersion)!;
  const scope = loggingRecord(value.scope, ['kind', 'tenantId']);
  if (scope.kind !== 'application' && scope.kind !== 'tenant' || scope.kind === 'application' && scope.tenantId !== null) {
    throw new LoggingError('LOGGING_CONFIG_INVALID', 'Actor audit scope is invalid.');
  }
  return Object.freeze({ records: value.records, workflow: value.workflow ?? false, policyVersion, sourceQueue: normalizeLoggingSourceLimits(value.sourceQueue), resources: normalizeLoggingResourcePolicies(value.resources),
    scope: scope.kind === 'application' ? Object.freeze({ kind: 'application', tenantId: null })
      : Object.freeze({ kind: 'tenant', tenantId: loggingId(scope.tenantId)! }) });
}

/** Validate an IPC page before any sink delivery or acknowledgment. */
export function normalizeLoggingActorSourcePage(input: unknown, scope: LoggingScope): LoggingActorSourcePage {
  const value = loggingRecord(input, ['sourceId', 'queued', 'bytes', 'rows']);
  const sourceId = loggingId(value.sourceId)!;
  if (!Number.isSafeInteger(value.queued) || (value.queued as number) < 0 || (value.queued as number) > LOGGING_SOURCE_HARD_EVENTS
    || !Number.isSafeInteger(value.bytes) || (value.bytes as number) < 0 || (value.bytes as number) > LOGGING_SOURCE_HARD_BYTES) {
    throw new LoggingError('LOGGING_EVENT_INVALID', 'Actor audit queue accounting is invalid.');
  }
  let total = 0;
  const rows = loggingArray(value.rows, LOGGING_SOURCE_PAGE_EVENTS).map(input => {
    const row = loggingRecord(input, ['id', 'event']), id = loggingId(row.id)!, event = normalizeLoggingEvent(row.event);
    if (event.id !== id || event.sourceId !== sourceId || event.scope.kind !== scope.kind || event.scope.tenantId !== scope.tenantId) {
      throw new LoggingError('LOGGING_EVENT_INVALID', 'Actor audit evidence escaped its bound source.');
    }
    total += loggingByteLength(event);
    if (total > 256 * 1024) throw new LoggingError('LOGGING_EVENT_INVALID', 'Actor audit page exceeds its byte budget.');
    return Object.freeze({ id, event });
  });
  if (new Set(rows.map(row => row.id)).size !== rows.length || rows.length > (value.queued as number) || (value.queued as number) > 0 && rows.length === 0) {
    throw new LoggingError('LOGGING_EVENT_INVALID', 'Actor audit page is inconsistent.');
  }
  return Object.freeze({ sourceId, queued: value.queued as number, bytes: value.bytes as number, rows: Object.freeze(rows) });
}

/** Each binding owns exactly one contribution; no retained request authority or asynchronous sink exists in the actor. */
export class LoggingActorSource {
  private readonly outbox: LoggingSourceOutbox;
  private readonly remove: () => void;
  private readonly removeCommandAudit: () => void;
  private current: LoggingContext | null = null;
  constructor(db: ReactiveDB, readonly policy: LoggingActorSourceBinding) {
    this.outbox = new LoggingSourceOutbox(db, policy.sourceQueue);
    this.removeCommandAudit = registerDatabaseCommandSourceAudit(db, event => this.appendCommand(event));
    this.remove = registerReactiveDBMutationContribution(db, ({ change }) => {
      if (!policy.records || change.table.startsWith('_')) return;
      const detail = captureLoggingRecordChange(change, policy.resources);
      if (!detail) return;
      const context = this.context();
      try { this.outbox.enqueue(captureLoggingEvent(context, { id: crypto.randomUUID(), family: 'records',
        action: 'record.' + ({ INSERT: 'created', UPDATE: 'updated', DELETE: 'deleted' }[change.op]),
        outcome: 'succeeded', evidence: 'server-confirmed', occurredAt: change.ts,
        target: { type: loggingTableTarget(change.table),
          id: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(change.rowId) ? change.rowId : 'hash:' + loggingDigest(change.rowId) },
        metadata: { sequence: change.seq }, detail }, ['sequence'])); }
      catch (error) {
        if (error instanceof LoggingError && error.code === 'LOGGING_AUDIT_UNAVAILABLE') throw new DatabaseError('DATABASE_BACKPRESSURE', 'Required source audit admission is unavailable.', { retryable: true, outcome: 'not-committed' });
        throw error;
      }
    });
  }
  private context(): LoggingContext {
    return { ...(this.current ?? { origin: 'system', scope: this.policy.scope,
      actor: { kind: 'system', id: 'zero.database', sessionId: null, initiatorId: null }, requestId: null, correlationId: null }),
      sourceId: this.outbox.sourceId, policyVersion: this.policy.policyVersion };
  }
  private appendCommand(input: DatabaseCommandSourceAuditEvent): void {
    const value = loggingRecord(input, ['id', 'family', 'action', 'outcome', 'occurredAt', 'target', 'metadata']);
    if (value.family !== 'workflow') throw new LoggingError('LOGGING_EVENT_INVALID', 'Command audit family is unavailable.');
    if (!this.policy.workflow) return;
    const metadata = loggingRecord(value.metadata ?? {});
    try {
      this.outbox.enqueue(captureLoggingEvent(this.context(), { ...value, evidence: 'server-confirmed' } as LoggingEventInput, Object.keys(metadata)));
    } catch (error) {
      if (error instanceof LoggingError && error.code === 'LOGGING_AUDIT_UNAVAILABLE') throw new DatabaseError('DATABASE_BACKPRESSURE', 'Required source audit admission is unavailable.', { retryable: true, outcome: 'not-committed' });
      throw error;
    }
  }
  /** The trusted parent supplies attribution only for the duration of one synchronous actor command. */
  run<T>(input: LoggingContext | undefined, operation: () => T): T {
    if (input) {
      const event = captureLoggingEvent(input, { id: 'validation', family: 'records', action: 'record.validation', occurredAt: 0, outcome: 'attempted', evidence: 'server-confirmed' });
      if (event.scope.kind !== this.policy.scope.kind || event.scope.tenantId !== this.policy.scope.tenantId) {
        throw new DatabaseError('DATABASE_AUTHORITY_CHANGED', 'Audit attribution does not match the actor binding.', { outcome: 'not-started' });
      }
      this.current = { sourceId: event.sourceId, origin: event.origin, scope: event.scope, actor: event.actor,
        requestId: event.requestId, correlationId: event.correlationId, policyVersion: this.policy.policyVersion };
    }
    try { return operation(); } finally { this.current = null; }
  }
  /** Only confirmed IDs are removed; duplicate/lost acknowledgments are harmless and cannot mutate business rows. */
  control(input: unknown): LoggingActorSourcePage {
    const record = loggingRecord(input, ['acknowledge']);
    const ids = record.acknowledge === undefined ? [] : loggingArray(record.acknowledge, LOGGING_SOURCE_PAGE_EVENTS).map(id => loggingId(id)!);
    if (ids.length) this.outbox.acknowledge(ids);
    return Object.freeze({ sourceId: this.outbox.sourceId, ...this.outbox.counts(), rows: this.outbox.page() });
  }
  close(): void { this.removeCommandAudit(); this.remove(); this.current = null; }
}
