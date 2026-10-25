/** Private logging storage port over an already-bound Fabric client. No native handles or caller-selected paths. */
import type { AsyncDatabaseClient, DatabaseReadOptions, DatabaseSerializableValue } from '../databases/database-operations';
import { DatabaseError } from '../databases/database-error';
import type { LoggingEvent, LoggingPage, LoggingQuery, LoggingReadScope, LoggingReceipt, LoggingStream } from './logging-contracts';
import { LoggingError } from './logging-error';
import { loggingDigest } from './logging-hash';
import { normalizeLoggingQuery } from './logging-query';
import { LOGGING_MAX_BATCH, LOGGING_MAX_BATCH_BYTES, loggingArray, loggingByteLength, loggingChoice, normalizeLoggingEvent } from './logging-validation';
import { readLoggingAppend, readLoggingPage } from './logging-results';
import { loggingRecord } from './logging-validation';
import type { LoggingCheckpoint, LoggingEvidencePage, LoggingVerification } from './logging-evidence-contracts';

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
    const result = await this.data.query('logging.page', input as unknown as DatabaseSerializableValue, { consistency: { mode: 'snapshot' }, ...options });
    return readLoggingPage(result.value, input);
  }

  /** @internal Fixed private commands only; request routes never receive this capability. */
  async evidenceCommand(command: 'logging.hold' | 'logging.review' | 'logging.prune', input: Record<string, unknown>): Promise<unknown> {
    const captured = structuredClone(input);
    const result = await this.data.command(command, captured as DatabaseSerializableValue, { idempotencyKey: command + ':' + loggingDigest(captured) });
    const wrapped = loggingRecord(result.value, ['kind', 'name', 'output']);
    if (wrapped.kind !== 'command' || wrapped.name !== command) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Invalid evidence acknowledgment.', 'unknown');
    return wrapped.output;
  }
  async evidence(scope: LoggingReadScope, before?: number): Promise<LoggingEvidencePage> {
    const value = (await this.data.query('logging.evidence', { scope, ...(before === undefined ? {} : { before }) } as DatabaseSerializableValue, { consistency: { mode: 'strong' } })).value;
    const r = loggingRecord(value, ['holds', 'reviews', 'hasMoreHolds', 'hasMoreReviews', 'nextReviewBefore']);
    if (!Array.isArray(r.holds) || !Array.isArray(r.reviews) || r.holds.length > 100 || r.reviews.length > 100 || typeof r.hasMoreHolds !== 'boolean' || typeof r.hasMoreReviews !== 'boolean') throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Invalid evidence page.');
    return Object.freeze(value as unknown as LoggingEvidencePage);
  }
  async verify(afterOrdinal = 0, checkpoint?: LoggingCheckpoint): Promise<LoggingVerification> {
    const result = (await this.data.query('logging.verify', { stream: this.stream, afterOrdinal, ...(checkpoint ? { checkpoint } : {}) } as unknown as DatabaseSerializableValue, { consistency: { mode: 'strong' } })).value;
    const r = loggingRecord(result, ['checked', 'expired', 'throughOrdinal', 'hasMore', 'checkpoint']);
    const cp = loggingRecord(r.checkpoint, ['version', 'stream', 'ordinal', 'hash']);
    if (!Number.isSafeInteger(r.checked) || Number(r.checked) < 0 || Number(r.checked) > 100 || !Number.isSafeInteger(r.expired) || Number(r.expired) < 0 || Number(r.expired) > Number(r.checked)
      || !Number.isSafeInteger(r.throughOrdinal) || Number(r.throughOrdinal) < afterOrdinal || typeof r.hasMore !== 'boolean' || cp.version !== 1 || cp.stream !== this.stream
      || !Number.isSafeInteger(cp.ordinal) || Number(cp.ordinal) < Number(r.throughOrdinal) || typeof cp.hash !== 'string' || !/^[a-f0-9]{64}$/.test(cp.hash)) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Invalid logging verification response.');
    return Object.freeze(result as unknown as LoggingVerification);
  }
  async prune(before: number): Promise<number> {
    const ids = (await this.data.query('logging.prune-candidates', { before }, { consistency: { mode: 'strong' } })).value;
    if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Invalid retention candidate response.');
    if (!ids.length) return 0;
    const result = loggingRecord(await this.evidenceCommand('logging.prune', { before, ids }), ['removed']);
    if (!Number.isSafeInteger(result.removed) || Number(result.removed) < 0 || Number(result.removed) > ids.length) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Invalid retention acknowledgment.', 'unknown');
    return Number(result.removed);
  }
}
