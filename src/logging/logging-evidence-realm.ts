/** Fixed, bounded evidence lifecycle handlers in the private logging actor. Public Guardian admission is separate. */
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext } from '../databases/database-realm';
import type { LoggingReadScope, LoggingQuery, LoggingStream } from './logging-contracts';
import { DatabaseError } from '../databases/database-error';
import { LOGGING_CHAIN_TABLE, LOGGING_HOLDS_TABLE, LOGGING_PROOFS_TABLE, LOGGING_REVIEWS_TABLE, LOGGING_EVENTS_TABLE } from './logging-schema';
import { loggingArray, loggingChoice, loggingId, loggingRecord, loggingTime, loggingCanonical, normalizeLoggingEvent } from './logging-validation';
import { normalizeLoggingQuery } from './logging-query';
import { loggingDigest } from './logging-hash';

export const LOGGING_GENESIS_HASH = loggingDigest(['zero.logging.chain', 1]);
export function loggingChainHash(previous: string, ordinal: number, id: string, digest: string, ingestedAt: number): string {
  return loggingDigest(['zero.logging.chain', 1, previous, ordinal, id, digest, ingestedAt]);
}
function fail(): never { throw new DatabaseError('DATABASE_PAYLOAD_INVALID', 'Logging evidence operation is invalid.', { outcome: 'not-committed' }); }
function scope(value: unknown): LoggingReadScope { return normalizeLoggingQuery('audit', value as LoggingReadScope).scope; }
function matches(s: LoggingReadScope, row: Record<string, unknown>): boolean { return s.kind === 'platform' || row.scope_kind === s.kind && (s.kind !== 'tenant' || row.tenant_id === s.tenantId); }
function positive(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail(); return value; }

/** Holds are separate records. Release never deletes or rewrites the original events. */
type AppendEvidence = (context: DatabaseWriteCommandContext, value: unknown) => unknown;
function appendAction(context: DatabaseWriteCommandContext, r: Record<string, unknown>, s: LoggingReadScope, action: string, append: AppendEvidence) {
  const event = normalizeLoggingEvent(r.auditEvent);
  if (event.family !== 'investigations' || event.action !== action || event.actor.id !== r.actorId
    || event.scope.kind !== s.kind || s.kind === 'tenant' && event.scope.tenantId !== s.tenantId || event.target?.id !== r.id) fail();
  const result = append(context, { stream: 'audit', events: [event] }) as { status: string };
  if (result.status !== 'stored') fail();
}
export function changeLoggingHold(context: DatabaseWriteCommandContext, value: unknown, append: AppendEvidence) {
  const { db } = context;
  const r = loggingRecord(value, ['scope', 'id', 'actorId', 'since', 'until', 'reasonRef', 'release', 'auditEvent']);
  const s = scope(r.scope), id = loggingId(r.id)!, actorId = loggingId(r.actorId)!;
  const existing = db.get(LOGGING_HOLDS_TABLE, id);
  if (r.release === true) {
    if (!existing || !matches(s, existing)) fail();
    if (existing.active) { appendAction(context, r, s, 'logging.hold.released', append); db.update(LOGGING_HOLDS_TABLE, id, { active: 0, released_at: Date.now(), released_by: actorId }); }
    return { id, active: false };
  }
  const since = loggingTime(r.since), until = loggingTime(r.until), reasonRef = loggingId(r.reasonRef)!;
  if (since >= until || s.kind === 'platform') fail();
  if (existing) {
    if (!matches(s, existing) || existing.since !== since || existing.until !== until || existing.reason_ref !== reasonRef || existing.created_by !== actorId) fail();
    return { id, active: Boolean(existing.active) };
  }
  // A hard bounded catalog makes command-side hold rechecks bounded even while pruning races a new hold.
  if (db.list(LOGGING_HOLDS_TABLE).length >= 1000) throw new DatabaseError('DATABASE_CAPACITY_EXHAUSTED', 'Logging hold catalog is full.');
  appendAction(context, r, s, 'logging.hold.created', append);
  db.createStrict(LOGGING_HOLDS_TABLE, { id, scope_kind: s.kind, tenant_id: s.kind === 'tenant' ? s.tenantId : null, since, until, reason_ref: reasonRef, active: 1, created_at: Date.now(), created_by: actorId, released_at: null, released_by: null });
  return { id, active: true };
}

export function recordLoggingReview(context: DatabaseWriteCommandContext, value: unknown, append: AppendEvidence) {
  const { db } = context;
  const r = loggingRecord(value, ['scope', 'id', 'actorId', 'query', 'highWaterOrdinal', 'result', 'reference', 'auditEvent']);
  const s = scope(r.scope), id = loggingId(r.id)!, actor = loggingId(r.actorId)!, reference = loggingId(r.reference)!;
  const query = normalizeLoggingQuery('audit', s, r.query as LoggingQuery).query, highWater = positive(r.highWaterOrdinal);
  const result = loggingChoice(r.result, ['reviewed', 'follow-up'] as const), queryJson = loggingCanonical(query);
  if (s.kind === 'platform') fail();
  const head = db.get('logging_state', 'head'); if (highWater > Number(head?.ordinal ?? 0)) fail();
  const prior = db.get(LOGGING_REVIEWS_TABLE, id);
  if (prior) {
    if (!matches(s, prior) || prior.reviewed_by !== actor || prior.query_json !== queryJson || prior.high_water !== highWater || prior.result !== result || prior.reference !== reference) fail();
    return { id, reviewedAt: prior.reviewed_at };
  }
  const reviewedAt = Date.now();
  appendAction(context, r, s, 'logging.review.recorded', append);
  db.createStrict(LOGGING_REVIEWS_TABLE, { id, scope_kind: s.kind, tenant_id: s.kind === 'tenant' ? s.tenantId : null, query_json: queryJson, high_water: highWater, result, reference, reviewed_at: reviewedAt, reviewed_by: actor });
  return { id, reviewedAt };
}

/** Discovery is a hint. The write command repeats the live hold and age checks under its own transaction. */
export function loggingPruneCandidates({ database }: DatabaseReadQueryContext, value: unknown) {
  const r = loggingRecord(value, ['before']); const before = loggingTime(r.before);
  return database.query<{ id: string }>(`SELECT e.id FROM logging_events e WHERE e.ingested_at < ? AND NOT EXISTS (
    SELECT 1 FROM logging_holds h WHERE h.active=1 AND h.scope_kind=e.scope_kind AND (h.tenant_id IS e.tenant_id)
    AND e.occurred_at >= h.since AND e.occurred_at < h.until) ORDER BY e.ordinal LIMIT 100`).all(before).map(row => row.id);
}
export function pruneLoggingEvents({ db }: DatabaseWriteCommandContext, value: unknown) {
  const r = loggingRecord(value, ['before', 'ids']); const before = loggingTime(r.before), ids = loggingArray(r.ids, 100).map(id => loggingId(id)!);
  const holds = db.list(LOGGING_HOLDS_TABLE).filter(h => h.active === 1); let removed = 0;
  for (const id of ids) {
    const row = db.get(LOGGING_EVENTS_TABLE, id); if (!row || Number(row.ingested_at) >= before) continue;
    if (holds.some(h => h.scope_kind === row.scope_kind && h.tenant_id === row.tenant_id && Number(row.occurred_at) >= Number(h.since) && Number(row.occurred_at) < Number(h.until))) continue;
    const proof = db.get(LOGGING_PROOFS_TABLE, id); if (!proof || proof.digest !== row.digest) fail();
    db.update(LOGGING_PROOFS_TABLE, id, { expired: 1 }); db.delete(LOGGING_EVENTS_TABLE, id); removed++;
  }
  return { removed };
}

/** Verify at most 100 entries including missing/expired envelopes and their predecessor link. */
export function verifyLoggingEvidence({ database }: DatabaseReadQueryContext, value: unknown) {
  const r = loggingRecord(value, ['stream', 'afterOrdinal', 'checkpoint']);
  const stream = loggingChoice(r.stream, ['audit', 'operational'] as const), after = positive(r.afterOrdinal ?? 0);
  const head = database.query<{ ordinal: number; hash: string }>('SELECT ordinal,hash FROM logging_chain WHERE id=?').get('head') ?? { ordinal: 0, hash: LOGGING_GENESIS_HASH };
  const rows = database.query<any>('SELECT p.*,e.envelope FROM logging_proofs p LEFT JOIN logging_events e ON e.id=p.id WHERE p.ordinal>? ORDER BY p.ordinal LIMIT 100').all(after);
  let previous = after === 0 ? LOGGING_GENESIS_HASH : database.query<{ chain_hash: string }>('SELECT chain_hash FROM logging_proofs WHERE ordinal=?').get(after)?.chain_hash;
  if (!previous || after > head.ordinal) fail();
  let cursor = after, expired = 0; let previousHash: string = previous;
  for (const p of rows) {
    if (p.ordinal !== cursor + 1 || p.previous_hash !== previousHash || p.chain_hash !== loggingChainHash(previousHash, p.ordinal, p.id, p.digest, p.ingested_at)) throw new DatabaseError('DATABASE_PROTOCOL_ERROR', 'Logging integrity verification failed.');
    if (p.expired === 1) { if (p.envelope !== null) fail(); expired++; }
    else if (p.envelope === null || loggingDigest(normalizeLoggingEvent(JSON.parse(p.envelope))) !== p.digest) throw new DatabaseError('DATABASE_PROTOCOL_ERROR', 'Logging evidence is missing or changed.');
    previousHash = p.chain_hash; cursor = p.ordinal;
  }
  if (cursor === head.ordinal && previousHash !== head.hash || cursor < head.ordinal && !rows.length) throw new DatabaseError('DATABASE_PROTOCOL_ERROR', 'Logging chain tail is inconsistent.');
  if (r.checkpoint !== undefined) {
    const cp = loggingRecord(r.checkpoint, ['version', 'stream', 'ordinal', 'hash']);
    if (cp.version !== 1 || cp.stream !== stream || typeof cp.hash !== 'string' || !/^[a-f0-9]{64}$/.test(cp.hash)) fail();
    const at = positive(cp.ordinal); const actual = at === 0 ? LOGGING_GENESIS_HASH : database.query<{ chain_hash: string }>('SELECT chain_hash FROM logging_proofs WHERE ordinal=?').get(at)?.chain_hash;
    if (actual !== cp.hash) throw new DatabaseError('DATABASE_PROTOCOL_ERROR', 'Independent logging checkpoint does not match.');
  }
  return { checked: rows.length, expired, throughOrdinal: cursor, hasMore: cursor < head.ordinal, checkpoint: { version: 1, stream, ordinal: head.ordinal, hash: head.hash } };
}

export function listLoggingEvidence({ database }: DatabaseReadQueryContext, value: unknown) {
  const r = loggingRecord(value, ['scope', 'before']), s = scope(r.scope), before = positive(r.before ?? Number.MAX_SAFE_INTEGER);
  const clause = s.kind === 'platform' ? '1=1' : s.kind === 'tenant' ? 'scope_kind=? AND tenant_id=?' : 'scope_kind=?';
  const values = s.kind === 'platform' ? [] : s.kind === 'tenant' ? ['tenant', s.tenantId] : ['application'];
  const holds = database.query<any>('SELECT * FROM logging_holds WHERE ' + clause + ' ORDER BY created_at DESC,id DESC LIMIT 101').all(...values);
  const reviews = database.query<any>('SELECT * FROM logging_reviews WHERE ' + clause + ' AND reviewed_at<? ORDER BY reviewed_at DESC,id DESC LIMIT 101').all(...values, before);
  return { holds: holds.slice(0, 100).map(h => ({ id: h.id, since: h.since, until: h.until, reasonRef: h.reason_ref, active: h.active === 1, createdAt: h.created_at, createdBy: h.created_by, releasedAt: h.released_at, releasedBy: h.released_by })),
    reviews: reviews.slice(0, 100).map(r => ({ id: r.id, query: normalizeLoggingQuery('audit', s, JSON.parse(r.query_json)).query, highWaterOrdinal: r.high_water, result: r.result, reference: r.reference, reviewedAt: r.reviewed_at, reviewedBy: r.reviewed_by })),
    hasMoreHolds: holds.length > 100, hasMoreReviews: reviews.length > 100, nextReviewBefore: reviews.length > 100 ? reviews[99]!.reviewed_at : null };
}
