/** Read the private ReactiveDB's committed append sequence; never turn a latest-page diff into INSERTs. */
import type { DatabaseReadQueryContext } from '../databases/database-realm';
import { DatabaseError } from '../databases/database-error';
import type { LoggingChangePage, LoggingQuery, LoggingReadScope, LoggingStream } from './logging-contracts';
import { loggingPagePredicate, normalizeLoggingQuery } from './logging-query';
import { LOGGING_MAX_BATCH_BYTES, loggingByteLength, loggingRecord } from './logging-validation';
import { projectLoggingStoredEvent, type LoggingStoredRow } from './logging-stored-event';

export function readLoggingChanges({ database }: DatabaseReadQueryContext, raw: unknown): LoggingChangePage {
  const value = loggingRecord(raw, ['stream', 'scope', 'query', 'afterOrdinal']);
  const input = normalizeLoggingQuery(value.stream as LoggingStream, value.scope as LoggingReadScope, value.query as LoggingQuery);
  const after = value.afterOrdinal;
  if (!Number.isSafeInteger(after) || Number(after) < 0) throw new DatabaseError('DATABASE_PAYLOAD_INVALID', 'Logging change cursor is invalid.');
  const head = database.query<{ stream: string; ordinal: number }>('SELECT stream,ordinal FROM logging_state WHERE id=?').get('head');
  const highWaterOrdinal = head?.ordinal ?? 0;
  if (head && head.stream !== input.stream || Number(after) > highWaterOrdinal) throw new DatabaseError('DATABASE_CONFLICT', 'Logging change cursor does not match retained history.');
  const predicate = loggingPagePredicate(input, Math.min(highWaterOrdinal, input.query.highWaterOrdinal ?? highWaterOrdinal), 'e');
  const found = database.query<LoggingStoredRow>('SELECT e.*,p.digest AS proof_digest,p.previous_hash,p.chain_hash,p.expired FROM logging_events e LEFT JOIN logging_proofs p ON p.id=e.id WHERE '
    + predicate.sql + ' AND e.ordinal > ? ORDER BY e.ordinal ASC LIMIT ?').all(...predicate.values, Number(after), input.query.limit + 1);
  const events = []; let bytes = 1024;
  for (const row of found.slice(0, input.query.limit)) {
    const event = projectLoggingStoredEvent(row), size = loggingByteLength(event);
    if (bytes + size > LOGGING_MAX_BATCH_BYTES) break;
    events.push(event); bytes += size;
  }
  const hasMore = found.length > events.length;
  if (hasMore && !events.length) throw new DatabaseError('DATABASE_CAPACITY_EXHAUSTED', 'Logging change exceeds its delivery budget.');
  return { events, afterOrdinal: Number(after), throughOrdinal: hasMore ? events.at(-1)!.ordinal : highWaterOrdinal, highWaterOrdinal, hasMore };
}
