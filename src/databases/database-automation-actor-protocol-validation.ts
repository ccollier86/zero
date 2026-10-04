/** Shared strict validators for the private database-automation actor protocol. */

import type { DatabaseAutomationDeliveryLease } from '../database-automations/automation-outbox-contracts';
import { isDatabaseAutomationErrorCode } from '../database-automations/automation-outbox-codec';
import { DatabaseError } from './database-error';
import { normalizeDatabaseRef, type DatabaseRef } from './database-file';
import {
  databaseOperationRecord,
  type DatabaseOperationRecord,
} from './database-operation-payload';
import {
  DATABASE_AUTOMATION_OUTBOX_MAX_LEASE_MS,
  DATABASE_AUTOMATION_OUTBOX_MIN_LEASE_MS,
} from '../database-automations/automation-outbox-contracts';

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,191}$/u;
const LEASE_FIELDS = new Set([
  'deliveryId',
  'leaseOwner',
  'leaseToken',
  'updatedAt',
]);

/** Inspect a plain data object without invoking accessors or accepting proxies. */
export function databaseAutomationActorRecord(
  value: unknown,
): DatabaseOperationRecord {
  return databaseOperationRecord(value);
}

/** Require an exact set of enumerable data fields. */
export function assertDatabaseAutomationActorFields(
  record: DatabaseOperationRecord,
  expected: ReadonlySet<string>,
): void {
  const keys = Object.keys(record);
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
    throw new TypeError('invalid fields');
  }
}

/** Parse one opaque database routing reference. */
export function parseDatabaseAutomationActorRef(value: unknown): DatabaseRef {
  return normalizeDatabaseRef(value as string);
}

/** Parse one non-negative safe millisecond timestamp. */
export function parseDatabaseAutomationActorTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError('invalid timestamp');
  }
  return value as number;
}

/** Parse one safe non-negative aggregate counter. */
export function parseDatabaseAutomationActorCount(
  value: unknown,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value)
    || (value as number) < 0
    || (value as number) > maximum) {
    throw new TypeError('invalid count');
  }
  return value as number;
}

/** Parse an outbox lease duration and reject timestamp overflow up front. */
export function parseDatabaseAutomationActorLeaseMs(
  value: unknown,
  timestamp: number,
): number {
  if (!Number.isSafeInteger(value)
    || (value as number) < DATABASE_AUTOMATION_OUTBOX_MIN_LEASE_MS
    || (value as number) > DATABASE_AUTOMATION_OUTBOX_MAX_LEASE_MS
    || timestamp > Number.MAX_SAFE_INTEGER - (value as number)) {
    throw new TypeError('invalid lease duration');
  }
  return value as number;
}

/** Parse one persisted low-cardinality error code. */
export function parseDatabaseAutomationActorErrorCode(value: unknown): string {
  if (!isDatabaseAutomationErrorCode(value)) {
    throw new TypeError('invalid error code');
  }
  return value;
}

/** Parse and detach the minimal lifecycle fence sent after a successful claim. */
export function parseDatabaseAutomationActorLease(
  value: unknown,
): DatabaseAutomationDeliveryLease {
  const record = databaseAutomationActorRecord(value);
  assertDatabaseAutomationActorFields(record, LEASE_FIELDS);
  return Object.freeze({
    deliveryId: parseDatabaseAutomationActorOpaqueId(record.deliveryId),
    leaseOwner: parseDatabaseAutomationActorOpaqueId(record.leaseOwner),
    leaseToken: parseDatabaseAutomationActorOpaqueId(record.leaseToken),
    updatedAt: parseDatabaseAutomationActorTimestamp(record.updatedAt),
  });
}

/** Parse one bounded opaque outbox identity or lease value. */
export function parseDatabaseAutomationActorOpaqueId(value: unknown): string {
  if (typeof value !== 'string' || !OPAQUE_ID_PATTERN.test(value)) {
    throw new TypeError('invalid opaque identity');
  }
  return value;
}

/** Stable privacy-safe request failure for this private protocol. */
export function databaseAutomationActorPayloadInvalid(): DatabaseError {
  return new DatabaseError(
    'DATABASE_PAYLOAD_INVALID',
    'Database automation actor payload is invalid.',
  );
}

/** Stable privacy-safe response failure for this private protocol. */
export function databaseAutomationActorProtocolError(): DatabaseError {
  return new DatabaseError(
    'DATABASE_PROTOCOL_ERROR',
    'Database actor returned an invalid automation outbox result.',
    { retryable: false, outcome: 'unknown' },
  );
}
