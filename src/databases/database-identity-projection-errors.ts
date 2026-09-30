/** Error translation across Guardian's projection/database actor boundary. */

import {
  IdentityProjectionError,
  identityProjectionError,
} from '../auth/identity-projection-error';
import { DatabaseError } from './database-error';

/** Restore Guardian's closed projection vocabulary after the database boundary. */
export function asIdentityProjectionError(error: unknown): unknown {
  if (!(error instanceof DatabaseError)) return error;
  switch (error.code) {
    case 'DATABASE_NOT_READY':
      return identityProjectionError('IDENTITY_PROJECTION_NOT_READY', { cause: error });
    case 'DATABASE_CONFLICT':
      return identityProjectionError('IDENTITY_PROJECTION_CONFLICT', { cause: error });
    case 'DATABASE_SCHEMA_MISMATCH':
      return identityProjectionError('IDENTITY_PROJECTION_SCHEMA_INVALID', { cause: error });
    case 'DATABASE_AUTHORITY_CHANGED':
      // The actor's final-edge Guardian fence uses this code when authority
      // changes after admission but before commit. The transaction is rolled
      // back and the delivery is safe to release for reconciliation retry.
      return identityProjectionError('IDENTITY_PROJECTION_NOT_READY', { cause: error });
    default:
      return error;
  }
}

/** Close projection failures into the database actor's stable error vocabulary. */
export function asDatabaseProjectionError(error: unknown): DatabaseError {
  if (!(error instanceof IdentityProjectionError)) {
    return new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'Database identity projection failed.',
      { cause: error, retryable: false, outcome: 'unknown' },
    );
  }
  switch (error.code) {
    case 'IDENTITY_PROJECTION_NOT_READY':
    case 'IDENTITY_PROJECTION_LEASE_LOST':
      return new DatabaseError('DATABASE_NOT_READY', 'Identity anchor is not ready.', {
        cause: error,
        retryable: true,
        outcome: 'not-started',
      });
    case 'IDENTITY_PROJECTION_CONFLICT':
    case 'IDENTITY_PROJECTION_QUARANTINED':
      return new DatabaseError('DATABASE_CONFLICT', 'Identity anchor conflicted.', {
        cause: error,
        retryable: false,
        outcome: 'not-committed',
      });
    case 'IDENTITY_PROJECTION_SCHEMA_INVALID':
      return new DatabaseError('DATABASE_SCHEMA_MISMATCH', 'Identity anchor schema is invalid.', {
        cause: error,
        retryable: false,
        outcome: 'not-started',
      });
    case 'IDENTITY_PROJECTION_TARGET_MISMATCH':
      // Keep a durable target-binding mismatch distinct from the transient
      // final-edge authority race above. It is a permanent binding/schema
      // incompatibility and must not be retried against the same file.
      return new DatabaseError('DATABASE_SCHEMA_MISMATCH', 'Identity anchor binding changed.', {
        cause: error,
        retryable: false,
        outcome: 'not-started',
      });
  }
}
