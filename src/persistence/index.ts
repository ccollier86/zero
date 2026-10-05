/**
 * index.ts
 *
 * Public persistence foundation barrel. Exports SQL storage primitives;
 * managed application composition and ReactiveDB bind these through their
 * own service/lifecycle boundaries.
 */

export { BufferPool } from './buffer-pool';
export { CheckpointManager } from './checkpoint-manager';
export type { CheckpointMode, CheckpointResult } from './checkpoint-manager';
export { createPlatformSQLiteService, DefaultPlatformSQLiteService } from './platform-sqlite';
export {
  clearPlatformSQLiteService,
  getPlatformSQLiteService,
  requirePlatformSQLiteService,
  setPlatformSQLiteService,
} from './platform-sqlite-runtime';
export { openSQLiteDatabase } from './sqlite-connection';
export { SnapshotManager } from './snapshot-manager';
export type { SnapshotManagerOptions, SnapshotWriteResult } from './snapshot-manager';
export {
  SQLITE_PERIODIC_SNAPSHOT_MAX_TIMEOUT_MS,
  SQLITE_PERIODIC_SNAPSHOT_MIN_TIMEOUT_MS,
  defaultSQLitePeriodicSnapshotTimeoutMs,
} from './snapshot-policy';
export { StatementCache } from './statement-cache';
export { resolveSQLiteStorageConfig } from './storage-config';
export { TransactionManager } from './transaction-manager';
export type { TransactionManagerOptions } from './transaction-manager';
export type {
  BufferPoolConfig,
  LegacySQLiteStorageMode,
  PlatformSQLiteDiagnostics,
  PlatformSQLiteService,
  PlatformSQLiteServiceHooks,
  ResolvedSQLiteStorageConfig,
  SQLiteStorageConfig,
  SQLiteStorageMode,
  SQLiteSynchronousMode,
  SQLiteTempStoreMode,
} from './storage-types';
