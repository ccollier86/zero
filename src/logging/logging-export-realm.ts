/** Durable export transitions in the private Fabric writer; artifact I/O always happens outside this transaction. */
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext } from '../databases/database-realm';
import { DatabaseError } from '../databases/database-error';
import type { LoggingEvent, LoggingQuery, LoggingReadScope } from './logging-contracts';
import { loggingCanonical, loggingChoice, loggingId, loggingRecord, loggingTime, normalizeLoggingEvent } from './logging-validation';
import { normalizeLoggingQuery } from './logging-query';
import { loggingDigest } from './logging-hash';
import { LOGGING_EXPORTS_TABLE, LOGGING_STATE_TABLE } from './logging-schema';
import type { LoggingExportJob } from './logging-export-contracts';
import { readOwnedLoggingExport } from './logging-export-validation';
import { loggingChainHash } from './logging-evidence-realm';

type Append = (context: DatabaseWriteCommandContext, input: unknown) => unknown;
interface JobRow {
  id: string; scope_kind: string; tenant_id: string | null; actor_id: string; stream: 'audit' | 'operational'; query_json: string;
  request_event: string; state_event: string; state: LoggingExportJob['state']; created_at: number; expires_at: number; completed_at: number | null;
  high_water: number; count: number; complete: number; next_before: number | null; sha256: string | null; artifact_removed: number;
}
export interface OwnedLoggingExportJob { readonly job: LoggingExportJob; readonly scope: LoggingReadScope; readonly query: LoggingQuery; readonly request: LoggingEvent; readonly artifactRemoved: boolean }
function fail(): never { throw new DatabaseError('DATABASE_PAYLOAD_INVALID', 'Logging export operation is invalid.', { outcome: 'not-committed' }); }
function inScope(row: JobRow, scope: LoggingReadScope): boolean { return scope.kind === 'platform' || row.scope_kind === scope.kind && row.tenant_id === (scope.kind === 'tenant' ? scope.tenantId : null); }
function project(row: JobRow): OwnedLoggingExportJob {
  const scope: LoggingReadScope = row.scope_kind === 'tenant' ? { kind: 'tenant', tenantId: row.tenant_id! } : { kind: 'application' };
  return readOwnedLoggingExport({ scope, query: normalizeLoggingQuery(row.stream, scope, JSON.parse(row.query_json)).query,
    request: normalizeLoggingEvent(JSON.parse(row.request_event)), artifactRemoved: row.artifact_removed === 1,
    job: { id: row.id, stream: row.stream, state: row.state, createdAt: row.created_at, expiresAt: row.expires_at, completedAt: row.completed_at,
      highWaterOrdinal: row.high_water, count: row.count, complete: row.complete === 1, nextBeforeOrdinal: row.next_before, sha256: row.sha256 } });
}
function stateDigest(row: JobRow): string {
  const { request_event: _request, state_event: _state, ...state } = row;
  return loggingDigest(state);
}
function audit(context: DatabaseWriteCommandContext, append: Append, row: JobRow, value: unknown, action: string): LoggingEvent {
  const input = normalizeLoggingEvent(value);
  const event = normalizeLoggingEvent({ ...input, metadata: { ...input.metadata, exportStateDigest: stateDigest(row) } });
  if (event.family !== 'investigations' || event.action !== action || event.scope.kind !== row.scope_kind || event.scope.tenantId !== row.tenant_id
    || event.target?.type !== 'logging.export' || event.target.id !== row.id) fail();
  if ((append(context, { stream: 'audit', events: [event] }) as { status: string }).status !== 'stored') fail();
  return event;
}

export function reserveLoggingExport(context: DatabaseWriteCommandContext, value: unknown, append: Append): OwnedLoggingExportJob {
  const r = loggingRecord(value, ['id', 'stream', 'scope', 'query', 'actorId', 'expiresAt', 'auditEvent']);
  const id = loggingId(r.id)!, actor = loggingId(r.actorId)!, stream = loggingChoice(r.stream, ['audit', 'operational'] as const);
  const admitted = normalizeLoggingQuery(stream, r.scope as LoggingReadScope, r.query as LoggingQuery);
  if (admitted.scope.kind === 'platform' || admitted.query.highWaterOrdinal === undefined) fail();
  const scope = admitted.scope, query = loggingCanonical(admitted.query), old = context.db.get(LOGGING_EXPORTS_TABLE, id) as unknown as JobRow | null;
  if (old) {
    if (!inScope(old, scope) || old.actor_id !== actor || old.stream !== stream || old.query_json !== query) fail();
    verifyState(old, id => context.db.get('logging_proofs', id));
    return project(old);
  }
  const now = Date.now(), expiresAt = loggingTime(r.expiresAt), event = normalizeLoggingEvent(r.auditEvent);
  if (event.actor.id !== actor || expiresAt < now + 30000 || expiresAt > now + 86400000) fail();
  const capacity = context.db.get(LOGGING_STATE_TABLE, 'export-capacity');
  const live = Number(capacity?.ordinal ?? 0);
  if (!Number.isSafeInteger(live) || live < 0) fail();
  if (live >= 128) throw new DatabaseError('DATABASE_CAPACITY_EXHAUSTED', 'Logging export capacity is exhausted.');
  const row: JobRow = { id, scope_kind: scope.kind, tenant_id: scope.kind === 'tenant' ? scope.tenantId : null, actor_id: actor, stream,
    query_json: query, request_event: '', state_event: '', state: 'pending', created_at: now, expires_at: expiresAt, completed_at: null,
    high_water: admitted.query.highWaterOrdinal, count: 0, complete: 0, next_before: null, sha256: null, artifact_removed: 0 };
  const retained = audit(context, append, row, event, 'logging.export.requested');
  row.request_event = row.state_event = loggingCanonical(retained);
  context.db.createStrict(LOGGING_EXPORTS_TABLE, row as unknown as Record<string, string | number | null>);
  if (capacity) context.db.update(LOGGING_STATE_TABLE, 'export-capacity', { ordinal: live + 1 });
  else context.db.createStrict(LOGGING_STATE_TABLE, { id: 'export-capacity', stream: 'audit', ordinal: live + 1 });
  return project(row);
}

export function transitionLoggingExport(context: DatabaseWriteCommandContext, value: unknown, append: Append): OwnedLoggingExportJob {
  const r = loggingRecord(value, ['id', 'state', 'count', 'complete', 'nextBeforeOrdinal', 'sha256', 'auditEvent', 'artifactRemoved']);
  const id = loggingId(r.id)!, state = loggingChoice(r.state, ['ready', 'failed', 'expired'] as const);
  const row = context.db.get(LOGGING_EXPORTS_TABLE, id) as unknown as JobRow | null; if (!row) fail();
  verifyState(row, id => context.db.get('logging_proofs', id));
  if (state === 'ready') {
    const count = loggingTime(r.count), nextBefore = r.nextBeforeOrdinal === null ? null : loggingTime(r.nextBeforeOrdinal);
    if (count > 1000 || typeof r.complete !== 'boolean' || typeof r.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(r.sha256)
      || r.complete && nextBefore !== null || !r.complete && (nextBefore === null || nextBefore > row.high_water)) fail();
    if (row.state === 'ready') {
      if (row.sha256 !== r.sha256 || row.count !== count || row.complete !== Number(r.complete) || row.next_before !== nextBefore) fail();
      return project(row);
    }
    if (row.state !== 'pending' || row.expires_at <= Date.now()) fail();
    const next = { ...row, state, count, complete: Number(r.complete), next_before: nextBefore, sha256: r.sha256, completed_at: Date.now() };
    const event = audit(context, append, next, r.auditEvent, 'logging.export.artifact.ready');
    context.db.update(LOGGING_EXPORTS_TABLE, id, { ...next, state_event: loggingCanonical(event) });
  } else if (state === 'expired') {
    if (row.expires_at > Date.now()) fail();
    if (row.state !== 'expired') {
      row.state = state;
      const event = audit(context, append, row, r.auditEvent, 'logging.export.expired');
      row.state_event = loggingCanonical(event);
      context.db.update(LOGGING_EXPORTS_TABLE, id, { state, state_event: row.state_event });
    }
    if (r.artifactRemoved === true && row.artifact_removed !== 1) {
      const capacity = context.db.get(LOGGING_STATE_TABLE, 'export-capacity');
      if (!capacity || !Number.isSafeInteger(capacity.ordinal) || Number(capacity.ordinal) < 1) fail();
      row.artifact_removed = 1;
      const event = audit(context, append, row, r.auditEvent, 'logging.export.artifact.removed');
      context.db.update(LOGGING_STATE_TABLE, 'export-capacity', { ordinal: Number(capacity.ordinal) - 1 });
      context.db.update(LOGGING_EXPORTS_TABLE, id, { artifact_removed: 1, state_event: loggingCanonical(event) });
    }
  } else if (row.state === 'pending') {
    row.state = state;
    const event = audit(context, append, row, r.auditEvent, 'logging.export.failed');
    context.db.update(LOGGING_EXPORTS_TABLE, id, { state, state_event: loggingCanonical(event) });
  }
  return project(context.db.get(LOGGING_EXPORTS_TABLE, id) as unknown as JobRow);
}

export function readLoggingExport({ database }: DatabaseReadQueryContext, value: unknown): OwnedLoggingExportJob | null {
  const r = loggingRecord(value, ['id', 'scope']), id = loggingId(r.id)!;
  const scope = normalizeLoggingQuery('audit', r.scope as LoggingReadScope).scope;
  const row = database.query<JobRow>('SELECT * FROM logging_exports WHERE id=?').get(id);
  if (!row || !inScope(row, scope)) return null;
  return verifiedProjection(database, row);
}

/** Private scheduler capability; no public route accepts platform scope or a job state predicate. */
export function pendingLoggingExports({ database }: DatabaseReadQueryContext, value: unknown): readonly OwnedLoggingExportJob[] {
  loggingRecord(value, []);
  // At most 128 reservations can own artifacts. Scan the entire bounded live
  // set so a repeatedly failing early job cannot hide newer requests forever.
  const rows = database.query<JobRow>(`SELECT * FROM logging_exports WHERE state='pending' OR (expires_at<=? AND artifact_removed=0) ORDER BY created_at,id LIMIT 129`).all(Date.now());
  if (rows.length > 128) throw new DatabaseError('DATABASE_PROTOCOL_ERROR', 'Logging export capacity is inconsistent.');
  return rows.map(row => verifiedProjection(database, row));
}

function verifiedProjection(database: DatabaseReadQueryContext['database'], row: JobRow): OwnedLoggingExportJob {
  verifyState(row, id => database.query<Record<string, unknown>>('SELECT * FROM logging_proofs WHERE id=?').get(id));
  return project(row);
}
function verifyState(row: JobRow, get: (id: string) => Record<string, unknown> | null): void {
  const owned = project(row), state = normalizeLoggingEvent(JSON.parse(row.state_event));
  const allowed = row.state === 'pending' ? ['logging.export.requested'] : row.state === 'ready' ? ['logging.export.artifact.ready']
    : row.state === 'failed' ? ['logging.export.failed'] : ['logging.export.expired', 'logging.export.artifact.removed'];
  if (!allowed.includes(state.action) || state.metadata.exportStateDigest !== stateDigest(row) || state.target?.id !== row.id
    || state.scope.kind !== row.scope_kind || state.scope.tenantId !== row.tenant_id || owned.request.actor.id !== row.actor_id) fail();
  for (const event of [owned.request, state]) {
    const id = loggingDigest([event.sourceId, event.id]), proof = get(id);
    if (!proof || proof.digest !== loggingDigest(event) || proof.chain_hash !== loggingChainHash(String(proof.previous_hash), Number(proof.ordinal), id, String(proof.digest), Number(proof.ingested_at))) {
      throw new DatabaseError('DATABASE_PROTOCOL_ERROR', 'Export authorization evidence is inconsistent.');
    }
  }
}
