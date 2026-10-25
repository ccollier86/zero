/** Subprocess-owned fair source scheduling and bounded batching. Consumes private broker ports, never application SQLite or auth. */
import type { LoggingEvent, LoggingReceipt, LoggingStream } from './logging-contracts';
import type { ResolvedLoggingConfig } from './logging-config';
import type { LoggingAppendResult } from './logging-fabric-store';
import { LoggingWriter } from './logging-writer';
import { LoggingError } from './logging-error';
import { readDeliveryPage, LOGGING_DELIVERY_MAX_SOURCES, type DeliverySourceState } from './logging-delivery-protocol';
import { loggingByteLength } from './logging-validation';

interface Source { queued: number; bytes: number; failed: number; pending: boolean; active: boolean; closing: boolean; attempts: number; retryAt: number }
export interface DeliverySchedulerBroker {
  page(id: string, acknowledgments: readonly string[]): Promise<unknown>;
  append(stream: LoggingStream, events: readonly LoggingEvent[]): Promise<LoggingAppendResult>;
  sourceState(id: string, state: DeliverySourceState): void;
  sourceFailed(id: string): void;
  pending?(state: Readonly<Record<LoggingStream, Readonly<{ count: number; bytes: number }>>>): void;
}

/** All timers, retries, source fairness and event batching live in this process. */
export class LoggingDeliveryScheduler {
  private readonly writers: Record<LoggingStream, LoggingWriter>;
  private readonly sources = new Map<string, Source>();
  private readonly pending = new Set<string>();
  private task: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = Infinity;
  private stopping = false;
  private readonly sourcePending = { audit: { count: 0, bytes: 0 }, operational: { count: 0, bytes: 0 } };
  private pendingQueued = false;

  constructor(queue: ResolvedLoggingConfig['queue'], private readonly broker: DeliverySchedulerBroker, private readonly now: () => number = () => performance.now()) {
    this.writers = Object.fromEntries((['audit', 'operational'] as const).map(stream =>
      [stream, new LoggingWriter({ stream, append: events => broker.append(stream, events) }, queue)])) as Record<LoggingStream, LoggingWriter>;
  }
  write(event: LoggingEvent, source = false): Promise<LoggingReceipt> {
    if (this.stopping) return Promise.reject(new LoggingError('LOGGING_CLOSED', 'Delivery worker is draining.'));
    const result = this.writers[event.stream].write(event);
    if (source) {
      const pending = this.sourcePending[event.stream], bytes = loggingByteLength(event); pending.count++; pending.bytes += bytes; this.publishPending();
      const settled = () => { pending.count--; pending.bytes -= bytes; this.publishPending(); };
      void result.then(settled, settled);
    }
    return result;
  }
  add(ids: readonly string[]): void {
    if (this.stopping) throw new LoggingError('LOGGING_CLOSED', 'Delivery worker is draining.');
    if (this.sources.size + ids.filter(id => !this.sources.has(id)).length > LOGGING_DELIVERY_MAX_SOURCES) throw new LoggingError('LOGGING_BACKPRESSURE', 'Delivery source capacity exceeded.');
    for (const id of ids) {
      if (!this.sources.has(id)) this.sources.set(id, { queued: 0, bytes: 0, failed: 0, pending: true, active: false, closing: false, attempts: 0, retryAt: 0 });
      this.wake(id);
    }
  }
  wake(id: string): void {
    const source = this.sources.get(id); if (!source || source.closing || this.stopping) return;
    this.pending.add(id); this.publish(id, source); this.schedule();
  }
  diagnostics() { return Object.freeze({ audit: this.writers.audit.diagnostics(), operational: this.writers.operational.diagnostics() }); }
  async flush(ids?: readonly string[], closing = false): Promise<void> {
    const wanted = ids ? new Set(ids) : null;
    const deadline = closing ? this.now() + 5000 : Infinity;
    await this.task;
    for (let pass = 0; pass < 80 && this.now() < deadline && [...this.pending].some(id => !wanted || wanted.has(id)); pass++) {
      const failures = [...this.sources.values()].reduce((n, s) => n + s.failed, 0);
      await this.drain(true, wanted);
      if ([...this.sources.values()].reduce((n, s) => n + s.failed, 0) !== failures) break;
    }
    if (!ids) await Promise.all([this.writers.audit.flush(), this.writers.operational.flush()]);
  }
  async remove(ids: readonly string[]): Promise<void> {
    for (const id of ids) { const source = this.sources.get(id); if (source) source.closing = true; }
    await this.flush(ids, true);
    for (const id of ids) { this.pending.delete(id); this.sources.delete(id); }
  }
  async stop(): Promise<void> {
    this.stopping = true; if (this.timer) clearTimeout(this.timer); this.timer = null;
    await this.task;
    const results = await Promise.allSettled([this.writers.audit.stop(), this.writers.operational.stop()]);
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failures.length) throw new LoggingError('LOGGING_OUTCOME_UNKNOWN', 'Delivery worker stopped with unresolved admissions.', 'unknown');
  }
  private publish(id: string, source: Source): void {
    this.broker.sourceState(id, Object.freeze({ queued: source.queued, bytes: source.bytes, failed: source.failed, pending: source.active || this.pending.has(id), active: source.active }));
  }
  private async deliver(id: string, source: Source): Promise<void> {
    let page = readDeliveryPage(await this.broker.page(id, []));
    const remember = () => { source.queued = page.queued; source.bytes = page.bytes; this.publish(id, source); };
    remember();
    for (let batch = 0; batch < 4 && page.rows.length && (!source.closing || batch === 0); batch++) {
      const results = await Promise.allSettled(page.rows.map(row => this.write(row.event, true)));
      const ids = page.rows.filter((_, i) => results[i]!.status === 'fulfilled').map(row => row.id);
      if (ids.length) { page = readDeliveryPage(await this.broker.page(id, ids)); remember(); }
      const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected'); if (rejected) throw rejected.reason;
    }
    if (page.queued) this.pending.add(id);
  }
  private drain(force = false, wanted: Set<string> | null = null): Promise<void> {
    if (this.task) return this.task;
    this.task = (async () => {
      const ids = [...this.pending].filter(id => (!wanted || wanted.has(id)) && (force || this.sources.get(id)!.retryAt <= this.now())).slice(0, 3);
      for (const id of ids) { this.pending.delete(id); const source = this.sources.get(id)!; source.active = true; this.publish(id, source); }
      const result = await Promise.allSettled(ids.map(id => this.deliver(id, this.sources.get(id)!)));
      ids.forEach((id, i) => {
        const source = this.sources.get(id)!; source.active = false;
        if (result[i]!.status === 'fulfilled') { source.attempts = 0; source.retryAt = 0; }
        else {
          source.failed++; source.attempts++; source.retryAt = this.now() + Math.min(30000, 1000 * 2 ** Math.min(5, source.attempts - 1)); this.pending.add(id);
          if (source.attempts === 1) this.broker.sourceFailed(id);
        }
        this.publish(id, source);
      });
    })().finally(() => { this.task = null; this.schedule(); });
    return this.task;
  }
  private schedule(): void {
    if (this.stopping || !this.pending.size) return;
    let at = Infinity; for (const id of this.pending) at = Math.min(at, this.sources.get(id)!.retryAt);
    at = Math.max(this.now(), at); if (this.timer && this.timerAt <= at) return;
    if (this.timer) clearTimeout(this.timer);
    this.timerAt = at; this.timer = setTimeout(() => { this.timer = null; this.timerAt = Infinity; if (!this.stopping) void this.drain(); }, Math.max(0, at - this.now()));
    this.timer.unref?.();
  }
  private publishPending(): void {
    if (this.pendingQueued) return; this.pendingQueued = true;
    queueMicrotask(() => { this.pendingQueued = false; this.broker.pending?.({ audit: { ...this.sourcePending.audit }, operational: { ...this.sourcePending.operational } }); });
  }
}
