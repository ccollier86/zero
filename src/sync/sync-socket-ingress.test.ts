import { describe, expect, test } from 'bun:test';

import {
  SYNC_INGRESS_MAX_PENDING_BYTES,
  SYNC_INGRESS_MAX_PENDING_MESSAGES,
  SyncSocketIngressQueue,
  syncIngressEncodedBytes,
} from './sync-socket-ingress';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('Sync socket ingress queue', () => {
  test('serializes concurrent handlers in arrival order', async () => {
    const queue = new SyncSocketIngressQueue();
    const gate = deferred();
    const events: string[] = [];
    const first = queue.admit(10, async () => {
      events.push('first:start');
      await gate.promise;
      events.push('first:end');
    });
    const second = queue.admit(10, () => { events.push('second'); });
    expect(first.accepted && second.accepted).toBe(true);
    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    gate.resolve();
    if (first.accepted) await first.completion;
    if (second.accepted) await second.completion;
    expect(events).toEqual(['first:start', 'first:end', 'second']);
    expect(queue.pendingMessages).toBe(0);
    expect(queue.pendingBytes).toBe(0);
  });

  test('fails closed at the pending-message budget and fences queued work', async () => {
    const queue = new SyncSocketIngressQueue();
    const gate = deferred();
    let ran = 0;
    const admitted = Array.from(
      { length: SYNC_INGRESS_MAX_PENDING_MESSAGES },
      (_, index) => queue.admit(1, async (fence) => {
        if (index === 0) await gate.promise;
        if (fence.active) ran += 1;
      }),
    );
    await Promise.resolve();

    expect(queue.admit(1, () => { ran += 1; })).toEqual({
      accepted: false,
      reason: 'capacity',
    });
    expect(queue.active).toBe(false);
    gate.resolve();
    await Promise.all(admitted.map((item) => (
      item.accepted ? item.completion : Promise.resolve()
    )));
    expect(ran).toBe(0);
  });

  test('fails closed at the aggregate encoded-byte budget', () => {
    const queue = new SyncSocketIngressQueue();
    const admitted = queue.admit(
      SYNC_INGRESS_MAX_PENDING_BYTES,
      async () => new Promise<void>(() => {}),
    );
    expect(admitted.accepted).toBe(true);
    expect(queue.admit(1, () => undefined)).toEqual({
      accepted: false,
      reason: 'capacity',
    });
  });

  test('measures decoded JSON, strings, and binary views without throwing', () => {
    expect(syncIngressEncodedBytes('abc')).toBe(3);
    expect(syncIngressEncodedBytes({ value: '£' })).toBe(
      new TextEncoder().encode(JSON.stringify({ value: '£' })).byteLength,
    );
    expect(syncIngressEncodedBytes(new Uint8Array(7))).toBe(7);
    expect(syncIngressEncodedBytes({ value: 1n })).toBeNull();
  });
});
