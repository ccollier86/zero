/** Privacy-safe error constructors for tenant Sync snapshot sessions. */

import { DatabaseError } from './database-error';

export type DatabaseTenantSyncSnapshotLimitReason =
  | 'bytes'
  | 'cursor'
  | 'deadline'
  | 'missing'
  | 'row-bytes'
  | 'row-nodes'
  | 'rows'
  | 'sessions';

export function databaseTenantSyncSnapshotCapacity(
  reason: 'bytes' | 'sessions' = 'sessions',
): DatabaseError {
  return new DatabaseError(
    'DATABASE_BACKPRESSURE',
    'Database tenant snapshot-session capacity is exhausted.',
    {
      retryable: true,
      outcome: 'not-started',
      details: { snapshotReason: reason },
    },
  );
}

export function databaseTenantSyncSnapshotLimit(
  reason: DatabaseTenantSyncSnapshotLimitReason,
): DatabaseError {
  return new DatabaseError(
    'DATABASE_PAYLOAD_LIMIT',
    'Database tenant snapshot exceeds its bounded source contract.',
    { retryable: false, outcome: null, details: { snapshotReason: reason } },
  );
}

export function databaseTenantSyncSnapshotExpired(
  reason: DatabaseTenantSyncSnapshotLimitReason,
): DatabaseError {
  return new DatabaseError(
    'DATABASE_TRANSACTION_EXPIRED',
    'Database tenant snapshot session expired.',
    { retryable: false, outcome: null, details: { snapshotReason: reason } },
  );
}

export function databaseTenantSyncSnapshotSchemaMismatch(
  cause?: unknown,
): DatabaseError {
  return new DatabaseError(
    'DATABASE_SCHEMA_MISMATCH',
    'Database tenant snapshot-session state is incompatible.',
    cause === undefined ? undefined : { cause },
  );
}
