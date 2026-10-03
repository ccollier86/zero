/** Managed scheduling for durable Studio jobs, orphan blobs, and receipts. */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type {
  PlatformCodeDefinition,
  PlatformCodeEmitOptions,
} from '../observability/types';
import type { StorageBlobCleanupPass } from './storage-blob-lifecycle';
import type { StorageStudioCleanupRunResult } from './storage-studio-cleanup-coordinator';

type CodeEmitter = (
  definition: PlatformCodeDefinition,
  options?: PlatformCodeEmitOptions,
) => unknown;

export interface StorageMaintenanceTimer {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface StorageStudioMaintenanceOptions {
  readonly runNextCleanupJob: () => Promise<StorageStudioCleanupRunResult>;
  readonly nextCleanupJobAt: () => number | null;
  readonly retryBlobCleanup: () => Promise<StorageBlobCleanupPass>;
  readonly pruneExpiredOperations: () => number;
  readonly pruneTerminalJobs?: () => number;
  readonly now?: () => number;
  readonly timer?: StorageMaintenanceTimer;
  readonly emitCode?: CodeEmitter;
  readonly blobCadenceMs?: number;
  readonly backlogDelayMs?: number;
  readonly maxCleanupJobsPerPass?: number;
}

const DEFAULT_BLOB_CADENCE_MS = 30_000;
const DEFAULT_BACKLOG_DELAY_MS = 1_000;
const DEFAULT_JOB_BATCH = 32;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** One bounded, wakeable maintenance loop owned by the Storage plugin. */
export class StorageStudioMaintenanceWorker {
  private readonly now: () => number;
  private readonly timer: StorageMaintenanceTimer;
  private readonly emitCode: CodeEmitter;
  private readonly blobCadenceMs: number;
  private readonly backlogDelayMs: number;
  private readonly maxCleanupJobsPerPass: number;
  private stopped = true;
  private timerHandle: unknown | null = null;
  private running: Promise<void> | null = null;
  private immediateAfterRun = false;
  private nextBlobAt = 0;

  constructor(private readonly options: StorageStudioMaintenanceOptions) {
    this.now = options.now ?? Date.now;
    this.timer = options.timer ?? nativeStorageMaintenanceTimer;
    this.emitCode = options.emitCode ?? emitPlatformCode;
    this.blobCadenceMs = positiveDuration(
      options.blobCadenceMs,
      DEFAULT_BLOB_CADENCE_MS,
      'blob cadence',
    );
    this.backlogDelayMs = positiveDuration(
      options.backlogDelayMs,
      DEFAULT_BACKLOG_DELAY_MS,
      'backlog delay',
    );
    this.maxCleanupJobsPerPass = positiveInteger(
      options.maxCleanupJobsPerPass,
      DEFAULT_JOB_BATCH,
      1_000,
      'cleanup job batch',
    );
  }

  start(automatic = true): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.nextBlobAt = this.now();
    try {
      this.emitCode(OBS_CODES.STORAGE_MAINTENANCE_STARTED);
      if (automatic) this.schedule(0);
    } catch (error) {
      this.stopped = true;
      this.clearTimer();
      throw error;
    }
  }

  wake(): void {
    if (this.stopped) return;
    if (this.running) {
      this.immediateAfterRun = true;
      return;
    }
    this.schedule(0);
  }

  async processDue(): Promise<void> {
    if (this.stopped) return;
    if (this.running) {
      this.immediateAfterRun = true;
      return this.running;
    }
    this.clearTimer();
    const run = this.runBoundedPass();
    this.running = run;
    try {
      await run;
    } finally {
      if (this.running === run) this.running = null;
      if (!this.stopped) this.scheduleNext();
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTimer();
    if (this.running) {
      await this.running.catch((error) => this.emitFailure('shutdown_join', error));
    }
    this.emitCode(OBS_CODES.STORAGE_MAINTENANCE_STOPPED);
  }

  private async runBoundedPass(): Promise<void> {
    this.immediateAfterRun = false;
    let processedJobs = 0;
    try {
      while (!this.stopped && processedJobs < this.maxCleanupJobsPerPass) {
        const result = await this.options.runNextCleanupJob();
        if (result === 'idle') break;
        processedJobs += 1;
      }
      if (processedJobs === this.maxCleanupJobsPerPass) this.immediateAfterRun = true;
    } catch (error) {
      this.emitFailure('cleanup_jobs', error);
    }

    const now = this.now();
    if (!this.stopped && now >= this.nextBlobAt) {
      try {
        const result = await this.options.retryBlobCleanup();
        this.nextBlobAt = now + (
          result.attempted > 0 && result.remaining > 0
            ? this.backlogDelayMs
            : this.blobCadenceMs
        );
      } catch (error) {
        this.nextBlobAt = now + this.blobCadenceMs;
        this.emitFailure('blob_cleanup', error);
      }
    }

    if (!this.stopped) {
      try {
        const pruned = this.options.pruneExpiredOperations();
        const prunedJobs = this.options.pruneTerminalJobs?.() ?? 0;
        const totalPruned = pruned + prunedJobs;
        if (totalPruned > 0) {
          this.emitCode(OBS_CODES.STORAGE_MAINTENANCE_PRUNED, {
            metadata: { count: totalPruned, operationCount: pruned, jobCount: prunedJobs },
          });
          if (pruned >= 100 || prunedJobs >= 100) this.immediateAfterRun = true;
        }
      } catch (error) {
        this.emitFailure('operation_prune', error);
      }
    }
  }

  private scheduleNext(): void {
    if (this.immediateAfterRun) {
      this.schedule(0);
      return;
    }
    const now = this.now();
    const jobAt = this.options.nextCleanupJobAt();
    const nextAt = jobAt === null ? this.nextBlobAt : Math.min(jobAt, this.nextBlobAt);
    this.schedule(Math.min(Math.max(0, nextAt - now), MAX_TIMER_DELAY_MS));
  }

  private schedule(delayMs: number): void {
    this.clearTimer();
    this.timerHandle = this.timer.schedule(() => {
      this.timerHandle = null;
      void this.processDue().catch((error) => this.emitFailure('scheduled_pass', error));
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timerHandle !== null) this.timer.cancel(this.timerHandle);
    this.timerHandle = null;
  }

  private emitFailure(stage: string, error: unknown): void {
    this.emitCode(OBS_CODES.STORAGE_MAINTENANCE_FAILED, {
      error,
      metadata: { stage },
    });
  }
}

export const nativeStorageMaintenanceTimer: StorageMaintenanceTimer = Object.freeze({
  schedule(callback: () => void, delayMs: number) {
    const handle = setTimeout(callback, delayMs);
    handle.unref?.();
    return handle;
  },
  cancel(handle: unknown) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
});

function positiveDuration(value: number | undefined, fallback: number, label: string): number {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new TypeError(`Storage maintenance ${label} is invalid.`);
  }
  return normalized;
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > maximum) {
    throw new TypeError(`Storage maintenance ${label} is invalid.`);
  }
  return normalized;
}
