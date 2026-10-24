/** Lifecycle-owned bounded batching over Fabric actors. Acknowledgments resolve only after durable store admission. */
import type { LoggingEvent, LoggingReceipt } from './logging-contracts';
import type { LoggingBatchWriter } from './logging-fabric-store';
import type { ResolvedLoggingConfig } from './logging-config';
import { LoggingError } from './logging-error';
import { LOGGING_MAX_BATCH_BYTES, loggingByteLength, loggingRecord, normalizeLoggingEvent } from './logging-validation';

interface Pending {
  event: LoggingEvent;
  bytes: number;
  resolve(receipt: LoggingReceipt): void;
  reject(error: unknown): void;
  promise: Promise<LoggingReceipt>;
}

/** One worker per stream; Fabric owns the actual database subprocess and its execution deadlines. */
export class LoggingWriter {
  private state: 'open' | 'draining' | 'closed' = 'open';
  private readonly queue: Pending[] = [];
  private readonly pending = new Set<Pending>();
  private bytes = 0;
  private running = false;
  private stopTask: Promise<void> | null = null;
  private acknowledged = 0;
  private duplicates = 0;
  private failed = 0;
  private readonly limits: ResolvedLoggingConfig['queue'];

  constructor(private readonly store: LoggingBatchWriter, limits: ResolvedLoggingConfig['queue']) {
    loggingRecord(limits, ['maxEvents', 'maxBytes', 'batchSize'], 'LOGGING_CONFIG_INVALID');
    if (!Number.isSafeInteger(limits.maxEvents) || limits.maxEvents < 1 || limits.maxEvents > 100000
      || !Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 16384 || limits.maxBytes > 64 * 1024 * 1024
      || !Number.isSafeInteger(limits.batchSize) || limits.batchSize < 1 || limits.batchSize > Math.min(100, limits.maxEvents)) throw new LoggingError('LOGGING_CONFIG_INVALID', 'Logging writer limits are invalid.');
    this.limits = Object.freeze({ ...limits });
  }

  /** Never use this promise as a same-transaction mutation audit until source-outbox capture is installed. */
  write(input: LoggingEvent): Promise<LoggingReceipt> {
    try {
      if (this.state !== 'open') throw new LoggingError('LOGGING_CLOSED', 'Logging intake is closed.');
      const event = normalizeLoggingEvent(input), bytes = loggingByteLength(event);
      if (event.stream !== this.store.stream) throw new LoggingError('LOGGING_EVENT_INVALID', 'Logging event belongs to another stream.');
      if (this.pending.size >= this.limits.maxEvents || this.bytes + bytes > this.limits.maxBytes) throw new LoggingError('LOGGING_BACKPRESSURE', 'Logging admission capacity is exhausted.');
      let resolve!: Pending['resolve'], reject!: Pending['reject'];
      const promise = new Promise<LoggingReceipt>((yes, no) => { resolve = yes; reject = no; });
      const item = { event, bytes, resolve, reject, promise };
      this.pending.add(item); this.queue.push(item); this.bytes += bytes;
      if (!this.running) { this.running = true; queueMicrotask(() => { void this.drain(); }); }
      return promise;
    } catch (error) { return Promise.reject(error); }
  }

  /** Wait for the currently admitted events; later admissions belong to a later flush boundary. */
  async flush(): Promise<void> { await this.joinPending(); }

  /** Stop new admission and await owned work before the caller closes Fabric. Repeated calls join the same task. */
  stop(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.state = 'draining';
    this.stopTask = this.joinPending().finally(() => { this.state = 'closed'; });
    return this.stopTask;
  }

  diagnostics() { return Object.freeze({ state: this.state, pendingEvents: this.pending.size, pendingBytes: this.bytes, acknowledged: this.acknowledged, duplicates: this.duplicates, failed: this.failed }); }

  private async joinPending(): Promise<void> {
    const results = await Promise.allSettled([...this.pending].map(item => item.promise));
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }

  private async drain(): Promise<void> {
    try {
      while (this.queue.length) {
        const batch: Pending[] = []; let bytes = 2;
        while (this.queue.length && batch.length < this.limits.batchSize && bytes + this.queue[0]!.bytes + 1 <= LOGGING_MAX_BATCH_BYTES) {
          const item = this.queue.shift()!; batch.push(item); bytes += item.bytes + 1;
        }
        try {
          const result = await this.store.append(batch.map(item => item.event));
          if (result.receipts.length !== batch.length || result.receipts.some((r, i) => r.id !== batch[i]!.event.id || r.sourceId !== batch[i]!.event.sourceId)) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Logging acknowledgment is incomplete.', 'unknown');
          batch.forEach((item, i) => { this.acknowledged++; if (result.receipts[i]!.duplicate) this.duplicates++; this.release(item); item.resolve(result.receipts[i]!); });
        } catch (error) {
          const safe = error instanceof LoggingError ? error : new LoggingError('LOGGING_OUTCOME_UNKNOWN', 'Logging delivery is unresolved; retain the same event identity.', 'unknown');
          batch.forEach(item => { this.failed++; this.release(item); item.reject(safe); });
        }
      }
    } finally { this.running = false; }
  }
  private release(item: Pending): void { this.pending.delete(item); this.bytes -= item.bytes; }
}
