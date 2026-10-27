/** Deterministic FIFO async-context ownership, not wall-clock performance or a real app/provider workload. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { expect, test } from 'bun:test';
import { DatabaseWriterLane } from './database-writer-lane';
import { createDatabaseRef } from './database-file';
test('each queued writer operation keeps its submitting context, and background work never borrows a retired request', async () => {
  const local = new AsyncLocalStorage<{ id: string; active: boolean }>();
  const lane = new DatabaseWriterLane({ databaseRef: createDatabaseRef('context-owner'), placement: 'file', maxQueued: 8, now: () => performance.now(), onQueued: () => true, onDequeued() {}, observability: null });
  let release!: () => void; const held = new Promise<void>(done => { release = done; });
  const a = { id: 'first', active: true }, b = { id: 'second', active: true };
  const read = () => { const value = local.getStore(); if (value && !value.active) throw new Error('A retired request was inherited.'); return value?.id ?? null; };
  const first = local.run(a, () => lane.enqueue(async () => { await held; const id = read(); a.active = false; return id; }, { timeoutMs: 5000, operationClass: 'mutation' }));
  const second = local.run(b, () => lane.enqueue(async () => { const id = read(); b.active = false; return id; }, { timeoutMs: 5000, operationClass: 'mutation' }));
  const background = lane.enqueue(async () => read(), { timeoutMs: 5000, operationClass: 'query' });
  release();
  expect(await Promise.allSettled([first, second, background])).toEqual([
    { status: 'fulfilled', value: 'first' }, { status: 'fulfilled', value: 'second' }, { status: 'fulfilled', value: null },
  ]);
  await lane.idle(); expect(lane.depth).toBe(0);
});
