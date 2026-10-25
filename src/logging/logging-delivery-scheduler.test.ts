/** Deterministic shutdown deadline check: an in-flight source may finish one page, not begin a fresh four-page pass. */
import { expect, test } from 'bun:test';
import { LoggingDeliveryScheduler } from './logging-delivery-scheduler';
import { loggingEvent } from './test-support/logging-fixture';
import { resolveLoggingConfig } from './logging-config';

test('closing changes an active source to single-page draining and preserves the rest after its deadline', async () => {
  let now = 0, appendCalls = 0, release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), inSink = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Map(Array.from({ length: 500 }, (_, i) => { const event = loggingEvent('close-' + i); return [event.id, event] as const; }));
  const scheduler = new LoggingDeliveryScheduler(resolveLoggingConfig({}).queue, {
    async page(_id, acknowledge) { acknowledge.forEach(id => pending.delete(id)); return { rows: [...pending].slice(0, 100).map(([id, event]) => ({ id, event })), queued: pending.size, bytes: pending.size * 1000 }; },
    async append(_stream, events) {
      appendCalls++; entered(); await gate; now = 6000;
      return { receipts: events.map((event, i) => ({ id: event.id, sourceId: event.sourceId, ordinal: i + 1, duplicate: false })), sequence: { seq: events.length } };
    }, sourceState() {}, sourceFailed() {},
  }, () => now);
  try {
    scheduler.add(['source']); await inSink;
    const closing = scheduler.remove(['source']); release(); await closing;
    expect(appendCalls).toBe(1); expect(pending.size).toBe(400);
  } finally { release(); await scheduler.stop(); }
});
