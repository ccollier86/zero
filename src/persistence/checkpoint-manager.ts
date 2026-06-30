/**
 * checkpoint-manager.ts
 *
 * Runs SQLite WAL checkpoints for file mode. This file owns checkpoint calls
 * only; it does not open databases, serialize hot snapshots, or close handles.
 */

import type { Database } from 'bun:sqlite';

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode, errorPlatform } from '../observability/sink';

/** Supported SQLite WAL checkpoint modes. */
export type CheckpointMode = 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE';

/** Result returned by PRAGMA wal_checkpoint. */
export interface CheckpointResult {
  busy: number;
  log: number;
  checkpointed: number;
}

/** Periodic file-mode WAL checkpoint manager. */
export class CheckpointManager {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  /** Create a checkpoint manager for one file-mode SQLite handle. */
  constructor(
    private readonly db: Database,
    private readonly intervalMs = 60_000,
    private readonly mode: CheckpointMode = 'PASSIVE'
  ) {}

  /** Start periodic checkpoints. */
  start(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      try {
        this.checkpoint(this.mode);
      } catch {
        // checkpoint() already routes failures through observability.
      }
    }, this.intervalMs);
  }

  /** Stop periodic checkpoints. */
  stop(): void {
    if (!this.intervalId) return;
    clearInterval(this.intervalId);
    this.intervalId = null;
  }

  /** Run a WAL checkpoint and return SQLite checkpoint counters. */
  checkpoint(mode: CheckpointMode = 'PASSIVE'): CheckpointResult {
    try {
      const result = this.db.prepare(`PRAGMA wal_checkpoint(${mode})`).get() as CheckpointResult;
      const checkpoint = {
        busy: result.busy,
        log: result.log,
        checkpointed: result.checkpointed,
      };
      emitPlatformCode(OBS_CODES.PERSISTENCE_SQL_CHECKPOINT_COMPLETED, {
        metadata: { mode, ...checkpoint },
      });
      return checkpoint;
    } catch (error) {
      errorPlatform(OBS_CODES.PERSISTENCE_SQL_CHECKPOINT_FAILED, {
        error,
        metadata: { mode },
      });
      throw error;
    }
  }
}
