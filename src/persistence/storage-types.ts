/**
 * storage-types.ts
 *
 * Defines Zero's local persistence contracts. This file owns configuration and
 * service shapes only; it does not open SQLite, run snapshots, or mount
 * platform plugins.
 */

import type { Database } from 'bun:sqlite';
import type { PlatformObservabilityRuntime } from '../observability/types';
import type { BufferPool } from './buffer-pool';
import type { CheckpointManager } from './checkpoint-manager';
import type { SnapshotManager } from './snapshot-manager';
import type { StatementCache } from './statement-cache';
import type { TransactionManager } from './transaction-manager';

/** SQLite active storage modes supported by the platform foundation. */
export type SQLiteStorageMode = 'hot' | 'file' | 'ephemeral';

/** Legacy SQLite config aliases accepted during migration. */
export type LegacySQLiteStorageMode = 'memory' | ':memory:';

/** SQLite synchronous PRAGMA values accepted by Zero config. */
export type SQLiteSynchronousMode = 'OFF' | 'NORMAL' | 'FULL' | 'EXTRA';

/** SQLite temp_store PRAGMA values accepted by Zero config. */
export type SQLiteTempStoreMode = 'DEFAULT' | 'FILE' | 'MEMORY';

/** Configuration for the SQLite persistence foundation. */
export interface SQLiteStorageConfig {
  /** Storage mode. String paths are treated as file mode for compatibility. */
  mode?: SQLiteStorageMode | LegacySQLiteStorageMode | (string & {});
  /** Primary SQLite file path used by file mode and as a hot-mode source. */
  path?: string;
  /** Snapshot path used by hot mode. Defaults to path when omitted. */
  snapshotPath?: string;
  /** Enable periodic hot-mode snapshots. Default: true for hot mode. */
  snapshotEnabled?: boolean;
  /** Periodic hot-mode snapshot interval in milliseconds. Default: 30000. */
  snapshotIntervalMs?: number;
  /** Optional hard bound for a serialized hot database image, in bytes. */
  hotMaxBytes?: number;
  /** Emit persistence lifecycle telemetry. Internal actor runtimes disable it. */
  emitTelemetry?: boolean;
  /** SQLite cache_size PRAGMA. Default: -262144. */
  cacheSize?: number;
  /** SQLite mmap_size PRAGMA for file mode. Default: 1073741824. */
  mmapSize?: number;
  /** SQLite wal_autocheckpoint PRAGMA for file mode. Default: 1000. */
  walAutocheckpoint?: number;
  /** SQLite page_size PRAGMA. Default: 4096. */
  pageSize?: number;
  /** SQLite synchronous PRAGMA for file mode. Default: NORMAL. */
  synchronous?: SQLiteSynchronousMode;
  /** SQLite temp_store PRAGMA. Default: MEMORY. */
  tempStore?: SQLiteTempStoreMode;
  /** SQLite busy_timeout PRAGMA. Default: 5000. */
  busyTimeout?: number;
  /** Maximum number of cached prepared statements. Default: 1000. */
  statementCacheSize?: number;
  /** Disable or configure reusable binary buffer pooling. */
  bufferPool?: false | BufferPoolConfig;
}

/**
 * Internal lifecycle hooks for an owned SQLite service.
 *
 * Hooks are deliberately signal-only: persistence never forwards filesystem
 * paths, SQLite errors, or snapshot bytes across this boundary.
 */
export interface PlatformSQLiteServiceHooks {
  /** App-owned telemetry target. Internal actors normally disable telemetry. */
  readonly observability?: PlatformObservabilityRuntime;
  /** Signals that one periodic snapshot has begun before image serialization. */
  readonly onPeriodicSnapshotStart?: () => void;
  /** Signals that periodic work completed or a newer image superseded it. */
  readonly onPeriodicSnapshotFinish?: () => void;
  /** Signals the first commit not covered by a published periodic image. */
  readonly onPeriodicDurabilityDirty?: () => void;
  /** Signals that a published image covers all observed periodic commits. */
  readonly onPeriodicDurabilityClean?: () => void;
  /** Called once when the periodic hot-snapshot loop first fails. */
  readonly onPeriodicSnapshotFailure?: () => void;
  /** Internal watchdog override for one periodic snapshot request. */
  readonly periodicSnapshotTimeoutMs?: number;
}

/** Resolved SQLite config with legacy aliases normalized. */
export interface ResolvedSQLiteStorageConfig {
  mode: SQLiteStorageMode;
  path: string | null;
  snapshotPath: string | null;
  snapshotEnabled: boolean;
  snapshotIntervalMs: number;
  /** Internal hot-image budget; omitted legacy resolved objects remain unbounded. */
  hotMaxBytes?: number | null;
  /** Internal telemetry switch; omitted legacy resolved objects continue emitting. */
  emitTelemetry?: boolean;
  cacheSize: number;
  mmapSize: number;
  walAutocheckpoint: number;
  pageSize: number;
  synchronous: SQLiteSynchronousMode;
  tempStore: SQLiteTempStoreMode;
  busyTimeout: number;
  statementCacheSize: number;
  bufferPool: false | Required<BufferPoolConfig>;
}

/** Configures reusable binary buffers for platform serialization helpers. */
export interface BufferPoolConfig {
  /** Maximum buffers retained per size bucket. Default: 100. */
  maxPoolSize?: number;
  /** Whether standard size buckets are preallocated. Default: true. */
  preallocate?: boolean;
}

/** SQLite service exposed by the persistence foundation. */
export interface PlatformSQLiteService {
  /** Active Bun SQLite database handle. */
  raw: Database;
  /** Normalized active storage mode. */
  mode: SQLiteStorageMode;
  /** File path for file/hot source mode, when configured. */
  path: string | null;
  /** Snapshot path for hot mode, when configured. */
  snapshotPath: string | null;
  /** Prepared statement cache for cross-cutting platform SQL helpers. */
  statements: StatementCache;
  /** Transaction manager for cross-cutting platform SQL helpers. */
  transactions: TransactionManager;
  /** Hot-mode snapshot manager, or null outside hot mode. */
  snapshot: SnapshotManager | null;
  /** File-mode checkpoint manager, or null outside file mode. */
  checkpoint: CheckpointManager | null;
  /** Reusable binary buffer pool, or null when disabled. */
  buffers: BufferPool | null;
  /** Start background persistence loops owned by this service. */
  start(): void;
  /** Stop background loops without closing the database handle. */
  stop(): void;
  /** Close the service, flushing mode-specific durability boundaries first. */
  close(): void;
  /** Discard startup state without publishing a snapshot or checkpoint. */
  abort?(): void;
  /** Return cheap diagnostics for doctor checks and tests. */
  diagnostics(): PlatformSQLiteDiagnostics;
}

/** Diagnostics returned by PlatformSQLiteService. */
export interface PlatformSQLiteDiagnostics {
  mode: SQLiteStorageMode;
  path: string | null;
  snapshotPath: string | null;
  snapshotEnabled: boolean;
  /** False after any hot snapshot write failure for this service lifetime. */
  snapshotHealthy?: boolean;
  statementCacheSize: number;
  bufferPoolEnabled: boolean;
}
