/** Dedicated Fabric log realm. Actor-local handlers own atomic append/deduplication and scoped bounded reads. */
import { defineDatabaseRealm, type DatabaseReadQueryContext, type DatabaseWriteCommandContext } from '../databases/database-realm';
import { DatabaseError } from '../databases/database-error';
import type { Row } from '../sync/types';
import { quoteSqlIdentifier } from '../sync/identity';
import type { LoggingEvent, LoggingReadScope, LoggingStream, LoggingQuery } from './logging-contracts';
import { loggingDigest } from './logging-hash';
import { loggingPagePredicate, normalizeLoggingQuery } from './logging-query';
import { LOGGING_MAX_BATCH, LOGGING_MAX_BATCH_BYTES, loggingArray, loggingByteLength, loggingCanonical, loggingChoice, loggingRecord, normalizeLoggingEvent } from './logging-validation';
import { LOGGING_EVENTS_TABLE, LOGGING_STATE_TABLE, LOGGING_TABLES, LOGGING_CHAIN_TABLE, LOGGING_PROOFS_TABLE } from './logging-schema';
import { changeLoggingHold, recordLoggingReview, loggingPruneCandidates, pruneLoggingEvents, verifyLoggingEvidence, listLoggingEvidence, LOGGING_GENESIS_HASH, loggingChainHash } from './logging-evidence-realm';
import { reserveLoggingExport, transitionLoggingExport, readLoggingExport, pendingLoggingExports } from './logging-export-realm';
import { appendLocalLoggingCheckpoint, readLocalLoggingCheckpoint } from './logging-checkpoint-realm';
import { readLoggingChanges } from './logging-change-query';
import { projectLoggingStoredEvent } from './logging-stored-event';
import { LOGGING_CONTROL_TABLES } from './logging-control-realm';

const HEADS = LOGGING_STATE_TABLE;
const HEAD_ID = 'head';
type Head = { id: string; stream: LoggingStream; ordinal: number };
type EventRow = Row & { id: string; digest: string; envelope: string; ordinal: number; ingested_at: number };

/** Side-effect-free declaration. Both writer and reader actors import this exact realm/version. */
export const loggingRealm = defineDatabaseRealm({
  name: 'zero-logging', version: '7',
  tables: { ...LOGGING_TABLES, ...LOGGING_CONTROL_TABLES },
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
  }, {
    version: '002', description: 'Retained replay proofs, integrity chains, legal holds and review evidence', safety: 'safe',
    up(database) {
      for (const [table, columns] of Object.entries(LOGGING_TABLES)) {
        const definitions = Object.entries(columns).map(([name, definition]) => quoteSqlIdentifier(name) + ' ' + definition);
        database.run('CREATE TABLE IF NOT EXISTS ' + quoteSqlIdentifier(table) + ' (' + definitions.join(', ') + ')');
      }
      database.run('CREATE INDEX IF NOT EXISTS logging_proof_order ON logging_proofs(ordinal)');
      database.run('CREATE INDEX IF NOT EXISTS logging_expiration ON logging_events(ingested_at,ordinal)');
      let previous = LOGGING_GENESIS_HASH, ordinal = 0;
      for (const row of database.query<{ id: string; digest: string; envelope: string; ordinal: number; ingested_at: number }, []>('SELECT id,digest,envelope,ordinal,ingested_at FROM logging_events ORDER BY ordinal').iterate()) {
        if (row.ordinal !== ordinal + 1 || loggingDigest(normalizeLoggingEvent(JSON.parse(row.envelope))) !== row.digest) throw new Error('Existing logging evidence is inconsistent.');
        const hash = loggingChainHash(previous, row.ordinal, row.id, row.digest, row.ingested_at);
        database.run('INSERT INTO logging_proofs(id,ordinal,digest,previous_hash,chain_hash,expired,ingested_at) VALUES(?,?,?,?,?,0,?)', [row.id, row.ordinal, row.digest, previous, hash, row.ingested_at]);
        previous = hash; ordinal = row.ordinal;
      }
      database.run('INSERT INTO logging_chain(id,ordinal,hash) VALUES(?,?,?)', ['head', ordinal, previous]);
    },
  }, {
    version: '003', description: 'Composite evidence history pagination indexes', safety: 'safe',
    up(database) {
      database.run('CREATE INDEX IF NOT EXISTS logging_holds_history ON logging_holds(scope_kind,tenant_id,created_at DESC,id DESC)');
      database.run('CREATE INDEX IF NOT EXISTS logging_reviews_history ON logging_reviews(scope_kind,tenant_id,reviewed_at DESC,id DESC)');
    },
  }, {
    version: '004', description: 'Durable private artifact export jobs', safety: 'safe',
    up(database) {
      const columns = LOGGING_TABLES.logging_exports;
      database.run('CREATE TABLE IF NOT EXISTS logging_exports (' + Object.entries(columns).map(([key, type]) => quoteSqlIdentifier(key) + ' ' + type).join(',') + ')');
      database.run('CREATE INDEX IF NOT EXISTS logging_export_pending ON logging_exports(state,expires_at,created_at,id)');
    },
  }, {
    version: '005', description: 'Append-only local checkpoint ledger and immutable event content', safety: 'safe',
    up(database) {
      database.run('CREATE TABLE IF NOT EXISTS logging_checkpoints (id TEXT PRIMARY KEY,ledger_id TEXT NOT NULL,stream TEXT NOT NULL,position INTEGER NOT NULL,ordinal INTEGER NOT NULL,hash TEXT NOT NULL,digest TEXT NOT NULL,envelope TEXT NOT NULL)');
      database.run('CREATE UNIQUE INDEX IF NOT EXISTS logging_checkpoint_order ON logging_checkpoints(ledger_id,stream,position)');
      database.run("CREATE TRIGGER IF NOT EXISTS logging_checkpoint_no_update BEFORE UPDATE ON logging_checkpoints BEGIN SELECT RAISE(ABORT,'Logging checkpoints are append-only'); END");
      database.run("CREATE TRIGGER IF NOT EXISTS logging_checkpoint_no_delete BEFORE DELETE ON logging_checkpoints BEGIN SELECT RAISE(ABORT,'Logging checkpoints are append-only'); END");
      database.run("CREATE TRIGGER IF NOT EXISTS logging_event_no_update BEFORE UPDATE ON logging_events BEGIN SELECT RAISE(ABORT,'Logging event content is immutable'); END");
      database.run("CREATE TRIGGER IF NOT EXISTS logging_proof_no_delete BEFORE DELETE ON logging_proofs BEGIN SELECT RAISE(ABORT,'Logging replay proofs are retained'); END");
      database.run("CREATE TRIGGER IF NOT EXISTS logging_proof_immutable BEFORE UPDATE ON logging_proofs WHEN NEW.id IS NOT OLD.id OR NEW.ordinal IS NOT OLD.ordinal OR NEW.digest IS NOT OLD.digest OR NEW.previous_hash IS NOT OLD.previous_hash OR NEW.chain_hash IS NOT OLD.chain_hash OR NEW.ingested_at IS NOT OLD.ingested_at OR NEW.expired IS NOT 1 OR OLD.expired IS NOT 0 BEGIN SELECT RAISE(ABORT,'Logging proof content is immutable'); END");
    },
  }, {
    version: '006', description: 'Private bounded delivery liveness control, separate from activity evidence', safety: 'safe',
    up(database) {
      database.run('CREATE TABLE IF NOT EXISTS logging_delivery_control (id TEXT PRIMARY KEY,nonce TEXT NOT NULL,checked_at INTEGER NOT NULL)');
    },
  }],
  commands: { 'logging.append': appendLoggingBatch,
    'logging.hold': (context, input) => changeLoggingHold(context, input, appendLoggingBatch),
    'logging.review': (context, input) => recordLoggingReview(context, input, appendLoggingBatch), 'logging.prune': pruneLoggingEvents,
    'logging.export.reserve': (context, input) => reserveLoggingExport(context, input, appendLoggingBatch),
    'logging.export.transition': (context, input) => transitionLoggingExport(context, input, appendLoggingBatch),
    'logging.checkpoint.append': appendLocalLoggingCheckpoint },
  queries: { 'logging.page': readLoggingPage, 'logging.changes': readLoggingChanges, 'logging.verify': verifyLoggingEvidence, 'logging.prune-candidates': loggingPruneCandidates, 'logging.evidence': listLoggingEvidence,
    'logging.export': readLoggingExport, 'logging.exports.pending': pendingLoggingExports, 'logging.checkpoint.read': readLocalLoggingCheckpoint },
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
    const proof = db.get(LOGGING_PROOFS_TABLE, id);
    const existing = (proof ?? db.get(LOGGING_EVENTS_TABLE, id)) as EventRow | null;
    if (existing && existing.digest !== digest || planned.has(id) && planned.get(id)!.digest !== digest) return { status: 'event-conflict' };
    planned.set(id, { event, digest, existing });
  }
  const newCount = [...planned.values()].filter(item => !item.existing).length;
  const last = head?.ordinal ?? 0;
  if (!Number.isSafeInteger(last) || last < 0 || !Number.isSafeInteger(last + newCount)) throw new DatabaseError('DATABASE_CAPACITY_EXHAUSTED', 'Logging sequence is exhausted.', { outcome: 'not-committed' });
  let ordinal = last; const ingestedAt = Date.now();
  const chain = db.get(LOGGING_CHAIN_TABLE, HEAD_ID);
  if (!chain || chain.ordinal !== last) throw new DatabaseError('DATABASE_PROTOCOL_ERROR', 'Logging integrity head is inconsistent.');
  let previous = String(chain.hash);
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
    const hash = loggingChainHash(previous, ordinal, id, item.digest, ingestedAt);
    db.createStrict(LOGGING_PROOFS_TABLE, { id, ordinal, digest: item.digest, previous_hash: previous, chain_hash: hash, expired: 0, ingested_at: ingestedAt });
    previous = hash;
    rows.set(id, { ordinal, inserted: true });
  }
  if (!head) db.createStrict(HEADS, { id: HEAD_ID, stream, ordinal });
  else if (ordinal !== last) db.update(HEADS, HEAD_ID, { ordinal });
  if (ordinal !== last) db.update(LOGGING_CHAIN_TABLE, HEAD_ID, { ordinal, hash: previous });
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
  const predicate = loggingPagePredicate(input, highWaterOrdinal, 'e');
  const totalPredicate = loggingPagePredicate({ ...input, query: { ...input.query, beforeOrdinal: undefined } }, highWaterOrdinal, 'e');
  const total = database.query<{ count: number }>('SELECT COUNT(*) AS count FROM logging_events e WHERE ' + totalPredicate.sql).get(...totalPredicate.values)!.count;
  const found = database.query<EventRow>('SELECT e.*,p.digest AS proof_digest,p.previous_hash,p.chain_hash,p.expired FROM logging_events e LEFT JOIN logging_proofs p ON p.id=e.id WHERE ' + predicate.sql + ' ORDER BY e.ordinal DESC LIMIT ?').all(...predicate.values, input.query.limit + 1);
  const events = []; let bytes = 1024;
  for (const row of found.slice(0, input.query.limit)) {
    const item = projectLoggingStoredEvent(row), size = loggingByteLength(item);
    if (bytes + size > LOGGING_MAX_BATCH_BYTES) break;
    events.push(item); bytes += size;
  }
  const hasMore = found.length > events.length;
  return { events, highWaterOrdinal, total, hasMore, nextBeforeOrdinal: hasMore ? events.at(-1)!.ordinal : null };
}
