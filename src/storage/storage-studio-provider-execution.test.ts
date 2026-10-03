import { describe, expect, test } from 'bun:test';
import { StorageStudioProviderExecution } from './storage-studio-provider-execution';
import type { StorageStudioJobRecord } from './storage-studio-job-store';

const JOB = Object.freeze({
  job_id: 'job_one',
  operation_id: 'operation_one',
  drive_id: 'drive_one',
  job_kind: 'restore',
  status: 'running',
  generation: 1,
  attempt_count: 1,
  max_attempts: 5,
  available_at: 0,
  lease_owner: 'worker',
  lease_expires_at: 1_000,
  failure_code: null,
  created_at: 0,
  updated_at: 0,
  completed_at: null,
} satisfies StorageStudioJobRecord);

describe('Storage Studio provider execution', () => {
  test('aborts immediately on lease loss and waits for cancellation acknowledgement', async () => {
    let aborted = false;
    const runner = new StorageStudioProviderExecution({
      renew: () => false,
      renewEveryMs: 5,
      timeoutMs: 100,
    });
    const outcome = await runner.run(JOB, (signal) => new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => {
        aborted = true;
        setTimeout(resolve, 5).unref?.();
      }, { once: true });
    }));
    expect(aborted).toBe(true);
    expect(outcome).toBe('lease-lost');
  });

  test('does not report stopped until a cooperative provider settles', async () => {
    const runner = new StorageStudioProviderExecution({
      renew: () => true,
      renewEveryMs: 5,
      timeoutMs: 100,
    });
    let acknowledge!: () => void;
    const entered = Promise.withResolvers<void>();
    const running = runner.run(JOB, (signal) => new Promise<void>((resolve) => {
      acknowledge = resolve;
      signal.addEventListener('abort', () => entered.resolve(), { once: true });
    }));
    runner.stop();
    await entered.promise;
    let settled = false;
    void running.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    acknowledge();
    expect(await running).toBe('stopping');
  });

  test('bounds a provider that ignores abort without calling it completed', async () => {
    const runner = new StorageStudioProviderExecution({
      renew: () => true,
      renewEveryMs: 5,
      timeoutMs: 10,
    });
    const outcome = await runner.run(JOB, () => new Promise<void>(() => {}));
    expect(outcome).toBe('timed-out');
  });
});
