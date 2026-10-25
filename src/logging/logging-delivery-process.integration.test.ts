/** Real standalone processes with synthetic source/sink capabilities. Verifies process isolation and commit-before-ack under forced death. */
import { expect, test } from 'bun:test';
import { LoggingDeliveryProcess } from './logging-delivery-process';
import { resolveManagedLoggingConfig, type ResolvedManagedLoggingConfig } from './logging-managed-config';
import { loggingEvent } from './test-support/logging-fixture';
import { deliveryIdentity } from './logging-delivery-protocol';
import { loggingByteLength } from './logging-validation';
import { LoggingError } from './logging-error';

function config() { return resolveManagedLoggingConfig({ preset: 'activity' }, '/tmp') as ResolvedManagedLoggingConfig; }
async function until(condition: () => boolean) { const deadline = Date.now() + 15000; while (!condition() && Date.now() < deadline) await Bun.sleep(10); expect(condition()).toBe(true); }

test('a standalone delivery process survives SIGKILL after sink commit and reconciles source evidence without duplicate rows', async () => {
  const options = config(), committed = new Map<string, number>();
  const event = loggingEvent('worker-death'), pending = new Map([[event.id, event]]);
  let release!: () => void, entered!: () => void, first = true;
  const gate = new Promise<void>(resolve => { release = resolve; }), committing = new Promise<void>(resolve => { entered = resolve; });
  const worker = await LoggingDeliveryProcess.open(options.createExecutor, options.policy.queue, async (_stream, events) => {
    const receipts = events.map(event => { const key = deliveryIdentity(event), duplicate = committed.has(key); if (!duplicate) committed.set(key, committed.size + 1); return { id: event.id, sourceId: event.sourceId, ordinal: committed.get(key)!, duplicate }; });
    if (first) { first = false; entered(); await gate; }
    return { receipts, sequence: { seq: committed.size } };
  });
  let acknowledgments = 0;
  const source = worker.registerSource({
    page(ids) {
      for (const id of ids) { const item = pending.get(id); expect(item).toBeDefined(); expect(committed.has(deliveryIdentity(item!))).toBe(true); pending.delete(id); acknowledgments++; }
      return { rows: [...pending].map(([id, event]) => ({ id, event })), queued: pending.size, bytes: pending.size * loggingByteLength(event) };
    }, failed() {},
  });
  try {
    const initial = worker.workerDiagnostics(); expect(initial.pid).not.toBe(process.pid); expect(initial.state).toBe('ready');
    await committing;
    await until(() => worker.diagnostics('audit').pendingEvents === 1);
    process.kill(initial.pid!, 'SIGKILL'); release();
    await until(() => worker.workerDiagnostics().generation > initial.generation && worker.workerDiagnostics().state === 'ready');
    await source.flush();
    expect(committed.size).toBe(1); expect(acknowledgments).toBe(1); expect(pending.size).toBe(0);
    expect(worker.diagnostics('audit').duplicates).toBeGreaterThan(0);
    expect(worker.workerDiagnostics().failures).toBeGreaterThan(0);
    expect(worker.diagnostics('audit').pendingEvents).toBe(0);
  } finally { release(); await source.close(); await worker.close(); }
}, 45000);

test('bounded source batches drain independently while direct intake has explicit backpressure', async () => {
  const options = config(), pending = new Map(Array.from({ length: 2000 }, (_, i) => { const event = loggingEvent('burst-' + i); return [event.id, event] as const; }));
  const sizes: number[] = [], committed = new Set<string>();
  const worker = await LoggingDeliveryProcess.open(options.createExecutor, options.policy.queue, async (_stream, events) => {
    sizes.push(events.length);
    return { receipts: events.map(event => { const key = deliveryIdentity(event), duplicate = committed.has(key); committed.add(key); return { id: event.id, sourceId: event.sourceId, ordinal: committed.size, duplicate }; }), sequence: { seq: committed.size } };
  });
  const source = worker.registerSource({ page(ids) {
    for (const id of ids) { expect(committed.has(deliveryIdentity(pending.get(id)!))).toBe(true); pending.delete(id); }
    return { rows: [...pending].slice(0, 128).map(([id, event]) => ({ id, event })), queued: pending.size, bytes: pending.size * 1000 };
  }, failed() {} });
  try {
    await source.flush(); expect(pending.size).toBe(0); expect(committed.size).toBe(2000);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(256); expect(sizes.some(size => size > 1)).toBe(true);
    expect(source.diagnostics()).toMatchObject({ failed: 0, pending: false, active: false });
  } finally { await source.close(); await worker.close(); }
  const small = { ...options.policy.queue, maxEvents: 1, batchSize: 1 };
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), inSink = new Promise<void>(resolve => { entered = resolve; });
  const bounded = await LoggingDeliveryProcess.open(options.createExecutor, small, async (_stream, events) => {
    entered(); await gate; return { receipts: events.map(event => ({ id: event.id, sourceId: event.sourceId, ordinal: 1, duplicate: false })), sequence: { seq: 1 } };
  });
  try {
    const first = bounded.write(loggingEvent('first')); await inSink;
    await expect(bounded.write(loggingEvent('second'))).rejects.toBeInstanceOf(LoggingError);
    expect(bounded.diagnostics('audit').pendingEvents).toBe(1); release(); await first;
    expect(bounded.diagnostics('audit').pendingEvents).toBe(0);
  } finally { release(); await bounded.close(); }
}, 45000);

test('an adversarial worker cannot manufacture sink admissions or acknowledge an uncommitted source entry', async () => {
  const options = resolveManagedLoggingConfig({ preset: 'activity', actors: { launch: { kind: 'source', entrypoint: new URL('./test-support/logging-delivery-probe.fixture.ts', import.meta.url) }, env: {} } }, '/tmp') as ResolvedManagedLoggingConfig;
  let reads = 0, acknowledgments = 0, writes = 0;
  const worker = await LoggingDeliveryProcess.open(options.createExecutor, options.policy.queue, async () => { writes++; throw new Error('Manufactured write reached the sink'); });
  const event = loggingEvent('uncommitted');
  const source = worker.registerSource({ page(ids) { reads++; acknowledgments += ids.length; return { rows: [{ id: event.id, event }], queued: 1, bytes: 1000 }; }, failed() {} });
  try {
    await source.flush(); expect(reads).toBe(1); expect(writes).toBe(0); expect(acknowledgments).toBe(0);
  } finally { await source.close(); await worker.close(); }
}, 30000);
