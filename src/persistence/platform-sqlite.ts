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
import { emitPlatformCode } from '../observability/sink';
import { openSQLiteDatabase } from './sqlite-connection';
import { SnapshotManager } from './snapshot-manager';
import { StatementCache } from './statement-cache';
import { resolveSQLiteStorageConfig } from './storage-config';
import { TransactionManager } from './transaction-manager';
import type {
  PlatformSQLiteDiagnostics,
  PlatformSQLiteService,
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

  private started = false;
  private closed = false;

  /** Create a SQLite service from user config. */
  constructor(config: SQLiteStorageConfig = {}) {
    const resolved = resolveSQLiteStorageConfig(config);
    this.raw = openSQLiteDatabase(resolved);
    this.mode = resolved.mode;
    this.path = resolved.path;
    this.snapshotPath = resolved.snapshotPath;
    this.statements = new StatementCache(this.raw, resolved.statementCacheSize);
    this.transactions = new TransactionManager(this.raw);
    this.snapshot = resolved.mode === 'hot' && resolved.snapshotPath
      ? new SnapshotManager(this.raw, resolved.snapshotPath, resolved.snapshotIntervalMs, resolved.snapshotEnabled)
      : null;
    this.checkpoint = resolved.mode === 'file'
      ? new CheckpointManager(this.raw)
      : null;
    this.buffers = resolved.bufferPool === false ? null : new BufferPool(resolved.bufferPool);

    emitPlatformCode(OBS_CODES.PERSISTENCE_SQL_OPENED, {
      metadata: {
        mode: this.mode,
        path: this.path,
        snapshotPath: this.snapshotPath,
      },
    });
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
    if (this.mode === 'hot') this.snapshot?.snapshotSync();
    if (this.mode === 'file') this.checkpoint?.checkpoint('TRUNCATE');
    this.statements.clear();
    this.raw.close();
    this.closed = true;
    emitPlatformCode(OBS_CODES.PERSISTENCE_SQL_CLOSED, {
      metadata: {
        mode: this.mode,
        path: this.path,
        snapshotPath: this.snapshotPath,
      },
    });
  }

  /** Return cheap service diagnostics. */
  diagnostics(): PlatformSQLiteDiagnostics {
    return {
      mode: this.mode,
      path: this.path,
      snapshotPath: this.snapshotPath,
      snapshotEnabled: Boolean(this.snapshot),
      statementCacheSize: this.statements.stats().maxSize,
      bufferPoolEnabled: Boolean(this.buffers),
    };
  }
}

/** Create a platform SQLite service from user config. */
export function createPlatformSQLiteService(config: SQLiteStorageConfig = {}): DefaultPlatformSQLiteService {
  return new DefaultPlatformSQLiteService(config);
}
