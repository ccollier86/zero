/** Bounded-work policy and monotonic expiry clock for snapshot sessions. */

import {
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_ROWS,
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SESSIONS,
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_BYTES,
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_BYTES,
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_NODES,
  DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_NODES,
  DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_ROWS,
  DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_SOURCE_BYTES,
  DATABASE_TENANT_SYNC_SNAPSHOT_TTL_MS,
} from './database-tenant-sync-snapshot-protocol';

export interface DatabaseTenantSyncSnapshotSessionLimits {
  readonly maxSessions: number;
  readonly maxRows: number;
  readonly maxSourceBytes: number;
  readonly maxSourceRowBytes: number;
  readonly maxSourceRowNodes: number;
  readonly pageMaxRows: number;
  readonly pageMaxSourceBytes: number;
  readonly pageMaxNodes: number;
  readonly ttlMs: number;
}

/**
 * Epoch-shaped time for wire diagnostics, advanced by elapsed monotonic time.
 * Snapshot sessions are actor-local TEMP state, so one anchor is sufficient
 * for the store lifetime and wall-clock corrections cannot extend their TTL.
 */
export function createDatabaseTenantSyncSnapshotEpochClock(
  wallNow: () => number = Date.now,
  monotonicNow: () => number = () => performance.now(),
): () => number {
  const epochAnchor = wallNow();
  const monotonicAnchor = monotonicNow();
  return () => Math.floor(
    epochAnchor + (monotonicNow() - monotonicAnchor),
  );
}

export function normalizeDatabaseTenantSyncSnapshotLimits(
  value: Partial<DatabaseTenantSyncSnapshotSessionLimits> | undefined,
): DatabaseTenantSyncSnapshotSessionLimits {
  const limits = {
    maxSessions: value?.maxSessions
      ?? DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SESSIONS,
    maxRows: value?.maxRows ?? DATABASE_TENANT_SYNC_SNAPSHOT_MAX_ROWS,
    maxSourceBytes: value?.maxSourceBytes
      ?? DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_BYTES,
    maxSourceRowBytes: value?.maxSourceRowBytes
      ?? DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_BYTES,
    maxSourceRowNodes: value?.maxSourceRowNodes
      ?? DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_NODES,
    pageMaxRows: value?.pageMaxRows
      ?? DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_ROWS,
    pageMaxSourceBytes: value?.pageMaxSourceBytes
      ?? DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_SOURCE_BYTES,
    pageMaxNodes: value?.pageMaxNodes
      ?? DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_NODES,
    ttlMs: value?.ttlMs ?? DATABASE_TENANT_SYNC_SNAPSHOT_TTL_MS,
  };
  const maxima: DatabaseTenantSyncSnapshotSessionLimits = {
    maxSessions: DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SESSIONS,
    maxRows: DATABASE_TENANT_SYNC_SNAPSHOT_MAX_ROWS,
    maxSourceBytes: DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_BYTES,
    maxSourceRowBytes: DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_BYTES,
    maxSourceRowNodes: DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_NODES,
    pageMaxRows: DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_ROWS,
    pageMaxSourceBytes: DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_SOURCE_BYTES,
    pageMaxNodes: DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_NODES,
    ttlMs: DATABASE_TENANT_SYNC_SNAPSHOT_TTL_MS,
  };
  for (const key of Object.keys(maxima) as Array<keyof typeof maxima>) {
    if (!Number.isSafeInteger(limits[key])
      || limits[key] < 1
      || limits[key] > maxima[key]) {
      throw new TypeError('Database tenant snapshot-session limits are invalid.');
    }
  }
  if (limits.maxSourceRowBytes > limits.maxSourceBytes
    || limits.pageMaxSourceBytes < limits.maxSourceRowBytes
    || limits.pageMaxNodes < limits.maxSourceRowNodes + 5) {
    throw new TypeError('Database tenant snapshot-session limits are inconsistent.');
  }
  return Object.freeze(limits);
}
