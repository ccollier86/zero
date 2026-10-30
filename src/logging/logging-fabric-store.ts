/** Private logging storage port over an already-bound Fabric client. No native handles or caller-selected paths. */
import type { AsyncDatabaseClient, DatabaseReadOptions, DatabaseSerializableValue } from '../databases/database-operations';
import { DatabaseError } from '../databases/database-error';
import type { LoggingChangePage, LoggingEvent, LoggingPage, LoggingQuery, LoggingReadScope, LoggingReceipt, LoggingStream } from './logging-contracts';
import { LoggingError } from './logging-error';
import { loggingDigest } from './logging-hash';
import { normalizeLoggingQuery } from './logging-query';
import { LOGGING_MAX_BATCH, LOGGING_MAX_BATCH_BYTES, loggingArray, loggingByteLength, loggingChoice, normalizeLoggingEvent } from './logging-validation';
import { readLoggingAppend, readLoggingChangePage, readLoggingPage } from './logging-results';
import { loggingRecord } from './logging-validation';
import type { LoggingCheckpoint, LoggingEvidenceCursor, LoggingEvidencePage, LoggingVerification } from './logging-evidence-contracts';
import { normalizeLoggingEvidenceCursor } from './logging-evidence-cursor';
import type { OwnedLoggingExportJob } from './logging-export-realm';
import { readOwnedLoggingExport } from './logging-export-validation';
import { loggingRealm } from './logging-realm';
import type { LoggingDeriveResultInput, LoggingResultManifest, LoggingResultReceipt, LoggingResultVersions } from './logging-result-contracts';
import { normalizeLoggingResultManifest, normalizeLoggingResultReceipt } from './logging-result-validation';

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
        { idempotencyKey: 'logging:realm:' + loggingDigest([loggingRealm.fingerprint, 'logging.append', events]) });
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

  private async resultCommand(command: 'logging.result.prepare' | 'logging.result.observe' | 'logging.result.derive', input: Record<string, unknown>): Promise<{ output: unknown; replayed: boolean }> {
    const captured = structuredClone(input);
    let result;
    try { result = await this.data.command(command, captured as DatabaseSerializableValue,
      { idempotencyKey: 'logging:realm:' + loggingDigest([loggingRealm.fingerprint, command, captured]) }); }
    catch (error) {
      if (error instanceof DatabaseError && error.code === 'DATABASE_PAYLOAD_INVALID' && error.outcome === 'not-committed')
        throw new LoggingError('LOGGING_EVENT_INVALID', 'Historical result admission is invalid or unavailable.', 'not-committed');
      const definite = error instanceof DatabaseError && error.outcome !== null && error.outcome !== 'unknown';
      throw new LoggingError(definite ? 'LOGGING_WRITE_FAILED' : 'LOGGING_OUTCOME_UNKNOWN', 'Read evidence acknowledgment could not be confirmed.', definite ? 'not-committed' : 'unknown');
    }
    const wrapper = loggingRecord(result.value, ['kind', 'name', 'output']);
    if (wrapper.kind !== 'command' || wrapper.name !== command || typeof result.replayed !== 'boolean') throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Result evidence acknowledgment is invalid.', 'unknown');
    return { output: wrapper.output, replayed: result.replayed };
  }
  async prepareResult(manifest: LoggingResultManifest, event: LoggingEvent): Promise<LoggingResultReceipt> {
    if (this.stream !== 'audit') throw new LoggingError('LOGGING_EVENT_INVALID', 'Read receipts belong to the audit stream.');
    return normalizeLoggingResultReceipt((await this.resultCommand('logging.result.prepare', { manifest, event, expiresAt: manifest.preparedAt + 300000 })).output);
  }
  async deriveResult(selection: LoggingDeriveResultInput, event: LoggingEvent): Promise<LoggingResultReceipt> {
    if (this.stream !== 'audit') throw new LoggingError('LOGGING_EVENT_INVALID', 'Read receipts belong to the audit stream.');
    return normalizeLoggingResultReceipt((await this.resultCommand('logging.result.derive', { selection, event })).output);
  }
  async observeResult(receiptId: string, event: LoggingEvent): Promise<LoggingReceipt> {
    const raw = await this.resultCommand('logging.result.observe', { receiptId, event });
    // The writer adds the historical target and binding metadata. Receipt identity remains the captured event identity.
    return readLoggingAppend({ kind: 'command', name: 'logging.append', output: raw.output }, [event], raw.replayed)[0]!;
  }
  async result(scope: LoggingReadScope, id: string): Promise<LoggingResultManifest | null> {
    const raw = (await this.data.query('logging.result', { scope, id } as DatabaseSerializableValue, { consistency: { mode: 'snapshot' } })).value;
    return raw === null ? null : normalizeLoggingResultManifest(raw);
  }
  async resultVersions(scope: LoggingReadScope, activityId: string, beforeOrdinal?: number, highWaterOrdinal?: number): Promise<LoggingResultVersions> {
    const raw = (await this.data.query('logging.result.versions', { scope, activityId, ...(beforeOrdinal === undefined ? {} : { beforeOrdinal }), ...(highWaterOrdinal === undefined ? {} : { highWaterOrdinal }) } as DatabaseSerializableValue,
      { consistency: { mode: 'snapshot' } })).value;
    const r = loggingRecord(raw, ['items', 'nextBeforeOrdinal']);
    let before = beforeOrdinal ?? Number.MAX_SAFE_INTEGER;
    const items = loggingArray(r.items, 20).map(raw => {
      const row = loggingRecord(raw, ['receipt', 'preparedAt', 'ordinal']), ordinal = Number(row.ordinal);
      if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal >= before || ordinal > (highWaterOrdinal ?? Number.MAX_SAFE_INTEGER)) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Historical result cursor is invalid.');
      if (!Number.isSafeInteger(row.preparedAt) || Number(row.preparedAt) < 0) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Historical result time is invalid.');
      before = ordinal; return { receipt: normalizeLoggingResultReceipt(row.receipt), preparedAt: Number(row.preparedAt), ordinal };
    });
    if (r.nextBeforeOrdinal !== null && (!items.length || r.nextBeforeOrdinal !== items.at(-1)!.ordinal)) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Historical result continuation is invalid.');
    return { items, nextBeforeOrdinal: r.nextBeforeOrdinal as number | null };
  }

  /** @internal Restartable actor-owned reconstruction before publishing a managed runtime. */
  async rebuildActivities(): Promise<void> {
    for (;;) {
      const progress = loggingRecord((await this.data.query('logging.activities.progress', {}, { consistency: { mode: 'strong' } })).value, ['cursor', 'head']);
      if (![progress.cursor, progress.head].every(value => Number.isSafeInteger(value) && Number(value) >= 0) || Number(progress.cursor) > Number(progress.head))
        throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Activity rebuild progress is invalid.');
      if (progress.cursor === progress.head) return;
      const key = 'logging:realm:' + loggingDigest([loggingRealm.fingerprint, 'logging.activities.rebuild', progress]);
      const result = await this.data.command('logging.activities.rebuild', {}, { idempotencyKey: key });
      const wrapper = loggingRecord(result.value, ['kind', 'name', 'output']), output = loggingRecord(wrapper.output, ['cursor', 'hasMore']);
      if (wrapper.name !== 'logging.activities.rebuild' || !Number.isSafeInteger(output.cursor) || Number(output.cursor) <= Number(progress.cursor) || typeof output.hasMore !== 'boolean')
        throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Activity rebuild did not advance.');
    }
  }

  async changes(scope: LoggingReadScope, query: LoggingQuery, afterOrdinal: number): Promise<LoggingChangePage> {
    if (!Number.isSafeInteger(afterOrdinal) || afterOrdinal < 0) throw new LoggingError('LOGGING_QUERY_INVALID', 'Logging change cursor is invalid.');
    const input = normalizeLoggingQuery(this.stream, scope, query);
    const result = await this.data.query('logging.changes', { ...input, afterOrdinal } as unknown as DatabaseSerializableValue, { consistency: { mode: 'snapshot' } });
    return readLoggingChangePage(result.value, input, afterOrdinal);
  }

  /** @internal Fixed private commands only; request routes never receive this capability. */
  async evidenceCommand(command: 'logging.hold' | 'logging.review' | 'logging.prune' | 'logging.export.reserve' | 'logging.export.transition', input: Record<string, unknown>): Promise<unknown> {
    const captured = structuredClone(input);
    const result = await this.data.command(command, captured as DatabaseSerializableValue, { idempotencyKey: 'logging:realm:' + loggingDigest([loggingRealm.fingerprint, command, captured]) });
    const wrapped = loggingRecord(result.value, ['kind', 'name', 'output']);
    if (wrapped.kind !== 'command' || wrapped.name !== command) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Invalid evidence acknowledgment.', 'unknown');
    return wrapped.output;
  }
  async exportJob(scope: LoggingReadScope, id: string): Promise<OwnedLoggingExportJob | null> {
    const result = (await this.data.query('logging.export', { scope, id } as DatabaseSerializableValue, { consistency: { mode: 'strong' } })).value;
    return result === null ? null : readOwnedLoggingExport(result);
  }
  async pendingExports(): Promise<readonly OwnedLoggingExportJob[]> {
    const result = (await this.data.query('logging.exports.pending', {}, { consistency: { mode: 'strong' } })).value;
    if (!Array.isArray(result) || result.length > 128) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Invalid pending export page.');
    return result.map(readOwnedLoggingExport);
  }
  async evidence(scope: LoggingReadScope, before?: number | LoggingEvidenceCursor): Promise<LoggingEvidencePage> {
    before = normalizeLoggingEvidenceCursor(before);
    const value = (await this.data.query('logging.evidence', { scope, ...(before === undefined ? {} : { before }) } as DatabaseSerializableValue, { consistency: { mode: 'strong' } })).value;
    const r = loggingRecord(value, ['holds', 'reviews', 'hasMoreHolds', 'hasMoreReviews', 'nextReviewBefore', 'nextCursor']);
    if (!Array.isArray(r.holds) || !Array.isArray(r.reviews) || r.holds.length > 100 || r.reviews.length > 100 || typeof r.hasMoreHolds !== 'boolean' || typeof r.hasMoreReviews !== 'boolean') throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Invalid evidence page.');
    if (r.nextCursor !== null) normalizeLoggingEvidenceCursor(r.nextCursor);
    if (Boolean(r.hasMoreHolds || r.hasMoreReviews) !== (r.nextCursor !== null)) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Invalid evidence continuation.');
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
  async cleanupActivities(): Promise<void> {
    for (let batch = 0; batch < 8; batch++) {
      const raw = (await this.data.query('logging.activities.cleanup.pending', {}, { consistency: { mode: 'strong' } })).value;
      if (raw === null) return;
      const job = loggingRecord(raw, ['id', 'generation']);
      if (typeof job.id !== 'string' || !/^[a-f0-9]{64}$/.test(job.id) || !Number.isSafeInteger(job.generation)) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Activity cleanup progress is invalid.');
      await this.data.command('logging.activities.cleanup', job as DatabaseSerializableValue, { idempotencyKey: 'logging:realm:' + loggingDigest([loggingRealm.fingerprint, 'logging.activities.cleanup', job]) });
    }
  }
}
