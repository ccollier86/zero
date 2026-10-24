/** Dedicated Fabric log realm. Actor-local handlers own atomic append/deduplication and scoped bounded reads. */
import { defineDatabaseRealm, type DatabaseReadQueryContext, type DatabaseWriteCommandContext } from '../databases/database-realm';
import { DatabaseError } from '../databases/database-error';
import type { Row } from '../sync/types';
import { quoteSqlIdentifier } from '../sync/identity';
import type { LoggingEvent, LoggingReadScope, LoggingStream, LoggingQuery } from './logging-contracts';
import { loggingDigest } from './logging-hash';
import { loggingPagePredicate, normalizeLoggingQuery } from './logging-query';
import { LOGGING_MAX_BATCH, LOGGING_MAX_BATCH_BYTES, loggingArray, loggingByteLength, loggingCanonical, loggingChoice, loggingRecord, normalizeLoggingEvent } from './logging-validation';
import { LOGGING_EVENTS_TABLE, LOGGING_STATE_TABLE, LOGGING_TABLES } from './logging-schema';

const HEADS = LOGGING_STATE_TABLE;
const HEAD_ID = 'head';
type Head = { id: string; stream: LoggingStream; ordinal: number };
type EventRow = Row & { id: string; digest: string; envelope: string; ordinal: number; ingested_at: number };

/** Side-effect-free declaration. Both writer and reader actors import this exact realm/version. */
export const loggingRealm = defineDatabaseRealm({
  name: 'zero-logging', version: '1',
  tables: LOGGING_TABLES,
  migrations: [{
    version: '001', description: 'Index bounded scope, actor and resource investigations', safety: 'safe',
    up(database) {
      // Realm migrations precede ReactiveDB table registration. Use the same
      // fixed schema here so the investigation indexes have physical targets.
      for (const [table, columns] of Object.entries(LOGGING_TABLES)) {
        const definitions = Object.entries(columns).map(([name, definition]) => quoteSqlIdentifier(name) + ' ' + definition);
        database.run('CREATE TABLE IF NOT EXISTS ' + quoteSqlIdentifier(table) + ' (' + definitions.join(', ') + ')');
      }
      database.run('CREATE INDEX IF NOT EXISTS logging_scope_page ON logging_events(scope_kind, tenant_id, ordinal DESC)');
      database.run('CREATE INDEX IF NOT EXISTS logging_actor_page ON logging_events(actor_id, ordinal DESC)');
      database.run('CREATE INDEX IF NOT EXISTS logging_target_page ON logging_events(target_type, target_id, ordinal DESC)');
      database.run('CREATE INDEX IF NOT EXISTS logging_time_page ON logging_events(occurred_at, ordinal DESC)');
    },
  }],
  commands: { 'logging.append': appendLoggingBatch },
  queries: { 'logging.page': readLoggingPage },
});

function admitBatch(value: unknown): { stream: LoggingStream; events: readonly LoggingEvent[] } {
  try {
    const input = loggingRecord(value, ['stream', 'events']);
    const stream = loggingChoice(input.stream, ['operational', 'audit'] as const);
    const events = loggingArray(input.events, LOGGING_MAX_BATCH).map(normalizeLoggingEvent);
    if (!events.length || loggingByteLength(events) > LOGGING_MAX_BATCH_BYTES) throw new Error();
    if (events.some(event => event.stream !== stream)) throw new Error();
    return { stream, events };
  } catch { throw new DatabaseError('DATABASE_PAYLOAD_INVALID', 'Logging append payload is invalid.', { outcome: 'not-committed' }); }
}

/** Validate the complete batch and all existing keys before changing any event row. */
function appendLoggingBatch({ db }: DatabaseWriteCommandContext, input: unknown) {
  const { stream, events } = admitBatch(input);
  const head = db.get(HEADS, HEAD_ID) as Head | null;
  if (head && head.stream !== stream) return { status: 'stream-conflict' };
  const planned = new Map<string, { event: LoggingEvent; digest: string; existing: EventRow | null }>();
  for (const event of events) {
    const id = loggingDigest([event.sourceId, event.id]), digest = loggingDigest(event);
    const existing = db.get(LOGGING_EVENTS_TABLE, id) as EventRow | null;
    if (existing && existing.digest !== digest || planned.has(id) && planned.get(id)!.digest !== digest) return { status: 'event-conflict' };
    planned.set(id, { event, digest, existing });
  }
  const newCount = [...planned.values()].filter(item => !item.existing).length;
  const last = head?.ordinal ?? 0;
  if (!Number.isSafeInteger(last) || last < 0 || !Number.isSafeInteger(last + newCount)) throw new DatabaseError('DATABASE_CAPACITY_EXHAUSTED', 'Logging sequence is exhausted.', { outcome: 'not-committed' });
  let ordinal = last; const ingestedAt = Date.now();
  const rows = new Map<string, { ordinal: number; inserted: boolean }>();
  for (const [id, item] of planned) {
    if (item.existing) { rows.set(id, { ordinal: item.existing.ordinal, inserted: false }); continue; }
    const event = item.event;
    db.createStrict(LOGGING_EVENTS_TABLE, {
      id, stream, ordinal: ++ordinal, source_id: event.sourceId, event_id: event.id, digest: item.digest,
      occurred_at: event.occurredAt, ingested_at: ingestedAt, scope_kind: event.scope.kind, tenant_id: event.scope.tenantId,
      actor_id: event.actor.id, session_id: event.actor.sessionId, family: event.family, action: event.action,
      level: event.level, outcome: event.outcome, target_type: event.target?.type ?? null, target_id: event.target?.id ?? null,
      envelope: loggingCanonical(event),
    });
    rows.set(id, { ordinal, inserted: true });
  }
  if (!head) db.createStrict(HEADS, { id: HEAD_ID, stream, ordinal });
  else if (ordinal !== last) db.update(HEADS, HEAD_ID, { ordinal });
  const emitted = new Set<string>();
  return { status: 'stored', receipts: events.map(event => {
    const id = loggingDigest([event.sourceId, event.id]), row = rows.get(id)!;
    const duplicate = !row.inserted || emitted.has(id); emitted.add(id);
    return { id: event.id, sourceId: event.sourceId, ordinal: row.ordinal, duplicate };
  }) };
}

function readLoggingPage({ database }: DatabaseReadQueryContext, value: unknown) {
  let input;
  try {
    const r = loggingRecord(value, ['stream', 'scope', 'query']);
    input = normalizeLoggingQuery(r.stream as LoggingStream, r.scope as LoggingReadScope, r.query as LoggingQuery);
  } catch { throw new DatabaseError('DATABASE_PAYLOAD_INVALID', 'Logging query is invalid.'); }
  const head = database.query<Head>('SELECT id, stream, ordinal FROM logging_state WHERE id = ?').get(HEAD_ID);
  if (head && head.stream !== input.stream) throw new DatabaseError('DATABASE_CONFLICT', 'Logging stream binding does not match.');
  const highWaterOrdinal = Math.min(input.query.highWaterOrdinal ?? head?.ordinal ?? 0, head?.ordinal ?? 0);
  const predicate = loggingPagePredicate(input, highWaterOrdinal);
  const found = database.query<EventRow>('SELECT * FROM logging_events WHERE ' + predicate.sql + ' ORDER BY ordinal DESC LIMIT ?').all(...predicate.values, input.query.limit + 1);
  const events = []; let bytes = 1024;
  for (const row of found.slice(0, input.query.limit)) {
    const event = normalizeLoggingEvent(JSON.parse(row.envelope));
    // Indexed scope/filter fields must describe the retained envelope exactly.
    const columns = { stream: event.stream, source_id: event.sourceId, event_id: event.id, scope_kind: event.scope.kind, tenant_id: event.scope.tenantId,
      occurred_at: event.occurredAt, actor_id: event.actor.id, session_id: event.actor.sessionId, family: event.family, action: event.action,
      level: event.level, outcome: event.outcome, target_type: event.target?.type ?? null, target_id: event.target?.id ?? null };
    if (row.id !== loggingDigest([event.sourceId, event.id]) || row.digest !== loggingDigest(event)
      || Object.entries(columns).some(([key, value]) => row[key] !== value)) throw new DatabaseError('DATABASE_PROTOCOL_ERROR', 'Stored logging evidence is inconsistent.');
    const item = { event, ordinal: row.ordinal, ingestedAt: row.ingested_at }, size = loggingByteLength(item);
    if (bytes + size > LOGGING_MAX_BATCH_BYTES) break;
    events.push(item); bytes += size;
  }
  const hasMore = found.length > events.length;
  return { events, highWaterOrdinal, hasMore, nextBeforeOrdinal: hasMore ? events.at(-1)!.ordinal : null };
}
