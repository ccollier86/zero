import { describe, expect, test } from 'bun:test';

import { SubprocessDatabaseRequestRegistry } from './subprocess-database-request-registry';

describe('SubprocessDatabaseRequestRegistry', () => {
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
