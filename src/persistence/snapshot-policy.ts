/**
 * Portable timing policy for periodic SQLite snapshots.
 *
 * This module is intentionally pure: snapshot I/O and timer ownership remain
 * in SnapshotManager, while database placement may reuse the same defaults.
 */

import { MAX_RUNTIME_TIMER_INTERVAL_MS } from '../runtime/timer-limits';

/** Minimum default watchdog for one asynchronous periodic snapshot. */
export const SQLITE_PERIODIC_SNAPSHOT_MIN_TIMEOUT_MS = 120_000;

/** Largest watchdog portable across JavaScript timer implementations. */
export const SQLITE_PERIODIC_SNAPSHOT_MAX_TIMEOUT_MS =
  MAX_RUNTIME_TIMER_INTERVAL_MS;

/** Default to two cadences, with a conservative two-minute floor. */
export function defaultSQLitePeriodicSnapshotTimeoutMs(
  snapshotIntervalMs: number,
): number {
  const doubled = snapshotIntervalMs
    > Math.floor(SQLITE_PERIODIC_SNAPSHOT_MAX_TIMEOUT_MS / 2)
    ? SQLITE_PERIODIC_SNAPSHOT_MAX_TIMEOUT_MS
    : snapshotIntervalMs * 2;
  return Math.min(
    SQLITE_PERIODIC_SNAPSHOT_MAX_TIMEOUT_MS,
    Math.max(SQLITE_PERIODIC_SNAPSHOT_MIN_TIMEOUT_MS, doubled),
  );
}
