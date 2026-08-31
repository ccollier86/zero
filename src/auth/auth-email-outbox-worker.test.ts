import { expect, test } from 'bun:test';
import { resolveAuthEmailOutboxOptions } from './auth-email-outbox-options';
import { AuthEmailOutboxWorker } from './auth-email-outbox-worker';

test('idle outbox cleanup is startup plus cadence, not every poll', async () => {
  let now = 100_000;
  const cleanupCalls: number[] = [];
  const store = {
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
