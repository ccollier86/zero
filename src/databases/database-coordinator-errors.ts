/**
 * Privacy-safe error boundary for coordinator capabilities.
 *
 * Executor causes, arbitrary messages, filesystem paths, SQL, and unknown
 * detail strings must never cross this boundary.
 */

import {
  DATABASE_ERROR_DETAILS_MAX_ENTRIES,
  DatabaseError,
  normalizeDatabaseError,
  type DatabaseErrorCode,
  type DatabaseErrorDetails,
} from './database-error';
import {
  summarizeDatabaseFailureCodes,
} from './database-failure-code-summary';
import { DATABASE_OBSERVABILITY_COUNT_MAX } from './database-capacity';

const MAX_OBSERVED_DURATION_MS = 604_800_000;

const SAFE_COORDINATOR_MESSAGES = Object.freeze({
  DATABASE_CONFIG_INVALID: 'Database configuration is invalid.',
  DATABASE_DISABLED: 'Database support is disabled.',
  DATABASE_NOT_READY: 'Database binding is unavailable.',
  DATABASE_CLOSED: 'Database coordinator is not accepting work.',
  DATABASE_BACKPRESSURE: 'Database capacity is exhausted.',
  DATABASE_CAPACITY_EXHAUSTED: 'Database permanent capacity is exhausted.',
  DATABASE_QUEUE_TIMEOUT: 'Database operation expired before execution.',
  DATABASE_OPERATION_TIMEOUT: 'Database operation timed out.',
  DATABASE_EXECUTOR_START_FAILED: 'Database executor could not start.',
  DATABASE_EXECUTOR_FAILED: 'Database executor failed.',
  DATABASE_PROTOCOL_ERROR: 'Invalid database executor response.',
  DATABASE_OPEN_FAILED: 'Database could not be opened.',
  DATABASE_MIGRATION_FAILED: 'Database migration failed.',
  DATABASE_SCHEMA_MISMATCH: 'Database schema does not match its realm.',
  DATABASE_AUTHORITY_CHANGED: 'Database authority changed.',
  DATABASE_CONFLICT: 'Database operation conflicts with current state.',
  DATABASE_HISTORY_GAP: 'Database change history is unavailable.',
  DATABASE_PAYLOAD_INVALID: 'Database operation payload is invalid.',
  DATABASE_PAYLOAD_LIMIT: 'Database operation payload exceeds its limit.',
  DATABASE_RESULT_LIMIT: 'Database operation result exceeds its limit.',
  DATABASE_OPERATION_UNSUPPORTED: 'Database operation is unsupported.',
  DATABASE_TRANSACTION_EXPIRED: 'Database transaction expired.',
  DATABASE_TRANSACTION_STALE: 'Database snapshot is behind the required sequence.',
  DATABASE_OUTCOME_UNKNOWN: 'Database operation outcome is unknown.',
} satisfies Record<DatabaseErrorCode, string>);

const SAFE_COORDINATOR_DETAIL_KEYS = new Set([
  'activeOperations',
  'assertionIndex',
  'durationMs',
  'generation',
  'maxDatabaseFiles',
  'maxDatabases',
  'maxInFlight',
  'maxTenantSyncBindingsPerDatabase',
  'maxTenantSyncDatabases',
  'queueDepth',
  'queueLimit',
  'slot',
  'retryWithSameKeyOnly',
]);

const SAFE_COORDINATOR_CONFLICT_TYPES = new Set([
  'cas',
  'idempotency-key-reused',
  'primary-key',
  'constraint',
]);

const SAFE_COORDINATOR_SNAPSHOT_REASONS = new Set([
  'bytes',
  'cursor',
  'deadline',
  'missing',
  'row-bytes',
  'row-nodes',
  'rows',
  'sessions',
]);

const SAFE_COORDINATOR_CAPACITY_TYPES = new Set(['files', 'receipts']);

export function safeCoordinatorError(value: unknown): DatabaseError {
  const source = normalizeDatabaseError(value);
  const details: Record<string, string | number | boolean | null> = {};
  if (source.code === 'DATABASE_CAPACITY_EXHAUSTED'
    && typeof source.details.capacityType === 'string'
    && SAFE_COORDINATOR_CAPACITY_TYPES.has(source.details.capacityType)
    && Number.isSafeInteger(source.details.capacityLimit)
    && (source.details.capacityLimit as number) > 0) {
    details.capacityType = source.details.capacityType;
    details.capacityLimit = source.details.capacityLimit as number;
  }
  for (const [key, detail] of Object.entries(source.details)) {
    if (key === 'conflictType'
      && typeof detail === 'string'
      && SAFE_COORDINATOR_CONFLICT_TYPES.has(detail)) {
      details[key] = detail;
      continue;
    }
    if (key === 'receiptState' && detail === 'expired') {
      details[key] = detail;
      continue;
    }
    if (key === 'snapshotReason'
      && typeof detail === 'string'
      && SAFE_COORDINATOR_SNAPSHOT_REASONS.has(detail)) {
      details[key] = detail;
      continue;
    }
    if (source.code === 'DATABASE_PAYLOAD_LIMIT'
      && source.outcome === 'not-committed'
      && key === 'reason'
      && detail === 'max-bytes') {
      details.reason = 'max-bytes';
      continue;
    }
    if (!SAFE_COORDINATOR_DETAIL_KEYS.has(key)
      || (typeof detail !== 'number'
        && typeof detail !== 'boolean'
        && detail !== null)) continue;
    details[key] = detail;
  }
  return new DatabaseError(
    source.code,
    SAFE_COORDINATOR_MESSAGES[source.code],
    {
      retryable: source.retryable,
      outcome: source.outcome,
      details: details as DatabaseErrorDetails,
    },
  );
}

export type CoordinatorAggregateCloseDetails = DatabaseErrorDetails & Readonly<{
  readonly failedCloseCount: number;
  readonly remainingEntryCount: number;
  readonly quarantinedSlotCount: number;
  readonly availableSlotCount: number;
  readonly failureCodeSummary?: string;
}>;

/** Build bounded aggregate close details without retaining raw failure causes. */
export function coordinatorAggregateCloseDetails(input: Readonly<{
  failures: readonly unknown[];
  remainingEntryCount: number;
  quarantinedSlotCount: number;
  availableSlotCount: number;
}>): CoordinatorAggregateCloseDetails {
  const failureCodeSummary = summarizeDatabaseFailureCodes(input.failures);
  return Object.freeze({
    failedCloseCount: boundedAggregateCount(input.failures.length),
    remainingEntryCount: boundedAggregateCount(input.remainingEntryCount),
    quarantinedSlotCount: boundedAggregateCount(input.quarantinedSlotCount),
    availableSlotCount: boundedAggregateCount(input.availableSlotCount),
    ...(failureCodeSummary ? { failureCodeSummary } : {}),
  });
}

function boundedAggregateCount(value: number): number {
  return Math.max(
    0,
    Math.min(DATABASE_OBSERVABILITY_COUNT_MAX, Math.trunc(value)),
  );
}

/** Identify the one privacy-safe hot image capacity operation failure. */
export function isHotMaxBytesFailure(error: DatabaseError): boolean {
  return error.code === 'DATABASE_PAYLOAD_LIMIT'
    && error.outcome === 'not-committed'
    && error.details.reason === 'max-bytes';
}

export function permanentCapacityDetails(error: DatabaseError): Readonly<{
  capacityType: 'files' | 'receipts';
  capacityLimit: number;
}> | null {
  if (error.code !== 'DATABASE_CAPACITY_EXHAUSTED'
    || (error.details.capacityType !== 'files'
      && error.details.capacityType !== 'receipts')
    || !Number.isSafeInteger(error.details.capacityLimit)
    || (error.details.capacityLimit as number) <= 0) {
    return null;
  }
  return Object.freeze({
    capacityType: error.details.capacityType,
    capacityLimit: error.details.capacityLimit as number,
  });
}

/** A tombstone is an exact actor result, not an uncertain actor settlement. */
export function isExpiredReceiptOutcome(error: DatabaseError): boolean {
  return error.code === 'DATABASE_OUTCOME_UNKNOWN'
    && error.outcome === 'unknown'
    && error.details.receiptState === 'expired';
}

/** Build a bounded, correlation-safe missing replay range for telemetry only. */
export function historyGapSequenceRange(
  value: unknown,
  requestedAfterSeq: number,
): Readonly<{ sequenceStart: number; sequenceEnd: number }> | null {
  const source = normalizeDatabaseError(value);
  if (source.code !== 'DATABASE_HISTORY_GAP') return null;

  const sequenceStart = requestedAfterSeq < Number.MAX_SAFE_INTEGER
    ? requestedAfterSeq + 1
    : requestedAfterSeq;
  const reportedAfterSeq = source.details.afterSeq;
  const reportedCurrentSeq = source.details.currentSeq;
  const correlated = reportedAfterSeq === undefined
    || reportedAfterSeq === requestedAfterSeq;
  const sequenceEnd = correlated
    && Number.isSafeInteger(reportedCurrentSeq)
    && (reportedCurrentSeq as number) >= sequenceStart
    ? reportedCurrentSeq as number
    : sequenceStart;
  return Object.freeze({ sequenceStart, sequenceEnd });
}

export function sameKeyOnlyUnknownWrite(error: DatabaseError): DatabaseError {
  const entries = Object.entries(error.details);
  const details = Object.fromEntries([
    ...entries.slice(0, DATABASE_ERROR_DETAILS_MAX_ENTRIES - 1),
    ['retryWithSameKeyOnly', true],
  ]) as DatabaseErrorDetails;
  return new DatabaseError(error.code, error.message, {
    cause: error,
    retryable: false,
    outcome: 'unknown',
    details,
  });
}

export function queueCancelled(): DatabaseError {
  return new DatabaseError(
    'DATABASE_QUEUE_TIMEOUT',
    'Database operation was cancelled before execution.',
    { retryable: true, outcome: 'not-started' },
  );
}

export function authorityUnavailable(): DatabaseError {
  return new DatabaseError(
    'DATABASE_AUTHORITY_CHANGED',
    'Database commit authority is unavailable.',
    { retryable: false, outcome: 'not-started' },
  );
}

export function isPermanentOpenFailure(error: DatabaseError): boolean {
  return (error.code === 'DATABASE_OPEN_FAILED'
      && error.retryable === false
      && error.outcome === 'not-started')
    || error.code === 'DATABASE_CONFIG_INVALID'
    || error.code === 'DATABASE_MIGRATION_FAILED'
    || error.code === 'DATABASE_SCHEMA_MISMATCH'
    || error.code === 'DATABASE_PROTOCOL_ERROR'
    || error.code === 'DATABASE_OPERATION_UNSUPPORTED';
}

export function elapsed(startedAt: number, endedAt: number): number {
  return Math.max(0, Math.min(MAX_OBSERVED_DURATION_MS, endedAt - startedAt));
}
