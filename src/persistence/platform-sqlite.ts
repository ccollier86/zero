/**
 * platform-sqlite.ts
 *
 * Composes Zero's SQLite persistence foundation: connection policy, hot
 * snapshots, file-mode checkpoints, statement cache, transactions, and buffer
 * pool. This file owns SQLite service lifecycle only.
 */

import { BufferPool } from './buffer-pool';
import { CheckpointManager } from './checkpoint-manager';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode, emitPlatformCodeTo } from '../observability/sink';
import type { PlatformObservabilityRuntime } from '../observability/types';
import { openSQLiteDatabase } from './sqlite-connection';
import { SnapshotManager } from './snapshot-manager';
import {
  SQLITE_PERIODIC_SNAPSHOT_MAX_TIMEOUT_MS,
  defaultSQLitePeriodicSnapshotTimeoutMs,
} from './snapshot-policy';
import { StatementCache } from './statement-cache';
import { resolveSQLiteStorageConfig } from './storage-config';
import { TransactionManager } from './transaction-manager';
import type {
  PlatformSQLiteDiagnostics,
  PlatformSQLiteService,
  PlatformSQLiteServiceHooks,
  SQLiteStorageConfig,
} from './storage-types';

/** Concrete platform SQLite service. */
export class DefaultPlatformSQLiteService implements PlatformSQLiteService {
  readonly raw;
  readonly mode;
  readonly path;
  readonly snapshotPath;
  readonly statements: StatementCache;
  readonly transactions: TransactionManager;
  readonly snapshot: SnapshotManager | null;
  readonly checkpoint: CheckpointManager | null;
  readonly buffers: BufferPool | null;

  private readonly emitTelemetry: boolean;
  private readonly observability?: PlatformObservabilityRuntime;
  private started = false;
  private closed = false;
  private statementsCleared = false;
  private rawClosed = false;

  /** Create a SQLite service from user config. */
  constructor(
    config: SQLiteStorageConfig = {},
    hooks: PlatformSQLiteServiceHooks = {},
  ) {
    for (const [name, hook] of Object.entries({
      onPeriodicSnapshotStart: hooks.onPeriodicSnapshotStart,
      onPeriodicSnapshotFinish: hooks.onPeriodicSnapshotFinish,
      onPeriodicDurabilityDirty: hooks.onPeriodicDurabilityDirty,
      onPeriodicDurabilityClean: hooks.onPeriodicDurabilityClean,
      onPeriodicSnapshotFailure: hooks.onPeriodicSnapshotFailure,
    })) {
      if (hook !== undefined && typeof hook !== 'function') {
        throw new TypeError(`${name} must be a function.`);
      }
    }
    const resolved = resolveSQLiteStorageConfig(config);
    this.raw = openSQLiteDatabase(resolved);
    this.mode = resolved.mode;
    this.path = resolved.path;
    this.snapshotPath = resolved.snapshotPath;
    this.emitTelemetry = resolved.emitTelemetry ?? true;
    this.observability = hooks.observability;
    this.statements = new StatementCache(this.raw, resolved.statementCacheSize);
    this.transactions = new TransactionManager(this.raw, {
      emitTelemetry: this.emitTelemetry,
      observability: this.observability,
    });
    this.snapshot = resolved.mode === 'hot' && resolved.snapshotPath
      ? new SnapshotManager(
          this.raw,
          resolved.snapshotPath,
          resolved.snapshotIntervalMs,
          resolved.snapshotEnabled,
          {
            maxBytes: resolved.hotMaxBytes ?? null,
            emitTelemetry: resolved.emitTelemetry ?? true,
            observability: hooks.observability,
            periodicTimeoutMs: normalizePeriodicSnapshotTimeout(
              hooks.periodicSnapshotTimeoutMs,
              resolved.snapshotIntervalMs,
            ),
            onPeriodicFailure: hooks.onPeriodicSnapshotFailure,
            onPeriodicStart: hooks.onPeriodicSnapshotStart,
            onPeriodicFinish: hooks.onPeriodicSnapshotFinish,
            onPeriodicDirty: hooks.onPeriodicDurabilityDirty,
            onPeriodicClean: hooks.onPeriodicDurabilityClean,
          },
        )
      : null;
    this.checkpoint = resolved.mode === 'file'
      ? new CheckpointManager(this.raw, 60_000, 'PASSIVE', {
          emitTelemetry: resolved.emitTelemetry ?? true,
          observability: hooks.observability,
        })
      : null;
    this.buffers = resolved.bufferPool === false ? null : new BufferPool(resolved.bufferPool);

    if (this.emitTelemetry) {
      this.emit(OBS_CODES.PERSISTENCE_SQL_OPENED);
    }
  }

  /** Start background snapshot/checkpoint loops. */
  start(): void {
    if (this.closed || this.started) return;
    this.snapshot?.start();
    this.checkpoint?.start();
    this.started = true;
  }

  /** Stop background snapshot/checkpoint loops. */
  stop(): void {
    this.snapshot?.stop();
    this.checkpoint?.stop();
    this.started = false;
  }

  /** Close SQLite after flushing the mode-specific durability boundary. */
  close(): void {
    if (this.closed) return;
    this.stop();
    if (this.mode === 'hot' && this.snapshot?.isEnabled) {
      const result = this.snapshot.snapshotSyncDetailed();
      if (result.status !== 'written') {
        throw new Error(
          `[persistence] Refusing to close hot SQLite because its final snapshot failed` +
          ` to establish durability (${result.status}): ${this.snapshotPath}`,
          result.status === 'failed' ? { cause: result.error } : undefined,
        );
      }
    }
    if (this.mode === 'file') this.checkpoint?.checkpoint('TRUNCATE');
    if (!this.statementsCleared) {
      this.statements.clear();
      this.statementsCleared = true;
    }
    if (!this.rawClosed) {
      // ReactiveDB exposes prepared statements to application code, so this
      // compatibility service cannot prove that it owns every live statement.
      // Bun's deferred close lets those statements finish before releasing the
      // handle. Fabric's subprocess-exit proof, rather than this local service
      // flag, establishes exact actor authority release before replacement.
      this.raw.close(false);
      this.rawClosed = true;
    }
    this.closed = true;
    if (this.emitTelemetry) {
      this.emit(OBS_CODES.PERSISTENCE_SQL_CLOSED);
    }
  }

  /**
   * Discard an incomplete startup without making its hot image durable.
   *
   * Cleanup steps are tracked independently so a partial failure can be
   * retried without repeating a step which already succeeded.
   */
  abort(): void {
    if (this.closed) return;
    this.stop();
    this.snapshot?.discard();
    const failures: unknown[] = [];
    if (!this.statementsCleared) {
      try {
        this.statements.clear();
        this.statementsCleared = true;
      } catch (error) {
        failures.push(error);
      }
    }
    // Cached statements depend on the live handle. Never close that handle
    // after a partial cache-clear failure; a later abort must be able to retry
    // finalizing the remaining statements safely.
    if (this.statementsCleared && !this.rawClosed) {
      try {
        // See close(): this service may have externally owned statements.
        this.raw.close(false);
        this.rawClosed = true;
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'SQLite startup state could not be discarded.');
    }
    this.closed = true;
  }

  /** Return cheap service diagnostics. */
  diagnostics(): PlatformSQLiteDiagnostics {
    return {
      mode: this.mode,
      path: this.path,
      snapshotPath: this.snapshotPath,
      snapshotEnabled: this.snapshot?.isEnabled ?? false,
      snapshotHealthy: this.snapshot?.isHealthy ?? true,
      statementCacheSize: this.statements.stats().maxSize,
      bufferPoolEnabled: Boolean(this.buffers),
    };
  }

  private emit(
    definition: typeof OBS_CODES.PERSISTENCE_SQL_OPENED
      | typeof OBS_CODES.PERSISTENCE_SQL_CLOSED,
  ): void {
    const options = { metadata: { mode: this.mode } };
    if (this.observability) {
      emitPlatformCodeTo(this.observability, definition, options);
    } else {
      emitPlatformCode(definition, options);
    }
  }
}

function normalizePeriodicSnapshotTimeout(
  value: number | undefined,
  intervalMs: number,
): number {
  const timeoutMs = value
    ?? defaultSQLitePeriodicSnapshotTimeoutMs(intervalMs);
  if (!Number.isSafeInteger(timeoutMs)
    || timeoutMs < intervalMs
    || timeoutMs > SQLITE_PERIODIC_SNAPSHOT_MAX_TIMEOUT_MS) {
    throw new TypeError(
      'periodicSnapshotTimeoutMs must be a bounded integer at least as large as the interval.',
    );
  }
  return timeoutMs;
}

/** Create a platform SQLite service from user config. */
export function createPlatformSQLiteService(
  config: SQLiteStorageConfig = {},
  hooks: PlatformSQLiteServiceHooks = {},
): DefaultPlatformSQLiteService {
  return new DefaultPlatformSQLiteService(config, hooks);
}
