/** Closed logging query normalization and parameterized SQL. Scope predicates cannot be replaced by caller filters. */
import type { LoggingQuery, LoggingReadScope, LoggingStream } from './logging-contracts';
import { LOGGING_FAMILIES, LOGGING_LEVELS, LOGGING_OUTCOMES } from './logging-contracts';
import { LOGGING_MAX_PAGE, invalid, loggingArray, loggingChoice, loggingCode, loggingId, loggingRecord, loggingTime } from './logging-validation';
import { loggingDigest } from './logging-hash';

export interface NormalizedLoggingQuery {
  readonly stream: LoggingStream;
  readonly scope: LoggingReadScope;
  readonly query: LoggingQuery & { readonly limit: number };
}

/** Detach criteria synchronously. Public transports must supply scope from live authority, not request JSON. */
export function normalizeLoggingQuery(stream: LoggingStream, scope: LoggingReadScope, input: LoggingQuery = {}): NormalizedLoggingQuery {
  try {
    loggingChoice(stream, ['operational', 'audit']);
    const s = loggingRecord(scope, ['kind', 'tenantId']);
    const kind = loggingChoice(s.kind, ['application', 'tenant', 'platform'] as const);
    if (kind !== 'tenant' && 'tenantId' in s) invalid();
    const normalizedScope = Object.freeze(kind === 'tenant' ? { kind, tenantId: loggingId(s.tenantId)! } : { kind });
    const r = loggingRecord(input, ['projection', 'activityId', 'eventIds', 'limit', 'includeTotal', 'since', 'until', 'beforeOrdinal', 'highWaterOrdinal', 'family', 'action', 'actorId', 'userId', 'changedField', 'sessionId', 'targetType', 'targetId', 'outcome', 'level']);
    const limit = r.limit === undefined ? 50 : r.limit;
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > LOGGING_MAX_PAGE) invalid();
    const query: Record<string, unknown> & { limit: number } = { limit };
    if (r.projection !== undefined) query.projection = loggingChoice(r.projection, ['events', 'activities'] as const);
    if (r.activityId !== undefined) {
      if (typeof r.activityId !== 'string' || !/^[a-f0-9]{64}$/.test(r.activityId)) invalid();
      query.activityId = r.activityId;
    }
    if (r.includeTotal !== undefined) {
      if (typeof r.includeTotal !== 'boolean') invalid();
      query.includeTotal = r.includeTotal;
    }
    if (r.eventIds !== undefined) {
      const ids = loggingArray(r.eventIds, 100).map(value => {
        if (typeof value !== 'string' || value.length > 1024) invalid();
        const pair = JSON.parse(value as string);
        if (!Array.isArray(pair) || pair.length !== 2) invalid();
        return JSON.stringify([loggingId(pair[0]), loggingId(pair[1])]);
      });
      query.eventIds = Object.freeze([...new Set(ids)].sort());
    }
    for (const key of ['since', 'until'] as const) if (r[key] !== undefined) query[key] = loggingTime(r[key]);
    if (r.since !== undefined && r.until !== undefined && Number(r.since) >= Number(r.until)) invalid();
    for (const key of ['beforeOrdinal', 'highWaterOrdinal'] as const) if (r[key] !== undefined) {
      const n = r[key]; if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < (key === 'beforeOrdinal' ? 1 : 0)) invalid(); query[key] = n;
    }
    for (const key of ['actorId', 'userId', 'sessionId', 'targetId'] as const) if (r[key] !== undefined) query[key] = loggingId(r[key]);
    if (r.changedField !== undefined) {
      if (typeof r.changedField !== 'string' || !r.changedField || r.changedField.length > 256 || /[\u0000-\u001f\u007f]/.test(r.changedField)) invalid();
      query.changedField = r.changedField;
    }
    for (const key of ['action', 'targetType'] as const) if (r[key] !== undefined) query[key] = loggingCode(r[key]);
    if (r.family !== undefined) query.family = loggingChoice(r.family, LOGGING_FAMILIES);
    if (r.outcome !== undefined) query.outcome = loggingChoice(r.outcome, LOGGING_OUTCOMES);
    if (r.level !== undefined) query.level = loggingChoice(r.level, LOGGING_LEVELS);
    return Object.freeze({ stream, scope: normalizedScope, query: Object.freeze(query) as NormalizedLoggingQuery['query'] });
  } catch { return invalid('LOGGING_QUERY_INVALID'); }
}

/** All identifiers are static; untrusted criteria become bind values only. */
export function loggingPagePredicate(input: NormalizedLoggingQuery, highWater: number, alias?: 'e'): { sql: string; values: (string | number)[] } {
  const p = alias ? 'e.' : '';
  const sql = [p + 'stream = ?', p + 'ordinal <= ?'], values: (string | number)[] = [input.stream, highWater];
  if (input.scope.kind === 'tenant') { sql.push(p + 'scope_kind = ? AND ' + p + 'tenant_id = ?'); values.push('tenant', input.scope.tenantId); }
  else if (input.scope.kind === 'application') { sql.push(p + 'scope_kind = ?'); values.push('application'); }
  const q = input.query;
  if (q.userId !== undefined) {
    const actorKind = q.projection === 'activities' ? p + 'actor_kind' : `json_extract(${p}envelope,'$.actor.kind')`;
    const initiator = q.projection === 'activities' ? p + 'initiator_id' : `json_extract(${p}envelope,'$.actor.initiatorId')`;
    sql.push(`((${actorKind}='user' AND ${p}actor_id=?) OR ${initiator}=?)`); values.push(q.userId, q.userId);
  }
  if (q.changedField !== undefined) { sql.push(`EXISTS(SELECT 1 FROM logging_change_fields cf WHERE cf.event_ref=${alias ? 'e.id' : 'logging_events.id'} AND cf.field=?)`); values.push(q.changedField); }
  if (q.activityId !== undefined) {
    sql.push(p + 'id IN (SELECT event_ref FROM logging_activity_evidence WHERE activity_id=? AND linked_at<=?)'); values.push(q.activityId, highWater);
  }
  if (q.eventIds !== undefined) {
    const ids = q.eventIds.map(id => loggingDigest(JSON.parse(id)));
    sql.push(ids.length ? p + 'id IN (' + ids.map(() => '?').join(',') + ')' : '0');
    values.push(...ids);
  }
  if (q.since !== undefined) { sql.push(p + 'occurred_at >= ?'); values.push(q.since); }
  if (q.until !== undefined) { sql.push(p + 'occurred_at < ?'); values.push(q.until); }
  if (q.beforeOrdinal !== undefined) { sql.push(p + 'ordinal < ?'); values.push(q.beforeOrdinal); }
  const columns = { family: 'family', action: 'action', actorId: 'actor_id', sessionId: 'session_id', targetType: 'target_type', targetId: 'target_id', outcome: 'outcome', level: 'level' } as const;
  for (const [key, column] of Object.entries(columns)) {
    const value = q[key as keyof typeof columns]; if (value !== undefined) { sql.push(p + column + ' = ?'); values.push(value); }
  }
  return { sql: sql.join(' AND '), values };
}
