/** Action-correlated result validation for the private automation actor protocol. */

import {
  DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_BYTES,
  DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_RECORDS,
  DATABASE_AUTOMATION_OUTBOX_MAX_STORED_RECORDS,
  type ClaimedDatabaseAutomationDelivery,
  type DatabaseAutomationOutboxCounts,
  type DatabaseAutomationOutboxRecoveryResult,
} from '../database-automations/automation-outbox-contracts';
import { parseDatabaseAutomationActorClaim } from './database-automation-actor-delivery-validation';
import type {
  DatabaseActorAutomationOutboxPayload,
  DatabaseActorAutomationOutboxResult,
  DatabaseActorAutomationOutboxResultFor,
} from './database-automation-actor-protocol-contracts';
import {
  assertDatabaseAutomationActorFields,
  databaseAutomationActorProtocolError,
  databaseAutomationActorRecord,
  parseDatabaseAutomationActorCount,
} from './database-automation-actor-protocol-validation';

const RECOVERY_FIELDS = new Set(['requeued', 'dead']);
const COUNTS_FIELDS = new Set([
  'totalRecords',
  'activeRecords',
  'activeBytes',
  'pendingRecords',
  'processingRecords',
  'completedRecords',
  'deadRecords',
]);

/** Validate and correlate one actor response with its already-validated request. */
export function validateDatabaseActorAutomationOutboxResult<
  TPayload extends DatabaseActorAutomationOutboxPayload,
>(
  payload: TPayload,
  value: unknown,
): DatabaseActorAutomationOutboxResultFor<TPayload> {
  try {
    const result = parseResult(payload, value);
    return result as DatabaseActorAutomationOutboxResultFor<TPayload>;
  } catch {
    throw databaseAutomationActorProtocolError();
  }
}

function parseResult(
  payload: DatabaseActorAutomationOutboxPayload,
  value: unknown,
): DatabaseActorAutomationOutboxResult {
  switch (payload.action) {
    case 'claim':
    case 'renew':
      return parseClaimResult(payload, value);
    case 'complete':
      return parseClosedStatus(value, ['completed', 'stale'] as const);
    case 'retry':
      return parseClosedStatus(value, ['pending', 'dead', 'stale'] as const);
    case 'dead':
      return parseClosedStatus(value, ['dead', 'stale'] as const);
    case 'recover-expired':
      return parseRecoveryResult(value);
    case 'counts':
      return parseCountsResult(value);
  }
}

function parseClaimResult(
  payload: Extract<
    DatabaseActorAutomationOutboxPayload,
    { readonly action: 'claim' | 'renew' }
  >,
  value: unknown,
): ClaimedDatabaseAutomationDelivery | null {
  if (value === null) return null;
  const claim = parseDatabaseAutomationActorClaim(value);
  if (payload.action === 'claim') {
    if (claim.leaseOwner !== payload.leaseOwner
      || claim.availableAt > payload.now
      || claim.updatedAt < payload.now
      || claim.leaseExpiresAt !== claim.updatedAt + payload.leaseMs) {
      throw new TypeError('uncorrelated claim result');
    }
    return claim;
  }

  const expectedUpdatedAt = Math.max(payload.now, payload.lease.updatedAt);
  if (claim.deliveryId !== payload.lease.deliveryId
    || claim.leaseOwner !== payload.lease.leaseOwner
    || claim.leaseToken !== payload.lease.leaseToken
    || claim.updatedAt !== expectedUpdatedAt
    || claim.leaseExpiresAt !== expectedUpdatedAt + payload.leaseMs) {
    throw new TypeError('uncorrelated renewal result');
  }
  return claim;
}

function parseClosedStatus<TStatus extends string>(
  value: unknown,
  allowed: readonly TStatus[],
): TStatus {
  if (typeof value !== 'string' || !allowed.includes(value as TStatus)) {
    throw new TypeError('invalid lifecycle result');
  }
  return value as TStatus;
}

function parseRecoveryResult(
  value: unknown,
): DatabaseAutomationOutboxRecoveryResult {
  const record = databaseAutomationActorRecord(value);
  assertDatabaseAutomationActorFields(record, RECOVERY_FIELDS);
  const requeued = parseDatabaseAutomationActorCount(
    record.requeued,
    DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_RECORDS,
  );
  const dead = parseDatabaseAutomationActorCount(
    record.dead,
    DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_RECORDS,
  );
  if (requeued + dead > DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_RECORDS) {
    throw new TypeError('invalid recovery accounting');
  }
  return Object.freeze({ requeued, dead });
}

function parseCountsResult(value: unknown): DatabaseAutomationOutboxCounts {
  const record = databaseAutomationActorRecord(value);
  assertDatabaseAutomationActorFields(record, COUNTS_FIELDS);
  const totalRecords = parseDatabaseAutomationActorCount(
    record.totalRecords,
    DATABASE_AUTOMATION_OUTBOX_MAX_STORED_RECORDS,
  );
  const activeRecords = parseDatabaseAutomationActorCount(
    record.activeRecords,
    DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_RECORDS,
  );
  const activeBytes = parseDatabaseAutomationActorCount(
    record.activeBytes,
    DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_BYTES,
  );
  const pendingRecords = parseDatabaseAutomationActorCount(
    record.pendingRecords,
    DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_RECORDS,
  );
  const processingRecords = parseDatabaseAutomationActorCount(
    record.processingRecords,
    DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_RECORDS,
  );
  const completedRecords = parseDatabaseAutomationActorCount(
    record.completedRecords,
    DATABASE_AUTOMATION_OUTBOX_MAX_STORED_RECORDS,
  );
  const deadRecords = parseDatabaseAutomationActorCount(
    record.deadRecords,
    DATABASE_AUTOMATION_OUTBOX_MAX_STORED_RECORDS,
  );
  if (pendingRecords + processingRecords !== activeRecords
    || activeRecords + completedRecords + deadRecords !== totalRecords) {
    throw new TypeError('invalid outbox accounting');
  }
  return Object.freeze({
    totalRecords,
    activeRecords,
    activeBytes,
    pendingRecords,
    processingRecords,
    completedRecords,
    deadRecords,
  });
}
