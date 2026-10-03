import { describe, expect, test } from 'bun:test';
import type { PlatformCodeDefinition } from '../observability/types';
import {
  StorageStudioMaintenanceWorker,
  type StorageMaintenanceTimer,
} from './storage-studio-maintenance-worker';

describe('Storage Studio maintenance worker', () => {
  test('rolls back startup when observability or timer registration fails', async () => {
    const emitterTimer = new ManualTimer();
    const emitterFailure = new StorageStudioMaintenanceWorker({
      runNextCleanupJob: async () => 'idle',
      nextCleanupJobAt: () => null,
      retryBlobCleanup: async () => ({ attempted: 0, remaining: 0 }),
      pruneExpiredOperations: () => 0,
      timer: emitterTimer,
      emitCode: () => { throw new Error('forced startup emitter failure'); },
    });

    expect(() => emitterFailure.start()).toThrow('forced startup emitter failure');
    expect(emitterTimer.pending()).toBe(0);
    await emitterFailure.processDue();

    const timerFailure = new StorageStudioMaintenanceWorker({
      runNextCleanupJob: async () => 'idle',
      nextCleanupJobAt: () => null,
      retryBlobCleanup: async () => ({ attempted: 0, remaining: 0 }),
      pruneExpiredOperations: () => 0,
      timer: {
        schedule: () => { throw new Error('forced timer failure'); },
        cancel: () => undefined,
      },
    });

    expect(() => timerFailure.start()).toThrow('forced timer failure');
    await timerFailure.processDue();
  });

  test('starts idempotently, runs startup recovery, and schedules the exact job deadline', async () => {
    let now = 100;
    let cleanupCalls = 0;
    let blobCalls = 0;
    const timer = new ManualTimer();
    const codes: string[] = [];
    const worker = new StorageStudioMaintenanceWorker({
      runNextCleanupJob: async () => {
        cleanupCalls += 1;
        return 'idle';
      },
      nextCleanupJobAt: () => 600,
      retryBlobCleanup: async () => {
        blobCalls += 1;
        return { attempted: 0, remaining: 0 };
      },
      pruneExpiredOperations: () => 0,
      now: () => now,
      timer,
      emitCode: (definition) => { codes.push(definition.code); },
    });

    worker.start(false);
    worker.start(false);
    await worker.processDue();
    expect(cleanupCalls).toBe(1);
    expect(blobCalls).toBe(1);
    expect(timer.nextDelay()).toBe(500);
    expect(codes.filter((code) => code === 'storage.maintenance.started')).toHaveLength(1);

    now = 200;
    worker.wake();
    expect(timer.nextDelay()).toBe(0);
    await worker.stop();
  });

  test('bounds due jobs, yields before backlog continuation, and keeps retry progress', async () => {
    const outcomes = ['retrying', 'succeeded', 'succeeded', 'idle'] as const;
    const timer = new ManualTimer();
    let calls = 0;
    const worker = new StorageStudioMaintenanceWorker({
      runNextCleanupJob: async () => outcomes[calls++] ?? 'idle',
      nextCleanupJobAt: () => null,
      retryBlobCleanup: async () => ({ attempted: 0, remaining: 0 }),
      pruneExpiredOperations: () => 0,
      timer,
      maxCleanupJobsPerPass: 2,
    });

    worker.start(false);
    await worker.processDue();
    expect(calls).toBe(2);
    expect(timer.nextDelay()).toBe(0);
    await timer.runNext();
    expect(calls).toBe(4);
    await worker.stop();
  });

  test('wake during a running pass is not lost and stop joins active work', async () => {
    let release!: () => void;
    let entered!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const timer = new ManualTimer();
    const worker = new StorageStudioMaintenanceWorker({
      runNextCleanupJob: async () => {
        entered();
        await barrier;
        return 'idle';
      },
      nextCleanupJobAt: () => null,
      retryBlobCleanup: async () => ({ attempted: 0, remaining: 0 }),
      pruneExpiredOperations: () => 0,
      timer,
    });

    worker.start(false);
    const pass = worker.processDue();
    await started;
    worker.wake();
    const stopping = worker.stop();
    let stopped = false;
    void stopping.then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await Promise.all([pass, stopping]);
    expect(timer.pending()).toBe(0);
  });

  test('paces orphan-blob backlog and isolates maintenance phase failures', async () => {
    let now = 1_000;
    let blobPass = 0;
    let cleanupCalls = 0;
    const timer = new ManualTimer();
    const failures: string[] = [];
    const worker = new StorageStudioMaintenanceWorker({
      runNextCleanupJob: async () => {
        cleanupCalls += 1;
        return 'idle';
      },
      nextCleanupJobAt: () => null,
      retryBlobCleanup: async () => {
        blobPass += 1;
        if (blobPass === 1) return { attempted: 32, remaining: 40 };
        if (blobPass === 2) throw new Error('forced blob failure');
        return { attempted: 0, remaining: 0 };
      },
      pruneExpiredOperations: () => 0,
      now: () => now,
      timer,
      blobCadenceMs: 30_000,
      backlogDelayMs: 1_000,
      emitCode: (definition: PlatformCodeDefinition, options) => {
        if (definition.code === 'storage.maintenance.failed') {
          failures.push(String(options?.metadata?.stage));
        }
      },
    });

    worker.start(false);
    await worker.processDue();
    expect(timer.nextDelay()).toBe(1_000);
    now += 1_000;
    await timer.runNext();
    expect(failures).toEqual(['blob_cleanup']);
    expect(cleanupCalls).toBe(2);
    expect(timer.nextDelay()).toBe(30_000);
    await worker.stop();
  });

  test('prunes operation receipts before detached terminal jobs and continues bounded backlog', async () => {
    const timer = new ManualTimer();
    const order: string[] = [];
    let operationPass = 0;
    let jobPass = 0;
    const worker = new StorageStudioMaintenanceWorker({
      runNextCleanupJob: async () => 'idle',
      nextCleanupJobAt: () => null,
      retryBlobCleanup: async () => ({ attempted: 0, remaining: 0 }),
      pruneExpiredOperations: () => {
        order.push('operations');
        operationPass += 1;
        return operationPass === 1 ? 100 : 0;
      },
      pruneTerminalJobs: () => {
        order.push('jobs');
        jobPass += 1;
        return jobPass === 1 ? 100 : 0;
      },
      timer,
    });

    worker.start(false);
    await worker.processDue();
    expect(order).toEqual(['operations', 'jobs']);
    expect(timer.nextDelay()).toBe(0);
    await timer.runNext();
    expect(order).toEqual(['operations', 'jobs', 'operations', 'jobs']);
    await worker.stop();
  });
});

class ManualTimer implements StorageMaintenanceTimer {
  private entries: Array<{
    callback: () => void;
    delay: number;
    cancelled: boolean;
  }> = [];

  schedule(callback: () => void, delayMs: number): unknown {
    const entry = { callback, delay: delayMs, cancelled: false };
    this.entries.push(entry);
    return entry;
  }

  cancel(handle: unknown): void {
    (handle as { cancelled: boolean }).cancelled = true;
  }

  nextDelay(): number | null {
    return this.entries.find((entry) => !entry.cancelled)?.delay ?? null;
  }

  pending(): number {
    return this.entries.filter((entry) => !entry.cancelled).length;
  }

  async runNext(): Promise<void> {
    const entry = this.entries.find((candidate) => !candidate.cancelled);
    if (!entry) throw new Error('No maintenance timer is scheduled.');
    entry.cancelled = true;
    entry.callback();
    await Promise.resolve();
    await Promise.resolve();
  }
}
