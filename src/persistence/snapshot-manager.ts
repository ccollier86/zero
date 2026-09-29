/**
 * snapshot-manager.ts
 *
 * Writes atomic SQLite snapshots for hot mode. This file owns snapshot timing
 * and file replacement only; it does not open databases or choose storage
 * modes.
 */

import type { Database } from 'bun:sqlite';
import {
  closeSync,
  constants,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode, emitPlatformCodeTo } from '../observability/sink';
import type { PlatformObservabilityRuntime } from '../observability/types';
import {
  SQLITE_PERIODIC_SNAPSHOT_MAX_TIMEOUT_MS,
  defaultSQLitePeriodicSnapshotTimeoutMs,
} from './snapshot-policy';

/** Explicit result of one hot SQLite snapshot request. */
export type SnapshotWriteResult =
  | { readonly status: 'written'; readonly durable: true }
  | { readonly status: 'disabled'; readonly durable: false }
  | { readonly status: 'in-progress'; readonly durable: false }
  | { readonly status: 'superseded'; readonly durable: false }
  | { readonly status: 'failed'; readonly durable: false; readonly error: unknown };

const SNAPSHOT_WRITTEN: SnapshotWriteResult = {
  status: 'written',
  durable: true,
};
const SNAPSHOT_DISABLED: SnapshotWriteResult = {
  status: 'disabled',
  durable: false,
};
const SNAPSHOT_IN_PROGRESS: SnapshotWriteResult = {
  status: 'in-progress',
  durable: false,
};
const SNAPSHOT_SUPERSEDED: SnapshotWriteResult = {
  status: 'superseded',
  durable: false,
};

/** Additive internal policy for Zero-owned periodic snapshot actors. */
export interface SnapshotManagerOptions {
  readonly maxBytes?: number | null;
  readonly emitTelemetry?: boolean;
  readonly observability?: PlatformObservabilityRuntime;
  readonly periodicTimeoutMs?: number;
  readonly onPeriodicFailure?: () => void;
  readonly onPeriodicStart?: () => void;
  readonly onPeriodicFinish?: () => void;
  /** Signals the first commit not covered by a published periodic image. */
  readonly onPeriodicDirty?: () => void;
  /** Signals that a published image covers every observed periodic commit. */
  readonly onPeriodicClean?: () => void;
  readonly now?: () => number;
}

/** Writes periodic and final serialized snapshots for a hot SQLite database. */
export class SnapshotManager {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private periodicDeadlineId: ReturnType<typeof setTimeout> | null = null;
  private periodicTask: Promise<SnapshotWriteResult> | null = null;
  private inProgress = false;
  private publishedGeneration = 0;
  private publishedCaptureAt: number | null = null;
  private periodicCommitGeneration = 0;
  private publishedCommitGeneration = 0;
  private periodicDirty = false;
  private discarded = false;
  private hasLatchedFailure = false;
  private latchedFailure: unknown | null = null;
  private periodicFailureNotified = false;
  private readonly canonicalSnapshotPath: string;
  private readonly maxBytes: number | null;
  private readonly emitTelemetry: boolean;
  private readonly observability?: PlatformObservabilityRuntime;
  private readonly periodicTimeoutMs: number;
  private readonly onPeriodicFailure?: () => void;
  private readonly onPeriodicStart?: () => void;
  private readonly onPeriodicFinish?: () => void;
  private readonly onPeriodicDirty?: () => void;
  private readonly onPeriodicClean?: () => void;
  private readonly now: () => number;

  /** Create a snapshot manager; the original four-argument form remains valid. */
  constructor(
    private readonly db: Database,
    private readonly snapshotPath: string,
    private readonly intervalMs: number,
    private readonly enabled: boolean,
    options: SnapshotManagerOptions = {},
  ) {
    const periodicTimeoutMs = options.periodicTimeoutMs
      ?? defaultSQLitePeriodicSnapshotTimeoutMs(intervalMs);
    if (!Number.isSafeInteger(periodicTimeoutMs)
      || periodicTimeoutMs < intervalMs
      || periodicTimeoutMs > SQLITE_PERIODIC_SNAPSHOT_MAX_TIMEOUT_MS) {
      throw new TypeError(
        'Periodic snapshot timeout must be a portable integer at least as large as its interval.',
      );
    }
    if (options.now !== undefined && typeof options.now !== 'function') {
      throw new TypeError('Snapshot clock must be a function.');
    }
    this.maxBytes = options.maxBytes ?? null;
    this.emitTelemetry = options.emitTelemetry ?? true;
    this.observability = options.observability;
    this.periodicTimeoutMs = periodicTimeoutMs;
    this.onPeriodicFailure = options.onPeriodicFailure;
    this.onPeriodicStart = options.onPeriodicStart;
    this.onPeriodicFinish = options.onPeriodicFinish;
    this.onPeriodicDirty = options.onPeriodicDirty;
    this.onPeriodicClean = options.onPeriodicClean;
    this.now = options.now ?? monotonicNow;
    this.canonicalSnapshotPath = path.resolve(snapshotPath);
  }

  /** Whether this manager owns a graceful-shutdown durability boundary. */
  get isEnabled(): boolean {
    return this.enabled && !this.discarded;
  }

  /** False after any real write failure for the lifetime of this manager. */
  get isHealthy(): boolean {
    return !this.hasLatchedFailure;
  }

  /** First snapshot failure, retained even if a later retry succeeds. */
  get failure(): unknown | null {
    return this.latchedFailure;
  }

  /** Whether a periodic post-commit acknowledgement needs a fresh image. */
  requiresPeriodicWriteFence(): boolean {
    if (!this.enabled || this.discarded || this.publishedCaptureAt === null) {
      return this.enabled && !this.discarded;
    }
    const now = this.readNow();
    const ageMs = now - this.publishedCaptureAt;
    return !Number.isFinite(ageMs) || ageMs < 0 || ageMs >= this.intervalMs;
  }

  /**
   * Record one committed periodic-mode write before its response is exposed.
   *
   * The first uncovered commit opens a signal-only durability window and
   * immediately requests an image. A write which lands while that image is
   * publishing remains dirty until a later capture covers its generation.
   */
  recordPeriodicCommit(): void {
    if (!this.enabled || this.discarded || this.periodicFailureNotified) {
      throw new Error('Periodic snapshot durability is unavailable.');
    }
    if (this.periodicCommitGeneration >= Number.MAX_SAFE_INTEGER) {
      this.notifyPeriodicFailure();
      throw new Error('Periodic snapshot commit generation was exhausted.');
    }
    this.periodicCommitGeneration += 1;
    if (!this.periodicDirty) {
      this.periodicDirty = true;
      this.notifyPeriodicLifecycle(this.onPeriodicDirty);
    }
    this.runPeriodicSnapshot();
  }

  /** Start periodic snapshots when enabled. */
  start(): void {
    if (!this.enabled
      || this.discarded
      || this.intervalId
      || this.periodicFailureNotified) return;
    this.intervalId = setInterval(() => {
      this.runPeriodicSnapshot();
    }, this.intervalMs);
    this.intervalId.unref?.();
  }

  /** Stop periodic snapshots. */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.periodicDeadlineId) {
      clearTimeout(this.periodicDeadlineId);
      this.periodicDeadlineId = null;
    }
  }

  /** Permanently prevent an in-flight image from publishing during discard. */
  discard(): void {
    if (this.discarded) return;
    this.discarded = true;
    // Async publication compares its starting generation immediately before
    // rename. Advancing it here makes every pre-discard image superseded.
    this.publishedGeneration += 1;
    this.periodicDirty = false;
    this.stop();
  }

  /** Write an asynchronous snapshot through the original boolean API. */
  async snapshot(): Promise<boolean> {
    return (await this.snapshotDetailed()).status === 'written';
  }

  /**
   * Write an asynchronous snapshot and return its exact internal outcome.
   *
   * A skipped request is intentionally different from a durable write. The
   * caller can distinguish disabled, already-running, and superseded work from
   * both success and a real I/O failure.
   */
  async snapshotDetailed(): Promise<SnapshotWriteResult> {
    if (!this.enabled || this.discarded) return SNAPSHOT_DISABLED;
    if (this.inProgress) return SNAPSHOT_IN_PROGRESS;

    this.inProgress = true;
    const startingGeneration = this.publishedGeneration;
    let capturedCommitGeneration = this.publishedCommitGeneration;
    const directoryPath = path.dirname(this.canonicalSnapshotPath);
    let captureAt: number | null = null;
    let tempPath: string | null = null;
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    let ownsTemp = false;
    let result: SnapshotWriteResult | null = null;

    try {
      tempPath = this.createTempPath(directoryPath);
      captureAt = this.readNow();
      capturedCommitGeneration = this.periodicCommitGeneration;
      const image = this.serializeBounded();
      await mkdir(directoryPath, { recursive: true });
      handle = await open(
        tempPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
      ownsTemp = true;
      await handle.writeFile(image);
      await handle.sync();
      await handle.close();
      handle = null;

      // A synchronous shutdown/on-demand snapshot may have published newer
      // state while this write was awaiting I/O. Its canonical image wins.
      if (this.discarded || startingGeneration !== this.publishedGeneration) {
        result = SNAPSHOT_SUPERSEDED;
      } else {
        // Keep the generation check and complete publication boundary in one
        // non-yielding block. If rename were awaited, a synchronous final
        // snapshot could publish between the check and the older rename, then
        // be overwritten when the asynchronous operation resumed.
        renameSync(tempPath, this.canonicalSnapshotPath);
        ownsTemp = false;
        // Publish ordering changes at rename, not directory fsync. Even when
        // the subsequent directory fsync fails, an older async image must not
        // replace the newer complete image now visible at the canonical path.
        ++this.publishedGeneration;
        syncDirectorySync(directoryPath);
        this.promotePublishedCapture(captureAt, capturedCommitGeneration);
        result = SNAPSHOT_WRITTEN;
      }
    } catch (error) {
      result = this.recordFailure(error);
    } finally {
      const cleanupFailures: unknown[] = [];
      if (handle) {
        try {
          await handle.close();
        } catch (error) {
          cleanupFailures.push(error);
        }
      }
      if (ownsTemp && tempPath) {
        try {
          await rm(tempPath, { force: true });
        } catch (error) {
          cleanupFailures.push(error);
        }
      }
      if (cleanupFailures.length > 0) {
        const cleanupError = cleanupFailures.length === 1
          ? cleanupFailures[0]
          : new AggregateError(cleanupFailures, 'Snapshot temporary-file cleanup failed.');
        result = this.recordFailure(
          result?.status === 'failed'
            ? new AggregateError([result.error, cleanupError], 'Snapshot write and cleanup failed.')
            : cleanupError,
        );
      }
      this.inProgress = false;
    }

    if (result === null) {
      result = this.recordFailure(new Error('Snapshot request completed without an outcome.'));
    }
    if (result.status === 'written') this.emitWritten();
    return result;
  }

  /** Write a synchronous snapshot through the original boolean API. */
  snapshotSync(): boolean {
    return this.snapshotSyncDetailed().status === 'written';
  }

  /**
   * Write a synchronous final/on-demand snapshot with an exact outcome.
   *
   * This can safely supersede an older asynchronous snapshot. `written` means
   * the image, rename, and containing-directory fsync all completed.
   */
  snapshotSyncDetailed(): SnapshotWriteResult {
    if (!this.enabled || this.discarded) return SNAPSHOT_DISABLED;

    const directoryPath = path.dirname(this.canonicalSnapshotPath);
    let captureAt: number | null = null;
    let capturedCommitGeneration = this.publishedCommitGeneration;
    let tempPath: string | null = null;
    let descriptor: number | null = null;
    let ownsTemp = false;
    let result: SnapshotWriteResult | null = null;

    try {
      tempPath = this.createTempPath(directoryPath);
      captureAt = this.readNow();
      capturedCommitGeneration = this.periodicCommitGeneration;
      const image = this.serializeBounded();
      mkdirSync(directoryPath, { recursive: true });
      descriptor = openSync(
        tempPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
      ownsTemp = true;
      writeFileSync(descriptor, image);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = null;
      renameSync(tempPath, this.canonicalSnapshotPath);
      ownsTemp = false;
      ++this.publishedGeneration;
      syncDirectorySync(directoryPath);
      this.promotePublishedCapture(captureAt, capturedCommitGeneration);
      result = SNAPSHOT_WRITTEN;
    } catch (error) {
      result = this.recordFailure(error);
    } finally {
      const cleanupFailures: unknown[] = [];
      if (descriptor !== null) {
        try {
          closeSync(descriptor);
        } catch (error) {
          cleanupFailures.push(error);
        }
      }
      if (ownsTemp && tempPath) {
        try {
          rmSync(tempPath, { force: true });
        } catch (error) {
          cleanupFailures.push(error);
        }
      }
      if (cleanupFailures.length > 0) {
        const cleanupError = cleanupFailures.length === 1
          ? cleanupFailures[0]
          : new AggregateError(cleanupFailures, 'Snapshot temporary-file cleanup failed.');
        result = this.recordFailure(
          result?.status === 'failed'
            ? new AggregateError([result.error, cleanupError], 'Snapshot write and cleanup failed.')
            : cleanupError,
        );
      }
    }

    if (result === null) {
      result = this.recordFailure(new Error('Snapshot request completed without an outcome.'));
    }
    if (result.status === 'written') this.emitWritten();
    return result;
  }

  private createTempPath(directoryPath: string): string {
    const basename = path.basename(this.canonicalSnapshotPath);
    return path.join(directoryPath, `.${basename}.tmp.${crypto.randomUUID()}`);
  }

  private recordFailure(error: unknown): SnapshotWriteResult {
    this.latchFailure(error);
    if (this.emitTelemetry) {
      // Snapshot errors commonly contain absolute paths. Keep the original in
      // the returned durability result, but emit only a stable categorical
      // event through the owning app runtime.
      this.emit(OBS_CODES.PERSISTENCE_SQL_SNAPSHOT_FAILED);
    }
    return {
      status: 'failed',
      durable: false,
      error,
    };
  }

  private emitWritten(): void {
    if (!this.emitTelemetry) return;
    this.emit(OBS_CODES.PERSISTENCE_SQL_SNAPSHOT_WRITTEN);
  }

  private emit(
    definition: typeof OBS_CODES.PERSISTENCE_SQL_SNAPSHOT_FAILED
      | typeof OBS_CODES.PERSISTENCE_SQL_SNAPSHOT_WRITTEN,
  ): void {
    const options = { metadata: { mode: 'hot' } };
    if (this.observability) {
      emitPlatformCodeTo(this.observability, definition, options);
    } else {
      emitPlatformCode(definition, options);
    }
  }

  private notifyPeriodicFailure(): void {
    if (this.periodicFailureNotified) return;
    this.periodicFailureNotified = true;
    this.stop();
    try {
      this.onPeriodicFailure?.();
    } catch {
      // A lifecycle observer must never replace the snapshot failure or create
      // an unhandled timer rejection.
    }
  }

  private runPeriodicSnapshot(): void {
    if (this.discarded || this.periodicTask || this.periodicFailureNotified) return;

    this.notifyPeriodicLifecycle(this.onPeriodicStart);
    const task = this.snapshotDetailed();
    this.periodicTask = task;
    this.periodicDeadlineId = setTimeout(() => {
      if (this.periodicTask !== task) return;
      this.periodicDeadlineId = null;
      this.latchFailure(
        new Error('Periodic hot SQLite snapshot exceeded its durability deadline.'),
      );
      this.notifyPeriodicFailure();
    }, this.periodicTimeoutMs);
    this.periodicDeadlineId.unref?.();

    void task.then((result) => {
      this.finishPeriodicTask(task);
      if (result.status === 'failed') {
        this.notifyPeriodicFailure();
      } else if (!this.discarded && !this.periodicFailureNotified) {
        this.notifyPeriodicLifecycle(this.onPeriodicFinish);
        if (this.periodicDirty
          && (result.status === 'written' || result.status === 'superseded')) {
          this.runPeriodicSnapshot();
        }
      }
    }, () => {
      this.finishPeriodicTask(task);
      // snapshot() is specified to return a failed result rather than reject,
      // but fail closed if a future implementation violates that contract.
      this.notifyPeriodicFailure();
    });
  }

  private finishPeriodicTask(task: Promise<SnapshotWriteResult>): void {
    if (this.periodicTask !== task) return;
    this.periodicTask = null;
    if (this.periodicDeadlineId) {
      clearTimeout(this.periodicDeadlineId);
      this.periodicDeadlineId = null;
    }
  }

  private latchFailure(error: unknown): void {
    if (this.hasLatchedFailure) return;
    this.hasLatchedFailure = true;
    this.latchedFailure = error;
  }

  private promotePublishedCapture(
    captureAt: number,
    capturedCommitGeneration: number,
  ): void {
    this.publishedCaptureAt = captureAt;
    this.publishedCommitGeneration = Math.max(
      this.publishedCommitGeneration,
      capturedCommitGeneration,
    );
    if (this.periodicDirty
      && this.publishedCommitGeneration >= this.periodicCommitGeneration) {
      this.periodicDirty = false;
      this.notifyPeriodicLifecycle(this.onPeriodicClean);
    }
  }

  private notifyPeriodicLifecycle(listener: (() => void) | undefined): void {
    try {
      listener?.();
    } catch {
      // Lifecycle signals never alter snapshot I/O or expose its failure.
    }
  }

  private readNow(): number {
    const value = this.now();
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError('Snapshot clock returned an invalid monotonic time.');
    }
    return value;
  }

  private serializeBounded(): Uint8Array {
    const image = this.db.serialize();
    if (this.maxBytes !== null && image.byteLength > this.maxBytes) {
      throw new RangeError('Hot SQLite image exceeds its configured memory bound.');
    }
    return image;
  }
}

function monotonicNow(): number {
  return performance.now();
}

function syncDirectorySync(directoryPath: string): void {
  const descriptor = openSync(directoryPath, constants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}
