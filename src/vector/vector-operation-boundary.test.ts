import { describe, expect, test } from 'bun:test';
import { VectorOperationBoundary } from './vector-operation-boundary';

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function microtasks() { for (let count = 0; count < 12; count++) await Promise.resolve(); }

describe('bounded vector operation admission', () => {
  test('one saturated index rejects safely without blocking a different index', async () => {
    const boundary = new VectorOperationBoundary(), gate = barrier();
    let admittedCalls = 0, rejectedCalls = 0;
    const writes = Array.from({ length: 128 }, () => boundary.write('docs', async () => {
      admittedCalls++; await gate.promise;
    }));
    const overflow = boundary.write('docs', async () => { rejectedCalls++; });
    await expect(overflow).rejects.toMatchObject({ code: 'VECTOR_BACKPRESSURE', metadata: { capacity: 'index' } });
    await boundary.write('other', async () => { admittedCalls++; });
    expect(admittedCalls).toBe(2);
    expect(rejectedCalls).toBe(0);
    gate.release(); await Promise.all(writes); await microtasks();
    expect(boundary.pendingIndexes).toBe(0);
    await boundary.write('docs', async () => { admittedCalls++; });
    expect(admittedCalls).toBe(130);
    await boundary.close();
  });

  test('service admission bounds concurrent reads and recovers capacity after settlement', async () => {
    const boundary = new VectorOperationBoundary(), gate = barrier();
    let rejectedCalls = 0;
    const reads = Array.from({ length: 1_024 }, () => boundary.read(async () => { await gate.promise; }));
    await expect(boundary.read(async () => { rejectedCalls++; }))
      .rejects.toMatchObject({ code: 'VECTOR_BACKPRESSURE', metadata: { capacity: 'service' } });
    await expect(boundary.write('other', async () => { rejectedCalls++; }))
      .rejects.toMatchObject({ code: 'VECTOR_BACKPRESSURE', metadata: { capacity: 'service' } });
    expect(rejectedCalls).toBe(0);
    expect(boundary.pendingIndexes).toBe(0);
    gate.release(); await Promise.all(reads);
    await boundary.read(async () => undefined);
    await boundary.write('other', async () => undefined);
    await microtasks(); expect(boundary.pendingIndexes).toBe(0);
    await boundary.close();
  });

  test('rejected work releases the index limit and does not strand later queued operations', async () => {
    const boundary = new VectorOperationBoundary(), gate = barrier();
    const first = boundary.write('docs', async () => { await gate.promise; throw new Error('synthetic'); });
    const failure = first.then(() => null, error => error);
    const following = Array.from({ length: 127 }, () => boundary.write('docs', async () => undefined));
    await expect(boundary.write('docs', async () => undefined)).rejects.toMatchObject({ code: 'VECTOR_BACKPRESSURE' });
    gate.release(); expect(await failure).toBeInstanceOf(Error);
    await boundary.write('docs', async () => undefined);
    await Promise.all(following); await microtasks(); expect(boundary.pendingIndexes).toBe(0);
    await boundary.close();
  });

  test('close drains all admitted work and rejects new work even after capacity clears', async () => {
    const boundary = new VectorOperationBoundary(), gate = barrier();
    const reads = Array.from({ length: 1_024 }, () => boundary.read(async () => { await gate.promise; }));
    let closed = false;
    const closing = boundary.close().then(() => { closed = true; });
    await microtasks(); expect(closed).toBe(false);
    await expect(boundary.read(async () => undefined)).rejects.toMatchObject({ code: 'VECTOR_OPERATION_FAILED' });
    gate.release(); await Promise.all(reads); await closing;
    expect(closed).toBe(true);
    await expect(boundary.write('docs', async () => undefined)).rejects.toMatchObject({ code: 'VECTOR_OPERATION_FAILED' });
  });
});
