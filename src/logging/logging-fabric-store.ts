/** Private logging storage port over an already-bound Fabric client. No native handles or caller-selected paths. */
import type { AsyncDatabaseClient, DatabaseReadOptions, DatabaseSerializableValue } from '../databases/database-operations';
import { DatabaseError } from '../databases/database-error';
import type { LoggingEvent, LoggingPage, LoggingQuery, LoggingReadScope, LoggingReceipt, LoggingStream } from './logging-contracts';
import { LoggingError } from './logging-error';
import { loggingDigest } from './logging-hash';
import { normalizeLoggingQuery } from './logging-query';
import { LOGGING_MAX_BATCH, LOGGING_MAX_BATCH_BYTES, loggingArray, loggingByteLength, loggingChoice, normalizeLoggingEvent } from './logging-validation';
import { readLoggingAppend, readLoggingPage } from './logging-results';

export interface LoggingAppendResult { readonly receipts: readonly LoggingReceipt[]; readonly sequence: Readonly<{ seq: number }> }
export interface LoggingBatchWriter {
  readonly stream: LoggingStream;
  append(events: readonly LoggingEvent[]): Promise<LoggingAppendResult>;
}

/** Owned server integration only. A later request facade supplies live authority and safe projections. */
export class LoggingFabricStore implements LoggingBatchWriter {
  constructor(private readonly data: AsyncDatabaseClient, readonly stream: LoggingStream) { loggingChoice(stream, ['operational', 'audit']); }

  async append(input: readonly LoggingEvent[]): Promise<LoggingAppendResult> {
    const events = loggingArray(input, LOGGING_MAX_BATCH).map(normalizeLoggingEvent);
    if (!events.length) throw new LoggingError('LOGGING_EVENT_INVALID', 'Logging batch size is invalid.');
    if (loggingByteLength(events) > LOGGING_MAX_BATCH_BYTES) throw new LoggingError('LOGGING_EVENT_INVALID', 'Logging batch exceeds its byte budget.');
    if (events.some(event => event.stream !== this.stream)) throw new LoggingError('LOGGING_EVENT_INVALID', 'Logging event belongs to another stream.');
    try {
      const result = await this.data.command('logging.append', { stream: this.stream, events } as unknown as DatabaseSerializableValue,
        { idempotencyKey: 'logging:append:' + loggingDigest(events) });
      if (typeof result.replayed !== 'boolean' || !Number.isSafeInteger(result.sequence?.seq) || result.sequence.seq < 0) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Logging append acknowledgment is invalid.', 'unknown');
      const receipts = readLoggingAppend(result.value, events, result.replayed);
      return Object.freeze({ receipts: Object.freeze(receipts), sequence: Object.freeze({ seq: result.sequence.seq }) });
    } catch (error) {
      if (error instanceof LoggingError) throw error;
      const definite = error instanceof DatabaseError && error.outcome !== null && error.outcome !== 'unknown';
      throw new LoggingError(definite ? 'LOGGING_WRITE_FAILED' : 'LOGGING_OUTCOME_UNKNOWN',
        definite ? 'Logging write did not commit.' : 'Logging write acknowledgment is unresolved; retry the same event identity.', definite ? 'not-committed' : 'unknown');
    }
  }

  async page(scope: LoggingReadScope, query: LoggingQuery = {}, options: DatabaseReadOptions = {}): Promise<LoggingPage> {
    const input = normalizeLoggingQuery(this.stream, scope, query);
    const result = await this.data.query('logging.page', input as unknown as DatabaseSerializableValue, { consistency: { mode: 'strong' }, ...options });
    return readLoggingPage(result.value, input);
  }
}
