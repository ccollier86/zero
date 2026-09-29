import { describe, expect, test } from 'bun:test';

import {
  nextDatabaseRestartPlan,
  normalizeDatabaseCoordinatorRestartPolicy,
  waitForDatabaseRestart,
} from './database-restart-policy';

describe('database restart policy', () => {
  test('applies bounded exponential delays and opens the circuit at the threshold', () => {
    const policy = normalizeDatabaseCoordinatorRestartPolicy({
      initialDelayMs: 5,
      maxDelayMs: 20,
      circuitFailureThreshold: 5,
      circuitCooldownMs: 80,
    });

    const plans = [];
    let retryCount = 0;
    for (let index = 0; index < 7; index += 1) {
      const plan = nextDatabaseRestartPlan(policy, retryCount);
      plans.push(plan);
      retryCount = plan.retryCount;
    }

    expect(plans.map(({ retryCount: count, delayMs, circuitOpen }) => ({
      retryCount: count,
      delayMs,
      circuitOpen,
    }))).toEqual([
      { retryCount: 1, delayMs: 5, circuitOpen: false },
      { retryCount: 2, delayMs: 10, circuitOpen: false },
      { retryCount: 3, delayMs: 20, circuitOpen: false },
      { retryCount: 4, delayMs: 20, circuitOpen: false },
      { retryCount: 5, delayMs: 80, circuitOpen: true },
      { retryCount: 6, delayMs: 80, circuitOpen: true },
      { retryCount: 7, delayMs: 80, circuitOpen: true },
    ]);
  });

  test('rejects unknown, unsafe, and internally inconsistent policy values', () => {
    for (const value of [
      null,
      [],
      { typo: 1 },
      { initialDelayMs: 0 },
      { initialDelayMs: 20, maxDelayMs: 10 },
      { circuitFailureThreshold: 1 },
      { maxDelayMs: 100, circuitCooldownMs: 50 },
    ]) {
      expect(() => normalizeDatabaseCoordinatorRestartPolicy(value as never))
        .toThrow('Database restart policy is invalid.');
    }
  });

  test('cancels a pending delay without dispatching the attempt', async () => {
    const controller = new AbortController();
    const waiting = waitForDatabaseRestart(60_000, controller.signal);
    controller.abort();
    await expect(waiting).resolves.toBe(false);
  });
});
