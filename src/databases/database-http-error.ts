/**
 * Privacy-safe HTTP classification for actor-backed database failures.
 *
 * This adapter deliberately exposes only stable database codes and broad HTTP
 * categories. It must never forward executor messages, paths, database ids,
 * tenant ids, SQL, bind values, or actor details to an HTTP response.
 */

import {
  normalizeDatabaseError,
  type DatabaseCapacityType,
  type DatabaseErrorCode,
  type DatabaseOperationOutcome,
} from './database-error';

export type DatabaseHttpOperationKind = 'read' | 'write';
export type DatabaseHttpCapacityType = DatabaseCapacityType;

export type DatabaseHttpConflictType =
  | 'cas'
  | 'idempotency-key-reused'
  | 'primary-key'
  | 'constraint';

export type DatabaseHttpFailureKind =
  | 'authority'
  | 'invalid'
  | 'conflict'
  | 'capacity'
  | 'unavailable'
  | 'write-outcome-unknown';

export interface DatabaseHttpFailureClassification {
  readonly status: 400 | 403 | 409 | 503;
  readonly kind: DatabaseHttpFailureKind;
  readonly databaseCode: DatabaseErrorCode;
  readonly outcome: DatabaseOperationOutcome | null;
  readonly retryable: boolean;
  /** Validated, privacy-safe subtype present only for database conflicts. */
  readonly conflictType?: DatabaseHttpConflictType;
  /** Validated permanent-capacity dimension; no identifiers or paths. */
  readonly capacityType?: DatabaseCapacityType;
  /** Validated positive aggregate limit for operator/client diagnostics. */
  readonly capacityLimit?: number;
  /** Exact permanent receipt state; never contains a key or fingerprint. */
  readonly receiptState?: 'expired';
}

/** Classify a database failure without reflecting its possibly-sensitive text. */
export function classifyDatabaseHttpFailure(
  error: unknown,
  operation: DatabaseHttpOperationKind,
): DatabaseHttpFailureClassification {
  const databaseError = normalizeDatabaseError(error);
  const common = {
    databaseCode: databaseError.code,
    outcome: databaseError.outcome,
    retryable: databaseError.retryable,
    ...safeReceiptState(databaseError.details.receiptState),
  } as const;

  if (databaseError.code === 'DATABASE_AUTHORITY_CHANGED') {
    return { ...common, status: 403, kind: 'authority' };
  }
  if (operation === 'write' && databaseError.outcome === 'unknown') {
    return { ...common, status: 503, kind: 'write-outcome-unknown' };
  }

  switch (databaseError.code) {
    case 'DATABASE_CAPACITY_EXHAUSTED':
      return {
        ...common,
        status: 503,
        kind: 'capacity',
        ...safeCapacityDetails(
          databaseError.details.capacityType,
          databaseError.details.capacityLimit,
        ),
      };
    case 'DATABASE_PAYLOAD_INVALID':
    case 'DATABASE_PAYLOAD_LIMIT':
    case 'DATABASE_RESULT_LIMIT':
    case 'DATABASE_OPERATION_UNSUPPORTED':
      return { ...common, status: 400, kind: 'invalid' };
    case 'DATABASE_CONFLICT':
      return {
        ...common,
        status: 409,
        kind: 'conflict',
        ...safeConflictType(databaseError.details.conflictType),
      };
    default:
      // Configuration, availability, lifecycle, actor, protocol, open,
      // migration, schema, history, and transaction failures are all an
      // unavailable backend from an HTTP caller's perspective. The stable
      // databaseCode remains available to server observability only.
      return { ...common, status: 503, kind: 'unavailable' };
  }
}

function safeCapacityDetails(
  type: unknown,
  limit: unknown,
): Readonly<{
  capacityType?: DatabaseCapacityType;
  capacityLimit?: number;
}> {
  const result: { capacityType?: DatabaseCapacityType; capacityLimit?: number } = {};
  if (type === 'files' || type === 'receipts') result.capacityType = type;
  if (Number.isSafeInteger(limit) && (limit as number) > 0) {
    result.capacityLimit = limit as number;
  }
  return result;
}

function safeReceiptState(
  value: unknown,
): Readonly<{ receiptState?: 'expired' }> {
  return value === 'expired' ? { receiptState: value } : {};
}

function safeConflictType(
  value: unknown,
): Readonly<{ conflictType?: DatabaseHttpConflictType }> {
  switch (value) {
    case 'cas':
    case 'idempotency-key-reused':
    case 'primary-key':
    case 'constraint':
      return { conflictType: value };
    default:
      return {};
  }
}
