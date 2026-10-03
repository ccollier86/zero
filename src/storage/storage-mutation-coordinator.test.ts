/** Forced overlap coverage for keyed Storage mutation serialization. */

import { describe, expect, test } from 'bun:test';

import { StorageMutationCoordinator } from './storage-mutation-coordinator';

describe('StorageMutationCoordinator', () => {
  test('serializes shared keys, permits independent keys, and advances after failure', async () => {
    const coordinator = new StorageMutationCoordinator();
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const events: string[] = [];

    const first = coordinator.run(['shared'], async () => {
      events.push('first-start');
      await firstGate;
      events.push('first-fail');
      throw new Error('forced');
    });
    const second = coordinator.run(['shared'], async () => {
      events.push('second');
      return 'second';
    });
    const independent = coordinator.run(['other'], async () => {
      events.push('independent');
      return 'independent';
    });

    expect(await independent).toBe('independent');
    expect(events).toEqual(['first-start', 'independent']);
    releaseFirst();
    await expect(first).rejects.toThrow('forced');
    expect(await second).toBe('second');
    expect(events).toEqual([
      'first-start',
      'independent',
      'first-fail',
      'second',
    ]);
  });
});
