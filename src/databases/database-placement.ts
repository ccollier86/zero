import type { DatabaseRef } from './database-file';
import { MAX_RUNTIME_TIMER_INTERVAL_MS } from '../runtime/timer-limits';
import {
  SQLITE_PERIODIC_SNAPSHOT_MAX_TIMEOUT_MS,
  SQLITE_PERIODIC_SNAPSHOT_MIN_TIMEOUT_MS,
  defaultSQLitePeriodicSnapshotTimeoutMs,
} from '../persistence/snapshot-policy';

/** Physical SQLite placement pinned to one coordinator entry. */
export type DatabasePlacement = 'file' | 'hot';

/** Durability boundary for a RAM-active hot database. */
export type DatabaseHotDurability = 'on-write' | 'periodic' | 'final';

/**
 * Deliberately opaque selector input.
 *
 * Placement policy may classify a logical database reference, but it never
 * receives a tenant id, filesystem path, request, user, or mutable runtime
 * state from Zero.
 */
export interface DatabasePlacementSelectorContext {
  readonly databaseRef: DatabaseRef;
}

/** Synchronous placement selector. Its result is validated by the coordinator. */
export type DatabasePlacementSelector = (
  context: DatabasePlacementSelectorContext,
) => DatabasePlacement;

/** Normalized limits and durability behavior shared by every hot entry. */
export interface DatabaseHotPlacementConfig {
  readonly durability: DatabaseHotDurability;
  readonly maxBytes: number;
  readonly snapshotIntervalMs?: number;
  readonly snapshotTimeoutMs?: number;
}

/**
 * Immutable normalized placement policy consumed by the database coordinator.
 * Selection is pinned to the coordinator entry across replacement generations.
 */
export interface DatabasePlacementPolicy {
  readonly default: DatabasePlacement;
  readonly select?: DatabasePlacementSelector;
  readonly hot: DatabaseHotPlacementConfig | null;
}

/** Conservative per-database bound used only by the public `placement: 'hot'` shorthand. */
export const DATABASE_HOT_SHORTHAND_MAX_BYTES = 64 * 1024 * 1024;

/** Safest durability contract used when hot durability is omitted. */
export const DATABASE_HOT_DEFAULT_DURABILITY: DatabaseHotDurability = 'on-write';

/** Bounded periodic snapshot cadence used when periodic durability omits one. */
export const DATABASE_HOT_DEFAULT_SNAPSHOT_INTERVAL_MS = 30_000;

/** Minimum default watchdog for one asynchronous periodic snapshot. */
export const DATABASE_HOT_MIN_SNAPSHOT_TIMEOUT_MS =
  SQLITE_PERIODIC_SNAPSHOT_MIN_TIMEOUT_MS;

/** Largest portable periodic hot-snapshot cadence accepted by Zero. */
export const DATABASE_HOT_MAX_SNAPSHOT_INTERVAL_MS = MAX_RUNTIME_TIMER_INTERVAL_MS;

/** Largest portable periodic snapshot watchdog accepted by Zero. */
export const DATABASE_HOT_MAX_SNAPSHOT_TIMEOUT_MS =
  SQLITE_PERIODIC_SNAPSHOT_MAX_TIMEOUT_MS;

/** Derive the default watchdog without overflowing the portable timer range. */
export function defaultDatabaseHotSnapshotTimeoutMs(
  snapshotIntervalMs: number,
): number {
  return defaultSQLitePeriodicSnapshotTimeoutMs(snapshotIntervalMs);
}

/** Shared immutable file-only policy used by omitted and `file` configuration. */
export const DATABASE_FILE_PLACEMENT_POLICY: DatabasePlacementPolicy = Object.freeze({
  default: 'file',
  hot: null,
});

/** Shared immutable policy used by the bounded `hot` shorthand. */
export const DATABASE_HOT_SHORTHAND_PLACEMENT_POLICY: DatabasePlacementPolicy = Object.freeze({
  default: 'hot',
  hot: Object.freeze({
    durability: DATABASE_HOT_DEFAULT_DURABILITY,
    maxBytes: DATABASE_HOT_SHORTHAND_MAX_BYTES,
  }),
});

/** Return whether an untrusted selector result names a supported placement. */
export function isDatabasePlacement(value: unknown): value is DatabasePlacement {
  return value === 'file' || value === 'hot';
}

/** Return whether an untrusted config value names a supported hot durability mode. */
export function isDatabaseHotDurability(value: unknown): value is DatabaseHotDurability {
  return value === 'on-write' || value === 'periodic' || value === 'final';
}
