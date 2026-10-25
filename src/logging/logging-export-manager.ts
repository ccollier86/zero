/** Bounded, restartable private export materialization. Private Fabric transitions and Storage publication stay separate. */
import type { LoggingRuntime } from './logging-runtime';
import type { OwnedLoggingExportJob } from './logging-export-realm';
import type { LoggingExportJob } from './logging-export-contracts';
import type { StoragePrivateObjects } from '../storage/storage-private-objects';
import { captureLoggingEvent, loggingByteLength, loggingCanonical } from './logging-validation';
import { LoggingError } from './logging-error';

export const LOGGING_EXPORT_NAMESPACE = 'zero.logging.exports';
const MAX_ACTIVE = 4, MAX_BYTES = 8 * 1024 * 1024;

export class LoggingExportManager {
  private readonly active = new Map<string, Promise<LoggingExportJob>>();
  private scan: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopping = false;
  private failures = 0;
  constructor(private readonly runtime: LoggingRuntime, readonly storage: StoragePrivateObjects) {}

  start(): void {
    if (this.timer || this.stopping) return;
    this.timer = setInterval(() => { void this.reconcile().catch(() => { this.failures++; }); }, 30000);
    this.timer.unref?.(); void this.reconcile().catch(() => { this.failures++; });
  }
  materialize(owned: OwnedLoggingExportJob): Promise<LoggingExportJob> {
    const previous = this.active.get(owned.job.id); if (previous) return previous;
    if (this.stopping || this.active.size >= MAX_ACTIVE) return Promise.resolve(owned.job);
    const task = this.perform(owned).finally(() => { this.active.delete(owned.job.id); });
    this.active.set(owned.job.id, task); return task;
  }
  reconcile(): Promise<void> {
    if (this.scan) return this.scan;
    if (this.stopping) return Promise.resolve();
    this.scan = (async () => {
      const jobs = await this.runtime.pendingExports();
      if (this.stopping) return;
      let next = 0;
      // A bounded work pool visits every reserved identity once per sweep.
      // Failure of an early artifact must not starve the rest of the live set.
      const work = async () => {
        while (!this.stopping && next < jobs.length) {
          const job = jobs[next++]!;
          while (this.active.size >= MAX_ACTIVE && !this.active.has(job.job.id)) {
            await Promise.race(this.active.values()).catch(() => {});
            if (this.stopping) return;
          }
          try { await this.materialize(job); } catch { /* Durable identity remains for the next sweep. */ }
        }
      };
      await Promise.all(Array.from({ length: Math.min(MAX_ACTIVE, jobs.length) }, work));
    })().finally(() => { this.scan = null; });
    return this.scan;
  }
  diagnostics() { return Object.freeze({ state: this.stopping ? 'stopping' : 'ready', active: this.active.size, failures: this.failures }); }
  async close(): Promise<void> {
    this.stopping = true; if (this.timer) clearInterval(this.timer);
    // A pending export stays durable for recovery. A late provider continuation
    // is fenced before it can issue another Fabric operation after shutdown.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([Promise.allSettled([...this.active.values(), ...(this.scan ? [this.scan] : [])]), new Promise<void>(resolve => { timer = setTimeout(resolve, 5000); })]); }
    finally { clearTimeout(timer); }
  }

  private event(owned: OwnedLoggingExportJob, action: string, metadata: Record<string, string | number | boolean> = {}) {
    const request = owned.request;
    return captureLoggingEvent({ sourceId: 'logging.export:' + owned.job.id, origin: 'system', scope: request.scope,
      requestId: request.requestId, correlationId: request.correlationId, policyVersion: request.policyVersion,
      actor: { kind: 'system', id: 'zero.logging.exports', sessionId: null, initiatorId: request.actor.id } }, {
      id: owned.job.id + ':' + action, family: 'investigations', action, occurredAt: Date.now(), outcome: action.endsWith('.failed') ? 'failed' : 'succeeded',
      evidence: 'server-confirmed', target: { type: 'logging.export', id: owned.job.id }, metadata,
    }, Object.keys(metadata));
  }
  private assertRunning(): void { if (this.stopping) throw new LoggingError('LOGGING_CLOSED', 'Export work is stopping; its durable request is retained.'); }

  private async perform(owned: OwnedLoggingExportJob): Promise<LoggingExportJob> {
    const job = owned.job;
    if (job.expiresAt <= Date.now()) {
      // Retire authorization first. Deletion failure leaves an explicit cleanup
      // receipt, not a usable download or a falsely successful removal.
      if (job.state !== 'expired') await this.runtime.evidenceCommand('logging.export.transition', {
        id: job.id, state: 'expired', auditEvent: this.event(owned, 'logging.export.expired'),
      });
      this.assertRunning(); await this.storage.delete(LOGGING_EXPORT_NAMESPACE, job.id);
      this.assertRunning();
      const done = await this.runtime.evidenceCommand('logging.export.transition', { id: job.id, state: 'expired', artifactRemoved: true,
        auditEvent: this.event(owned, 'logging.export.artifact.removed') });
      return (done as OwnedLoggingExportJob).job;
    }
    if (job.state !== 'pending') return job;
    try {
      const lines: string[] = []; let bytes = 0, before = owned.query.beforeOrdinal, complete = false;
      for (let i = 0; i < 10; i++) {
        this.assertRunning();
        const page = await this.runtime.page(job.stream, owned.scope, { ...owned.query, limit: 100, highWaterOrdinal: job.highWaterOrdinal, ...(before === undefined ? {} : { beforeOrdinal: before }) });
        this.assertRunning();
        for (const item of page.events) {
          const line = loggingCanonical(item); bytes += loggingByteLength(line) + 1;
          if (bytes > MAX_BYTES) throw new LoggingError('LOGGING_BACKPRESSURE', 'Export segment exceeds its byte budget; narrow the query.');
          lines.push(line);
        }
        before = page.nextBeforeOrdinal ?? undefined;
        if (!page.hasMore) { complete = true; break; }
      }
      const ndjson = lines.length ? lines.join('\n') + '\n' : '';
      const manifest = { version: 1, exportId: job.id, stream: job.stream, highWaterOrdinal: job.highWaterOrdinal, count: lines.length,
        complete, nextBeforeOrdinal: complete ? null : before ?? null, eventSha256: new Bun.CryptoHasher('sha256').update(ndjson).digest('hex') };
      const artifact = new TextEncoder().encode(JSON.stringify({ manifest }) + '\n' + ndjson);
      this.assertRunning();
      await this.storage.put(LOGGING_EXPORT_NAMESPACE, job.id, artifact, 'application/x-ndjson', () => {
        this.assertRunning(); if (job.expiresAt <= Date.now()) throw new LoggingError('LOGGING_FORBIDDEN', 'Export expired during materialization.');
      });
      this.assertRunning();
      const sha256 = new Bun.CryptoHasher('sha256').update(artifact).digest('hex');
      const result = await this.runtime.evidenceCommand('logging.export.transition', { id: job.id, state: 'ready', count: manifest.count,
        complete, nextBeforeOrdinal: manifest.nextBeforeOrdinal, sha256,
        auditEvent: this.event(owned, 'logging.export.artifact.ready', { count: manifest.count, highWaterOrdinal: job.highWaterOrdinal, complete, sha256 }) });
      return (result as OwnedLoggingExportJob).job;
    } catch (error) {
      if (!this.stopping) {
        this.failures++;
        // A provider/IPC failure can leave an already-published artifact. The
        // durable pending identity is retained and retried idempotently rather
        // than blindly starting a differently identified export.
      }
      throw error;
    }
  }
}
