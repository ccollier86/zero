/** Deterministic shutdown deadline check: an in-flight source may finish one page, not begin a fresh four-page pass. */
import { expect, test } from 'bun:test';
import { LoggingDeliveryScheduler } from './logging-delivery-scheduler';
import { loggingEvent } from './test-support/logging-fixture';
import { resolveLoggingConfig } from './logging-config';

for (const batchSize of [undefined, 1, 64, 256]) test(`closing finishes only its admitted page across ${batchSize ?? 'default'}-event batches and preserves the rest after its deadline`, async () => {
  let now = 0, appendCalls = 0, release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), inSink = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Map(Array.from({ length: 500 }, (_, i) => { const event = loggingEvent('close-' + i); return [event.id, event] as const; }));
  const firstPageIds = [...pending.keys()].slice(0, 100), retained: string[] = [], acknowledged: string[] = [];
  const queue = resolveLoggingConfig({ queue: batchSize === undefined ? {} : { batchSize } }).queue;
  const scheduler = new LoggingDeliveryScheduler(queue, {
    async page(_id, acknowledge) { acknowledged.push(...acknowledge); acknowledge.forEach(id => pending.delete(id)); return { rows: [...pending].slice(0, 100).map(([id, event]) => ({ id, event })), queued: pending.size, bytes: pending.size * 1000 }; },
    async append(_stream, events) {
      expect(events.length).toBeLessThanOrEqual(queue.batchSize);
      appendCalls++; entered(); await gate; now = 6000;
      const previous = retained.length; retained.push(...events.map(event => event.id));
      return { receipts: events.map((event, i) => ({ id: event.id, sourceId: event.sourceId, ordinal: previous + i + 1, duplicate: false })), sequence: { seq: retained.length } };
    }, sourceState() {}, sourceFailed() {},
  }, () => now);
  try {
    scheduler.add(['source']); await inSink;
    const closing = scheduler.remove(['source']); release(); await closing;
    // A source page is an acknowledgment unit, not necessarily one private
    // writer batch. Finish every admitted row before stopping at the same
    // deadline; do not start any of the remaining four source pages.
    expect(appendCalls).toBe(Math.ceil(100 / queue.batchSize));
    expect(retained).toEqual(firstPageIds); expect(acknowledged).toEqual(firstPageIds);
    expect(pending.size).toBe(400); expect([...pending.keys()]).toEqual(Array.from({ length: 400 }, (_, i) => 'close-' + (i + 100)));
  } finally { release(); await scheduler.stop(); }
});
