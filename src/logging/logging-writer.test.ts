import { expect, test } from 'bun:test';
import { LoggingWriter } from './logging-writer';
import { resolveLoggingConfig } from './logging-config';
import type { LoggingBatchWriter, LoggingAppendResult } from './logging-fabric-store';
import type { LoggingEvent } from './logging-contracts';
import { loggingEvent } from './test-support/logging-fixture';
import { LoggingError } from './logging-error';

function receipt(events: readonly LoggingEvent[]): LoggingAppendResult {
  return { sequence: { seq: 1 }, receipts: events.map((event, i) => ({ id: event.id, sourceId: event.sourceId, ordinal: i + 1, duplicate: false })) };
}
test('writer batches admissions and never resolves their acknowledgment before the Fabric store commits', async () => {
  let release!: () => void, called!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { called = resolve; });
  const batches: string[][] = [];
  const store: LoggingBatchWriter = { stream: 'audit', async append(events) { batches.push(events.map(event => event.id)); called(); await gate; return receipt(events); } };
  const writer = new LoggingWriter(store, resolveLoggingConfig({ queue: { batchSize: 2 } }).queue);
  let settled = false;
  const one = writer.write(loggingEvent('one')).then(value => { settled = true; return value; });
  const two = writer.write(loggingEvent('two')), three = writer.write(loggingEvent('three'));
  await entered; expect(settled).toBe(false); expect(writer.diagnostics().pendingEvents).toBe(3);
  release(); await Promise.all([one, two, three]); await writer.stop();
  expect(batches).toEqual([['one', 'two'], ['three']]); expect(writer.diagnostics()).toMatchObject({ state: 'closed', pendingEvents: 0, pendingBytes: 0, acknowledged: 3, failed: 0 });
});
test('in-flight records count against queue capacity and intake closes before draining', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const store: LoggingBatchWriter = { stream: 'audit', async append(events) { await gate; return receipt(events); } };
  const writer = new LoggingWriter(store, resolveLoggingConfig({ queue: { maxEvents: 1 } }).queue);
  const first = writer.write(loggingEvent('one'));
  await expect(writer.write(loggingEvent('two'))).rejects.toMatchObject({ code: 'LOGGING_BACKPRESSURE', outcome: 'not-admitted' });
  const stopping = writer.stop(); expect(writer.stop()).toBe(stopping);
  await expect(writer.write(loggingEvent('three'))).rejects.toMatchObject({ code: 'LOGGING_CLOSED' });
  release(); await first; await stopping;
});
test('ambiguous append failures remain unknown and stop reports failed admitted work', async () => {
  const store: LoggingBatchWriter = { stream: 'audit', async append() { throw new Error('Synthetic private database failure'); } };
  const writer = new LoggingWriter(store, resolveLoggingConfig(true).queue);
  const pending = writer.write(loggingEvent()); const stopped = writer.stop();
  const results = await Promise.allSettled([pending, stopped]);
  expect(results).toHaveLength(2);
  expect(results.every(result => result.status === 'rejected' && result.reason.code === 'LOGGING_OUTCOME_UNKNOWN')).toBe(true);
  expect(writer.diagnostics()).toMatchObject({ failed: 1, acknowledged: 0, pendingEvents: 0, state: 'closed' });
});
test('definite conflicts retain their noncommitted outcome and do not poison subsequent admissions', async () => {
  let fail = true;
  const store: LoggingBatchWriter = { stream: 'audit', async append(events) { if (fail) throw new LoggingError('LOGGING_EVENT_CONFLICT', 'Conflict', 'not-committed'); return receipt(events); } };
  const writer = new LoggingWriter(store, resolveLoggingConfig(true).queue);
  await expect(writer.write(loggingEvent())).rejects.toMatchObject({ outcome: 'not-committed' });
  fail = false; await expect(writer.write(loggingEvent('next'))).resolves.toMatchObject({ id: 'next' }); await writer.stop();
});

test('flush joins every admitted batch before reporting an earlier batch failure', async () => {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const second = new Promise<void>(resolve => { entered = resolve; });
  const store: LoggingBatchWriter = { stream: 'audit', async append(events) {
    if (events[0]!.id === 'failed') throw new LoggingError('LOGGING_EVENT_CONFLICT', 'Conflict', 'not-committed');
    entered(); await gate; return receipt(events);
  } };
  const writer = new LoggingWriter(store, resolveLoggingConfig({ queue: { batchSize: 1 } }).queue);
  const admissions = Promise.allSettled([writer.write(loggingEvent('failed')), writer.write(loggingEvent('delayed'))]);
  let flushed = false;
  const flushing = writer.flush().then(() => { flushed = true; return null; }, error => { flushed = true; return error; });
  await second; expect(flushed).toBe(false);
  release(); await admissions;
  expect(await flushing).toMatchObject({ code: 'LOGGING_EVENT_CONFLICT', outcome: 'not-committed' });
  expect(writer.diagnostics()).toMatchObject({ pendingEvents: 0, failed: 1, acknowledged: 1 });
  await writer.stop();
});
