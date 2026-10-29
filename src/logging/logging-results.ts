/** Revalidate actor acknowledgments/pages before publication; malformed accepted writes retain an unknown outcome. */
import type { LoggingChangePage, LoggingEvent, LoggingPage, LoggingReceipt } from './logging-contracts';
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
    const r = loggingRecord(value, ['events', 'highWaterOrdinal', 'hasMore', 'nextBeforeOrdinal', 'total']);
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
    if (r.total !== undefined && (!Number.isSafeInteger(r.total) || Number(r.total) < events.length || r.hasMore && Number(r.total) <= events.length)) throw new Error();
    return Object.freeze({ events: Object.freeze(events), highWaterOrdinal: r.highWaterOrdinal, hasMore: r.hasMore, nextBeforeOrdinal: r.nextBeforeOrdinal as number | null,
      ...(r.total === undefined ? {} : { total: Number(r.total) }) });
  } catch { throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Logging query response is invalid.'); }
}

/** Change cursors are ascending and resumable; a truncated latest snapshot is not append evidence. */
export function readLoggingChangePage(value: unknown, input: NormalizedLoggingQuery, afterOrdinal: number): LoggingChangePage {
  try {
    const r = loggingRecord(value, ['events', 'afterOrdinal', 'throughOrdinal', 'highWaterOrdinal', 'hasMore']);
    if (r.afterOrdinal !== afterOrdinal || !Number.isSafeInteger(r.throughOrdinal) || Number(r.throughOrdinal) < afterOrdinal
      || !Number.isSafeInteger(r.highWaterOrdinal) || Number(r.highWaterOrdinal) < Number(r.throughOrdinal) || typeof r.hasMore !== 'boolean') throw new Error();
    const rows = loggingArray(r.events, input.query.limit);
    const page = readLoggingPage({ events: rows.slice().reverse(), highWaterOrdinal: r.highWaterOrdinal, hasMore: false, nextBeforeOrdinal: null },
      { ...input, query: { ...input.query, highWaterOrdinal: undefined } });
    const events = Object.freeze([...page.events].reverse());
    if (events.some(row => row.ordinal <= afterOrdinal || row.ordinal > Number(r.throughOrdinal)
      || input.query.highWaterOrdinal !== undefined && row.ordinal > input.query.highWaterOrdinal)
      || (r.hasMore ? !events.length || r.throughOrdinal !== events.at(-1)!.ordinal : r.throughOrdinal !== r.highWaterOrdinal)) throw new Error();
    return Object.freeze({ events, afterOrdinal, throughOrdinal: Number(r.throughOrdinal), highWaterOrdinal: Number(r.highWaterOrdinal), hasMore: r.hasMore });
  } catch { throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Logging change response is invalid.'); }
}
