/**
 * storage-config.ts
 *
 * Normalizes SQLite persistence config and legacy aliases. This file owns
 * config resolution only; it does not open databases or create directories.
 */

import type { ResolvedSQLiteStorageConfig, SQLiteStorageConfig, SQLiteStorageMode } from './storage-types';

const DEFAULT_DB_PATH = './data/app.db';
const DEFAULT_SNAPSHOT_PATH = './data/app.snapshot.db';

/** Resolve user SQLite config into explicit platform storage settings. */
export function resolveSQLiteStorageConfig(input: SQLiteStorageConfig = {}): ResolvedSQLiteStorageConfig {
  const mode = resolveMode(input);
  const path = resolvePath(input, mode);
  const snapshotPath = mode === 'hot'
    ? input.snapshotPath ?? (path === DEFAULT_DB_PATH ? DEFAULT_SNAPSHOT_PATH : path)
    : null;

  return {
    mode,
    path: mode === 'ephemeral' ? null : path,
    snapshotPath,
    snapshotEnabled: mode === 'hot' ? input.snapshotEnabled ?? true : false,
    snapshotIntervalMs: normalizePositiveInteger(input.snapshotIntervalMs ?? 30_000, 'snapshotIntervalMs'),
    cacheSize: input.cacheSize ?? -262_144,
    mmapSize: input.mmapSize ?? 1_073_741_824,
    walAutocheckpoint: normalizePositiveInteger(input.walAutocheckpoint ?? 1000, 'walAutocheckpoint'),
    pageSize: normalizePositiveInteger(input.pageSize ?? 4096, 'pageSize'),
    synchronous: input.synchronous ?? 'NORMAL',
    tempStore: input.tempStore ?? 'MEMORY',
    busyTimeout: normalizePositiveInteger(input.busyTimeout ?? 5000, 'busyTimeout'),
    statementCacheSize: normalizePositiveInteger(input.statementCacheSize ?? 1000, 'statementCacheSize'),
    bufferPool: input.bufferPool === false
      ? false
      : {
          maxPoolSize: input.bufferPool?.maxPoolSize ?? 100,
          preallocate: input.bufferPool?.preallocate ?? true,
        },
  };
}

function resolveMode(input: SQLiteStorageConfig): SQLiteStorageMode {
  const rawMode = input.mode;
  if (!rawMode) return 'hot';
  if (rawMode === 'memory' || rawMode === ':memory:') return 'ephemeral';
  if (rawMode === 'hot') return 'hot';
  if (rawMode === 'file') return 'file';
  if (rawMode === 'ephemeral') return 'ephemeral';
  return 'file';
}

function resolvePath(input: SQLiteStorageConfig, mode: SQLiteStorageMode): string {
  if (mode === 'ephemeral') return ':memory:';
  if (input.path) return input.path;
  if (input.mode && !['hot', 'file', 'ephemeral', 'memory', ':memory:'].includes(input.mode)) {
    return input.mode;
  }
  return DEFAULT_DB_PATH;
}

function normalizePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`SQLite ${label} must be a positive integer.`);
  }
  return value;
}
