/** Revalidate actor acknowledgments/pages before publication; malformed accepted writes retain an unknown outcome. */
import type { LoggingEvent, LoggingPage, LoggingReceipt } from './logging-contracts';
import type { NormalizedLoggingQuery } from './logging-query';
import { LoggingError } from './logging-error';
import { loggingArray, loggingRecord, loggingTime, normalizeLoggingEvent } from './logging-validation';

export function readLoggingAppend(value: unknown, events: readonly LoggingEvent[], replayed: boolean): readonly LoggingReceipt[] {
  try {
    const command = loggingRecord(value, ['kind', 'name', 'output']);
    if (command.kind !== 'command' || command.name !== 'logging.append') throw new Error();
    const result = loggingRecord(command.output, ['status', 'receipts']);
    if (result.status === 'event-conflict' || result.status === 'stream-conflict') throw new LoggingError('LOGGING_EVENT_CONFLICT', 'Logging event identity or stream binding conflicts.', 'not-committed');
    if (result.status !== 'stored') throw new Error();
    const receipts = loggingArray(result.receipts, events.length);
    if (receipts.length !== events.length) throw new Error();
    return Object.freeze(receipts.map((raw, i) => {
      const r = loggingRecord(raw, ['id', 'sourceId', 'ordinal', 'duplicate']);
      if (r.id !== events[i]!.id || r.sourceId !== events[i]!.sourceId || typeof r.ordinal !== 'number' || !Number.isSafeInteger(r.ordinal) || r.ordinal < 1 || typeof r.duplicate !== 'boolean') throw new Error();
      return Object.freeze({ id: r.id, sourceId: r.sourceId, ordinal: r.ordinal, duplicate: replayed || r.duplicate });
    }));
  } catch (error) {
    if (error instanceof LoggingError && error.code === 'LOGGING_EVENT_CONFLICT') throw error;
    throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Logging append acknowledgment is invalid.', 'unknown');
  }
}

export function readLoggingPage(value: unknown, input: NormalizedLoggingQuery): LoggingPage {
  try {
    const r = loggingRecord(value, ['events', 'highWaterOrdinal', 'hasMore', 'nextBeforeOrdinal']);
    if (typeof r.highWaterOrdinal !== 'number' || !Number.isSafeInteger(r.highWaterOrdinal) || r.highWaterOrdinal < 0 || typeof r.hasMore !== 'boolean') throw new Error();
    if (input.query.highWaterOrdinal !== undefined && r.highWaterOrdinal > input.query.highWaterOrdinal) throw new Error();
    let before = input.query.beforeOrdinal ?? Number.MAX_SAFE_INTEGER;
    const events = loggingArray(r.events, input.query.limit).map(raw => {
      const row = loggingRecord(raw, ['event', 'ordinal', 'ingestedAt']);
      if (typeof row.ordinal !== 'number' || !Number.isSafeInteger(row.ordinal) || row.ordinal < 1 || row.ordinal >= before || row.ordinal > (r.highWaterOrdinal as number)) throw new Error();
      before = row.ordinal;
      const event = normalizeLoggingEvent(row.event);
      if (event.stream !== input.stream || input.scope.kind === 'tenant' && (event.scope.kind !== 'tenant' || event.scope.tenantId !== input.scope.tenantId)
        || input.scope.kind === 'application' && event.scope.kind !== 'application') throw new Error();
      return Object.freeze({ event, ordinal: row.ordinal, ingestedAt: loggingTime(row.ingestedAt) });
    });
    if (r.hasMore ? !events.length || r.nextBeforeOrdinal !== events.at(-1)!.ordinal : r.nextBeforeOrdinal !== null) throw new Error();
    return Object.freeze({ events: Object.freeze(events), highWaterOrdinal: r.highWaterOrdinal, hasMore: r.hasMore, nextBeforeOrdinal: r.nextBeforeOrdinal as number | null });
  } catch { throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Logging query response is invalid.'); }
}
