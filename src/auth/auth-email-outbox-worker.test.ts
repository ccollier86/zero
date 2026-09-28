import { expect, test } from 'bun:test';
import { resolveAuthEmailOutboxOptions } from './auth-email-outbox-options';
import { AuthEmailOutboxWorker } from './auth-email-outbox-worker';
import { AuthError } from './types';

test('idle outbox cleanup is startup plus cadence, not every poll', async () => {
  let now = 100_000;
  const cleanupCalls: number[] = [];
  const store = {
    assertCurrentProfile() {},
    recoverExpired: () => 0,
    cleanup: (before: number) => { cleanupCalls.push(before); return 0; },
    claim: () => null,
  };
  const processor = { async process() {} };
  const options = resolveAuthEmailOutboxOptions({
    terminalRetentionMs: 86_400_000,
  });
  const worker = new AuthEmailOutboxWorker(store, processor, options, () => now);
  worker.start(false);
  expect(cleanupCalls).toHaveLength(1);

  for (let index = 0; index < 10; index += 1) {
    now += 1_000;
    await worker.processDue();
  }
  expect(cleanupCalls).toHaveLength(1);

  now += 3_600_000;
  await worker.processDue();
  expect(cleanupCalls).toHaveLength(2);
  await worker.stop();
});

test('a stale auth profile quiesces the worker until it is explicitly restarted', async () => {
  let current = true;
  let recoverCalls = 0;
  let claimCalls = 0;
  const store = {
    assertCurrentProfile() {
      if (!current) {
        throw new AuthError('Profile changed', 'AUTH_PROFILE_CHANGED', 503);
      }
    },
    recoverExpired() {
      recoverCalls += 1;
      return 0;
    },
    cleanup: () => 0,
    claim() {
      claimCalls += 1;
      return null;
    },
  };
  const worker = new AuthEmailOutboxWorker(
    store,
    { async process() {} },
    resolveAuthEmailOutboxOptions({}),
    () => 100,
  );

  worker.start(false);
  expect(recoverCalls).toBe(1);
  current = false;
  await expect(worker.processDue()).rejects.toMatchObject({
    code: 'AUTH_PROFILE_CHANGED',
  });
  expect(claimCalls).toBe(0);

  // A profile failure moves the poller to its stopped state. A deliberate
  // restart is required even if the test guard later reports current again.
  current = true;
  worker.start(false);
  expect(recoverCalls).toBe(2);
  await worker.stop();
});
