/** Indexed, scope-fenced activity snapshots and genuine INSERT/UPDATE/DELETE cursor evidence. */
import type { DatabaseReadQueryContext } from '../databases/database-realm';
import { DatabaseError } from '../databases/database-error';
import type { LoggingChangePage, LoggingPage, StoredLoggingEvent } from './logging-contracts';
import type { NormalizedLoggingQuery } from './logging-query';
import { loggingPagePredicate } from './logging-query';
import { loggingDigest } from './logging-hash';
import { isLoggingActivitySummary } from './logging-activity-summary';
import { projectLoggingStoredEvent, type LoggingStoredRow } from './logging-stored-event';
import { LOGGING_MAX_BATCH_BYTES, loggingByteLength } from './logging-validation';

type Connection = DatabaseReadQueryContext['database'];
type ProjectedRow = LoggingStoredRow & { projected_id: string; projected_ordinal: number; projected_revision: number; projected_ingested: number; activity_summary: string; activity_digest: string; filter_match?: number };
const fields = 'stream,scope_kind,tenant_id,actor_id,actor_kind,initiator_id,session_id,family,action,level,outcome,target_type,target_id,occurred_at,ingested_at,event_ref,summary,digest';
const selected = 'le.*,p.digest AS proof_digest,p.previous_hash,p.chain_hash,p.expired,e.id AS projected_id,e.ordinal AS projected_ordinal,e.revision AS projected_revision,e.ingested_at AS projected_ingested,e.summary AS activity_summary,e.digest AS activity_digest';
const joins = ' JOIN logging_events le ON le.id=e.event_ref LEFT JOIN logging_proofs p ON p.id=le.id';

function state(database: Connection, input: NormalizedLoggingQuery) {
  const head = database.query<{ stream: string; ordinal: number }>('SELECT stream,ordinal FROM logging_state WHERE id=?').get('head');
  if (head && head.stream !== input.stream) throw new DatabaseError('DATABASE_CONFLICT', 'Activity stream binding does not match.');
  const high = head?.ordinal ?? 0;
  const progress = database.query<{ cursor: number }>('SELECT cursor FROM logging_activity_state WHERE id=?').get('projection');
  if ((progress?.cursor ?? 0) < high) throw new DatabaseError('DATABASE_CONFLICT', 'Activity history is being rebuilt.');
  const water = Math.min(input.query.highWaterOrdinal ?? high, high);
  const source = water === high ? 'logging_activities e' : '(SELECT r.activity_id AS id,r.activity_ordinal AS ordinal,r.ordinal AS revision,'
    + fields.split(',').map(f => 'r.' + f).join(',') + ' FROM logging_activity_revisions r WHERE r.ordinal=(SELECT MAX(v.ordinal) FROM logging_activity_revisions v WHERE v.activity_id=r.activity_id AND v.ordinal<=?)) e';
  return { high, water, source, values: water === high ? [] : [water] };
}
function predicate(input: NormalizedLoggingQuery, high: number, omitCursor = false) {
  const { eventIds, activityId, changedField, ...q } = input.query;
  const p = loggingPagePredicate({ ...input, query: { ...q, ...(omitCursor ? { beforeOrdinal: undefined } : {}) } }, high, 'e');
  if (activityId) { p.sql += ' AND e.id=?'; p.values.push(activityId); }
  if (changedField) { p.sql += ' AND EXISTS(SELECT 1 FROM logging_activity_evidence ce JOIN logging_change_fields cf ON cf.event_ref=ce.event_ref WHERE ce.activity_id=e.id AND ce.linked_at<=? AND cf.field=?)'; p.values.push(high, changedField); }
  if (eventIds !== undefined) {
    const ids = eventIds.map(value => JSON.parse(value) as string[]).filter(pair => pair[0] === 'activity').map(pair => pair[1]!);
    p.sql += ids.length ? ' AND e.id IN (' + ids.map(() => '?').join(',') + ')' : ' AND 0'; p.values.push(...ids);
  }
  p.sql += ' AND EXISTS(SELECT 1 FROM logging_events retained WHERE retained.id=e.event_ref)';
  p.sql += ' AND NOT EXISTS(SELECT 1 FROM logging_activity_retirements retired WHERE retired.id=e.id AND retired.through>=e.revision)';
  return p;
}
function project(row: ProjectedRow): StoredLoggingEvent {
  const evidence = projectLoggingStoredEvent(row), summary = JSON.parse(row.activity_summary);
  if (!isLoggingActivitySummary(summary) || loggingDigest(summary) !== row.activity_digest || summary.id !== row.projected_id
    || summary.firstOrdinal !== row.projected_ordinal || summary.revision !== row.projected_revision || summary.revision !== evidence.ordinal)
    throw new DatabaseError('DATABASE_PROTOCOL_ERROR', 'Activity summary is inconsistent; rebuild its projection.');
  return { event: evidence.event, ordinal: summary.firstOrdinal, ingestedAt: row.projected_ingested, activity: summary };
}
export function readLoggingActivities({ database }: DatabaseReadQueryContext, input: NormalizedLoggingQuery): LoggingPage {
  const s = state(database, input), p = predicate(input, s.water), count = predicate(input, s.water, true);
  const total = input.query.includeTotal === false ? undefined : database.query<{ count: number }>('SELECT COUNT(*) AS count FROM ' + s.source + ' WHERE ' + count.sql).get(...s.values, ...count.values)!.count;
  const rows = database.query<ProjectedRow>('SELECT ' + selected + ' FROM ' + s.source + joins + ' WHERE ' + p.sql + ' ORDER BY e.ordinal DESC LIMIT ?').all(...s.values, ...p.values, input.query.limit + 1);
  const events: StoredLoggingEvent[] = []; let bytes = 1024;
  for (const row of rows.slice(0, input.query.limit)) {
    const item = project(row), size = loggingByteLength(item); if (bytes + size > LOGGING_MAX_BATCH_BYTES) break;
    events.push(item); bytes += size;
  }
  if (rows.length && !events.length) throw new DatabaseError('DATABASE_CAPACITY_EXHAUSTED', 'Activity exceeds its page byte budget.');
  const hasMore = rows.length > events.length;
  return { events, highWaterOrdinal: s.water, hasMore, nextBeforeOrdinal: hasMore ? events.at(-1)!.ordinal : null, ...(total === undefined ? {} : { total }) };
}
export function readLoggingActivityChanges({ database }: DatabaseReadQueryContext, input: NormalizedLoggingQuery, after: number): LoggingChangePage {
  const s = state(database, input);
  if (after > s.high) throw new DatabaseError('DATABASE_CONFLICT', 'Activity cursor does not match retained history.');
  const matches = predicate(input, s.water), scope = predicate({ ...input, query: { limit: input.query.limit } }, s.water);
  const updates = database.query<ProjectedRow>('SELECT ' + selected + ',CASE WHEN (' + matches.sql + ') THEN 1 ELSE 0 END AS filter_match FROM '
    + s.source + joins + ' WHERE ' + scope.sql + ' AND e.revision>? ORDER BY e.revision LIMIT ?')
    .all(...matches.values, ...s.values, ...scope.values, after, input.query.limit + 1);
  const ownerSql = input.scope.kind === 'platform' ? '' : ' AND r.scope_kind=? AND r.tenant_id IS ?';
  const ownerArgs = input.scope.kind === 'platform' ? [] : [input.scope.kind, input.scope.kind === 'tenant' ? input.scope.tenantId : null];
  const tombstones = database.query<{ id: string; revision: number }>('SELECT r.id,r.revision FROM logging_activity_retirements r WHERE r.stream=? AND r.revision>? AND r.revision<=?'
    + ownerSql + ' AND NOT EXISTS(SELECT 1 FROM logging_activities a WHERE a.id=r.id AND a.revision>r.revision) ORDER BY r.revision LIMIT ?')
    .all(input.stream, after, s.water, ...ownerArgs, input.query.limit + 1);
  const rows = [...updates.map(row => ({ revision: row.projected_revision, row })), ...tombstones.map(removed => ({ revision: removed.revision, removed }))]
    .sort((a, b) => a.revision - b.revision).slice(0, input.query.limit + 1);
  const events: StoredLoggingEvent[] = [], removed: { id: string; revision: number }[] = []; let bytes = 1024, through = after, processed = 0;
  for (const change of rows.slice(0, input.query.limit)) {
    if ('removed' in change) { removed.push(change.removed); through = change.revision; processed++; bytes += 128; continue; }
    const row = change.row, item = project(row), size = row.filter_match ? loggingByteLength(item) : 128;
    if (bytes + size > LOGGING_MAX_BATCH_BYTES) break;
    bytes += size; processed++; through = item.activity!.revision;
    if (row.filter_match) events.push(item); else removed.push({ id: item.activity!.id, revision: item.activity!.revision });
  }
  const hasMore = rows.length > processed;
  if (hasMore && !processed) throw new DatabaseError('DATABASE_CAPACITY_EXHAUSTED', 'Activity exceeds its change byte budget.');
  return { events, removed, afterOrdinal: after, throughOrdinal: hasMore ? through : s.high, highWaterOrdinal: s.high, hasMore };
}
