/**
 * database-actor-error-boundary.ts
 *
 * Privacy-safe normalization for the actor process boundary. This module is
 * the only place which translates actor-local failures and details into the
 * closed public DatabaseError vocabulary.
 */

import {
  DatabaseError,
  isDatabaseError,
  normalizeDatabaseError,
  type DatabaseErrorCode,
  type DatabaseErrorDetails,
} from './database-error';
import type { DatabaseExecutorValue } from './database-executor';
import { isDatabaseExecutorValue } from './database-executor-validation';

/** Build the fixed protocol error used for an invalid actor result. */
export function invalidActorResult(): DatabaseError {
  return new DatabaseError(
    'DATABASE_PROTOCOL_ERROR',
    'Database actor returned an invalid result.',
    { retryable: false, outcome: 'unknown' },
  );
}

/** Require a response value to fit the portable executor contract. */
export function asExecutorValue(value: unknown): DatabaseExecutorValue {
  if (!isDatabaseExecutorValue(value)) throw invalidActorResult();
  return value;
}

/** Convert bind-result validation failures into the actor result vocabulary. */
export function validateBindResult<T>(validate: () => T): T {
  try {
    return validate();
  } catch (error) {
    const normalized = isDatabaseError(error)
      ? normalizeDatabaseError(error)
      : null;
    if (normalized?.code === 'DATABASE_PAYLOAD_LIMIT') {
      throw new DatabaseError(
        'DATABASE_RESULT_LIMIT',
        'Database actor result is outside the supported contract.',
        { retryable: false, outcome: 'unknown' },
      );
    }
    throw invalidActorResult();
  }
}

/** Normalize a writer-open failure while retaining only a safe SQLite code. */
export function writerOpenFailed(error: unknown): DatabaseError {
  const sqliteCode = safeSQLiteCode(error);
  return new DatabaseError(
    'DATABASE_OPEN_FAILED',
    'Database writer actor could not open the database.',
    {
      cause: error,
      retryable: true,
      outcome: 'not-started',
      details: Object.freeze({
        phase: 'open',
        ...(sqliteCode === null ? {} : { sqliteCode }),
      }),
    },
  );
}

/** Remove paths, identifiers, SQL, values, and raw messages at actor egress. */
export function privacySafeActorError(error: unknown): DatabaseError {
  if (!isDatabaseError(error)) {
    return new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'Database actor operation failed.',
      { retryable: false, outcome: 'unknown' },
    );
  }
  const normalized = normalizeDatabaseError(error);
  return new DatabaseError(normalized.code, safeActorMessage(normalized.code), {
    retryable: normalized.retryable,
    outcome: normalized.outcome,
    details: safeActorDetails(normalized.code, normalized.details),
  });
}

function safeSQLiteCode(error: unknown): string | null {
  try {
    if (typeof error !== 'object' || error === null) return null;
    let cursor: object | null = error;
    for (let depth = 0; cursor && depth < 4; depth += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(cursor, 'code');
      if (descriptor) {
        return 'value' in descriptor
          && typeof descriptor.value === 'string'
          && /^SQLITE_[A-Z0-9_]{1,64}$/u.test(descriptor.value)
          ? descriptor.value
          : null;
      }
      cursor = Object.getPrototypeOf(cursor) as object | null;
    }
  } catch {
    // Hostile proxy traps and exotic prototypes cannot escape this boundary.
  }
  return null;
}

function safeActorMessage(code: DatabaseErrorCode): string {
  switch (code) {
    case 'DATABASE_CONFIG_INVALID':
      return 'Database actor configuration is invalid.';
    case 'DATABASE_DISABLED':
      return 'Database actor is disabled.';
    case 'DATABASE_NOT_READY':
      return 'Database actor is not ready.';
    case 'DATABASE_CLOSED':
      return 'Database actor is closed.';
    case 'DATABASE_BACKPRESSURE':
    case 'DATABASE_QUEUE_TIMEOUT':
      return 'Database actor capacity is unavailable.';
    case 'DATABASE_CAPACITY_EXHAUSTED':
      return 'Database actor permanent capacity is exhausted.';
    case 'DATABASE_OPERATION_TIMEOUT':
      return 'Database actor operation timed out.';
    case 'DATABASE_EXECUTOR_START_FAILED':
    case 'DATABASE_OPEN_FAILED':
      return 'Database actor could not open its database.';
    case 'DATABASE_MIGRATION_FAILED':
      return 'Database actor migration failed.';
    case 'DATABASE_SCHEMA_MISMATCH':
      return 'Database actor schema does not match its realm.';
    case 'DATABASE_AUTHORITY_CHANGED':
      return 'Database actor capability changed.';
    case 'DATABASE_CONFLICT':
      return 'Database operation conflicted.';
    case 'DATABASE_HISTORY_GAP':
      return 'Database change history cannot satisfy the requested cursor.';
    case 'DATABASE_PAYLOAD_INVALID':
    case 'DATABASE_PAYLOAD_LIMIT':
      return 'Database actor request is invalid.';
    case 'DATABASE_RESULT_LIMIT':
      return 'Database actor result is outside the supported contract.';
    case 'DATABASE_OPERATION_UNSUPPORTED':
      return 'Database actor operation is unsupported.';
    case 'DATABASE_TRANSACTION_EXPIRED':
    case 'DATABASE_TRANSACTION_STALE':
      return 'Database operation snapshot is unavailable.';
    case 'DATABASE_PROTOCOL_ERROR':
      return 'Database actor protocol validation failed.';
    case 'DATABASE_OUTCOME_UNKNOWN':
      return 'Database operation outcome is unknown.';
    case 'DATABASE_EXECUTOR_FAILED':
      return 'Database actor operation failed.';
  }
}

function safeActorDetails(
  code: DatabaseErrorCode,
  details: DatabaseErrorDetails,
): DatabaseErrorDetails | undefined {
  if (code === 'DATABASE_OPEN_FAILED') {
    const result: Record<string, string> = {};
    if (details.phase === 'open'
      || details.phase === 'configure'
      || details.phase === 'identity'
      || details.phase === 'schema'
      || details.phase === 'sequence'
      || details.phase === 'schema-version') {
      result.phase = details.phase;
    }
    if (typeof details.sqliteCode === 'string'
      && /^SQLITE_[A-Z0-9_]{1,64}$/u.test(details.sqliteCode)) {
      result.sqliteCode = details.sqliteCode;
    }
    return Object.keys(result).length === 0 ? undefined : Object.freeze(result);
  }
  if (code === 'DATABASE_CONFLICT') {
    const result: Record<string, string | number> = {};
    if (details.conflictType === 'cas'
      || details.conflictType === 'idempotency-key-reused'
      || details.conflictType === 'primary-key'
      || details.conflictType === 'constraint') {
      result.conflictType = details.conflictType;
    }
    if (isNonNegativeSafeInteger(details.assertionIndex)) {
      result.assertionIndex = details.assertionIndex;
    }
    return Object.keys(result).length === 0 ? undefined : Object.freeze(result);
  }
  if (code === 'DATABASE_OUTCOME_UNKNOWN'
    && details.receiptState === 'expired') {
    return Object.freeze({ receiptState: 'expired' });
  }
  if (code === 'DATABASE_CAPACITY_EXHAUSTED'
    && (details.capacityType === 'files'
      || details.capacityType === 'receipts')
    && Number.isSafeInteger(details.capacityLimit)
    && (details.capacityLimit as number) > 0) {
    return Object.freeze({
      capacityType: details.capacityType,
      capacityLimit: details.capacityLimit as number,
    });
  }
  if (code === 'DATABASE_PAYLOAD_LIMIT' && details.reason === 'max-bytes') {
    return Object.freeze({ reason: 'max-bytes' });
  }
  if ((code === 'DATABASE_BACKPRESSURE'
      || code === 'DATABASE_PAYLOAD_LIMIT'
      || code === 'DATABASE_TRANSACTION_EXPIRED')
    && isSafeSnapshotReason(details.snapshotReason)) {
    return Object.freeze({ snapshotReason: details.snapshotReason });
  }
  const allowed = code === 'DATABASE_HISTORY_GAP'
    ? new Set(['afterSeq', 'currentSeq'])
    : code === 'DATABASE_TRANSACTION_STALE' || code === 'DATABASE_NOT_READY'
      ? new Set(['currentSeq', 'requiredSeq', 'minSeq'])
      : null;
  if (!allowed) return undefined;
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(details)) {
    if (allowed.has(key) && isNonNegativeSafeInteger(value)) result[key] = value;
  }
  return Object.keys(result).length === 0 ? undefined : Object.freeze(result);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isSafeSnapshotReason(value: unknown): value is string {
  return value === 'bytes'
    || value === 'cursor'
    || value === 'deadline'
    || value === 'missing'
    || value === 'row-bytes'
    || value === 'row-nodes'
    || value === 'rows'
    || value === 'sessions';
}
