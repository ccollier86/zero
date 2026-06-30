/**
 * index.ts
 *
 * Public persistence foundation barrel. Exports SQL storage primitives only;
 * app-factory composition and ReactiveDB integration are implemented in later
 * slices.
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
export { StatementCache } from './statement-cache';
export { resolveSQLiteStorageConfig } from './storage-config';
export { TransactionManager } from './transaction-manager';
export type {
  BufferPoolConfig,
  LegacySQLiteStorageMode,
  PlatformSQLiteDiagnostics,
  PlatformSQLiteService,
  ResolvedSQLiteStorageConfig,
  SQLiteStorageConfig,
  SQLiteStorageMode,
  SQLiteSynchronousMode,
  SQLiteTempStoreMode,
} from './storage-types';
