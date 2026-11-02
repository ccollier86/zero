import { describe, expect, test } from 'bun:test';

import { SubprocessDatabaseRequestRegistry } from './subprocess-database-request-registry';

describe('SubprocessDatabaseRequestRegistry', () => {
  test('a one-shot SQL phase proof leaves response, deadline and drain pending', async () => {
    const registry = new SubprocessDatabaseRequestRegistry({ generation: 1, slot: 0, maxInFlight: 4,
      onOperationTimeout() { throw new Error('Unexpected deadline'); } });
    let phases = 0, resolved = false, drained = false;
    const write = registry.register('write', 1_000, () => { phases++; });
    void write.result.then(() => { resolved = true; });
    void registry.waitForDrain().then(() => { drained = true; });
    expect(registry.commitSettled(write.requestId)).toBe(true);
    expect(registry.commitSettled(write.requestId)).toBe(false);
    expect(phases).toBe(1);
    await Promise.resolve();
    expect(resolved).toBe(false); expect(drained).toBe(false); expect(registry.size).toBe(1);
    registry.resolve(write.requestId, 'durable');
    expect(await write.result).toBe('durable');
    expect(registry.commitSettled(write.requestId)).toBe(false);
    const read = registry.register('read', 1_000);
    expect(registry.commitSettled(read.requestId)).toBe(false);
    registry.resolve(read.requestId, null); await read.result;
  });

  test('a SQL phase proof does not turn a later timeout into success or invite replay', async () => {
    let expired = false, phases = 0;
    const registry = new SubprocessDatabaseRequestRegistry({ generation: 1, slot: 0, maxInFlight: 1,
      onOperationTimeout() { expired = true; } });
    const write = registry.register('write', 15, () => { phases++; });
    expect(registry.commitSettled(write.requestId)).toBe(true);
    await expect(write.result).rejects.toMatchObject({code:'DATABASE_OPERATION_TIMEOUT',outcome:'unknown',retryable:false});
    expect(expired).toBe(true); expect(phases).toBe(1);
    expect(registry.commitSettled(write.requestId)).toBe(false);
  });

  test('creates a fresh drain barrier for each in-flight cycle', async () => {
    const registry = new SubprocessDatabaseRequestRegistry({
      generation: 7,
      slot: 2,
      maxInFlight: 4,
      onOperationTimeout: () => {
        throw new Error('The test request deadline must not elapse.');
      },
    });

    const first = registry.register('read', 1_000);
    const firstDrain = registry.waitForDrain();
    expect(registry.resolve(first.requestId, 'first')).toBe(true);
    await firstDrain;
    expect(await first.result).toBe('first');

    const second = registry.register('write', 1_000);
    let secondDrainResolved = false;
    const secondDrain = registry.waitForDrain().then(() => {
      secondDrainResolved = true;
    });
    await Promise.resolve();
    expect(secondDrainResolved).toBe(false);

    expect(registry.resolve(second.requestId, 'second')).toBe(true);
    await secondDrain;
    expect(await second.result).toBe('second');
  });
});
