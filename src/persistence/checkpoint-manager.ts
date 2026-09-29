/**
 * checkpoint-manager.ts
 *
 * Runs SQLite WAL checkpoints for file mode. This file owns checkpoint calls
 * only; it does not open databases, serialize hot snapshots, or close handles.
 */

import type { Database } from 'bun:sqlite';

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode, emitPlatformCodeTo } from '../observability/sink';
import type { PlatformObservabilityRuntime } from '../observability/types';

/** Supported SQLite WAL checkpoint modes. */
export type CheckpointMode = 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE';

/** Result returned by PRAGMA wal_checkpoint. */
export interface CheckpointResult {
  busy: number;
  log: number;
  checkpointed: number;
}

/** Internal telemetry ownership for one checkpoint manager. */
export interface CheckpointManagerOptions {
  readonly emitTelemetry?: boolean;
  readonly observability?: PlatformObservabilityRuntime;
}

/** Periodic file-mode WAL checkpoint manager. */
export class CheckpointManager {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly emitTelemetry: boolean;
  private readonly observability?: PlatformObservabilityRuntime;

  /** Create a checkpoint manager for one file-mode SQLite handle. */
  constructor(
    private readonly db: Database,
    private readonly intervalMs = 60_000,
    private readonly mode: CheckpointMode = 'PASSIVE',
    options: CheckpointManagerOptions = {},
  ) {
    this.emitTelemetry = options.emitTelemetry ?? true;
    this.observability = options.observability;
  }

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
      // `prepare()` creates a caller-owned statement. Letting that temporary
      // statement survive until GC can retain a WAL read lock after the
      // database handle closes, which in turn blocks an immediate hot restore.
      // `query()` is owned by the connection and is finalized with it.
      const result = this.db.query(`PRAGMA wal_checkpoint(${mode})`).get() as CheckpointResult;
      const checkpoint = {
        busy: result.busy,
        log: result.log,
        checkpointed: result.checkpointed,
      };
      this.emit(OBS_CODES.PERSISTENCE_SQL_CHECKPOINT_COMPLETED, {
        mode,
        ...checkpoint,
      });
      return checkpoint;
    } catch (error) {
      // The caught SQLite error may contain SQL or a filesystem path. The
      // stable code and checkpoint mode are enough for operational routing.
      this.emit(OBS_CODES.PERSISTENCE_SQL_CHECKPOINT_FAILED, { mode });
      throw error;
    }
  }

  private emit(
    definition: typeof OBS_CODES.PERSISTENCE_SQL_CHECKPOINT_COMPLETED
      | typeof OBS_CODES.PERSISTENCE_SQL_CHECKPOINT_FAILED,
    metadata: Record<string, unknown>,
  ): void {
    if (!this.emitTelemetry) return;
    const options = { metadata };
    if (this.observability) {
      emitPlatformCodeTo(this.observability, definition, options);
    } else {
      emitPlatformCode(definition, options);
    }
  }
}
