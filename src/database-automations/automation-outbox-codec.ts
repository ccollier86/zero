/**
 * automation-outbox-codec.ts
 *
 * Validates and canonically encodes durable automation commands. It consumes
 * Zero's database payload boundary and Bun hashing, but never accesses SQLite.
 */

import {
  cloneDatabaseSerializableValue,
  isDatabaseRegistryName,
  isDatabaseTableName,
} from '../databases/database-operations';
import { DatabaseError, isDatabaseError } from '../databases/database-error';
import { REACTIVE_DB_ROW_ID_MAX_BYTES } from '../sync/row-identity';
import {
  DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_BYTES,
  DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_RECORDS,
  DATABASE_AUTOMATION_OUTBOX_MAX_ATTEMPTS,
  DATABASE_AUTOMATION_OUTBOX_MAX_PAYLOAD_BYTES,
  DATABASE_AUTOMATION_OUTBOX_MAX_STORED_RECORDS,
  DATABASE_AUTOMATION_OUTBOX_MAX_TERMINAL_RECORDS,
  type DatabaseAutomationOutboxEnqueueInput,
  type DatabaseAutomationOutboxLimits,
  type DatabaseAutomationSourceOperation,
} from './automation-outbox-contracts';
import type { DatabaseAutomationValue } from './database-function';

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,191}$/u;
const FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const DEFINITION_IDENTITY_PATTERN = /^(?:function|trigger):[a-z][a-z0-9._-]{0,127}@[1-9][0-9]*$/u;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/u;
const textEncoder = new TextEncoder();

/** Canonical values ready for one private outbox INSERT. */
export interface PreparedDatabaseAutomationOutboxCommand {
  readonly deliveryId: string;
  readonly invocationId: string;
  readonly triggerIdentity: string;
  readonly functionIdentity: string;
  readonly manifestFingerprint: string;
  readonly realmName: string;
  readonly realmFingerprint: string;
  readonly sourceSequence: number;
  readonly sourceTable: string;
  readonly sourceOperation: DatabaseAutomationSourceOperation;
  readonly sourceRowId: string;
  readonly payload: DatabaseAutomationValue;
  readonly payloadJson: string;
  readonly payloadBytes: number;
  readonly commandFingerprint: string;
  readonly availableAt: number;
  readonly createdAt: number;
}

/** Validate deployment limits without silently widening any hard maximum. */
export function validateDatabaseAutomationOutboxLimits(
  limits: DatabaseAutomationOutboxLimits,
): DatabaseAutomationOutboxLimits {
  const validated = {
    maxPayloadBytes: boundedInteger(
      limits.maxPayloadBytes,
      1,
      DATABASE_AUTOMATION_OUTBOX_MAX_PAYLOAD_BYTES,
      'payload-byte',
    ),
    maxActiveRecords: boundedInteger(
      limits.maxActiveRecords,
      1,
      DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_RECORDS,
      'active-record',
    ),
    maxActiveBytes: boundedInteger(
      limits.maxActiveBytes,
      1,
      DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_BYTES,
      'active-byte',
    ),
    maxStoredRecords: boundedInteger(
      limits.maxStoredRecords,
      1,
      DATABASE_AUTOMATION_OUTBOX_MAX_STORED_RECORDS,
      'stored-record',
    ),
    maxTerminalRecords: boundedInteger(
      limits.maxTerminalRecords,
      0,
      DATABASE_AUTOMATION_OUTBOX_MAX_TERMINAL_RECORDS,
      'terminal-record',
    ),
    maxAttempts: boundedInteger(
      limits.maxAttempts,
      1,
      DATABASE_AUTOMATION_OUTBOX_MAX_ATTEMPTS,
      'attempt',
    ),
  };
  if (validated.maxStoredRecords
    < validated.maxActiveRecords + validated.maxTerminalRecords) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database automation outbox stored-record limit must cover active and terminal retention limits.',
    );
  }
  if (validated.maxActiveBytes < validated.maxPayloadBytes) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database automation outbox active-byte limit must cover one payload.',
    );
  }
  return Object.freeze(validated);
}

/** Validate, detach, encode, and fingerprint one durable invocation. */
export function prepareDatabaseAutomationOutboxCommand(
  input: DatabaseAutomationOutboxEnqueueInput,
  now: number,
): PreparedDatabaseAutomationOutboxCommand {
  assertSafeTimestamp(now, 'enqueue');
  assertOpaqueId(input.deliveryId, 'delivery');
  assertOpaqueId(input.invocationId, 'invocation');
  assertDefinitionIdentity(input.triggerIdentity, 'trigger');
  assertDefinitionIdentity(input.functionIdentity, 'function');
  assertDatabaseAutomationFingerprint(input.manifestFingerprint, 'manifest');
  assertDatabaseAutomationFingerprint(input.realmFingerprint, 'realm');
  if (!isDatabaseRegistryName(input.realmName)) {
    throw payloadInvalid('Database automation realm name is invalid.');
  }
  if (!Number.isSafeInteger(input.sourceSequence) || input.sourceSequence < 1) {
    throw payloadInvalid('Database automation source sequence is invalid.');
  }
  if (!isDatabaseTableName(input.sourceTable)) {
    throw payloadInvalid('Database automation source table is invalid.');
  }
  if (!isSourceOperation(input.sourceOperation)) {
    throw payloadInvalid('Database automation source operation is invalid.');
  }
  assertSourceRowId(input.sourceRowId);
  const availableAt = input.availableAt ?? now;
  assertSafeTimestamp(availableAt, 'availability');

  let payload: DatabaseAutomationValue;
  try {
    payload = cloneDatabaseSerializableValue(input.input) as DatabaseAutomationValue;
  } catch (cause) {
    if (isDatabaseError(cause)) throw cause;
    throw payloadInvalid('Database automation input is invalid.', cause);
  }
  const payloadJson = canonicalDatabaseAutomationJson(payload);
  const payloadBytes = textEncoder.encode(payloadJson).byteLength;
  if (payloadBytes > DATABASE_AUTOMATION_OUTBOX_MAX_PAYLOAD_BYTES) {
    throw new DatabaseError(
      'DATABASE_PAYLOAD_LIMIT',
      'Database automation input exceeds the supported byte limit.',
    );
  }

  const commandFingerprint = fingerprintDatabaseAutomationOutboxCommand({
    deliveryId: input.deliveryId,
    invocationId: input.invocationId,
    triggerIdentity: input.triggerIdentity,
    functionIdentity: input.functionIdentity,
    manifestFingerprint: input.manifestFingerprint,
    realmName: input.realmName,
    realmFingerprint: input.realmFingerprint,
    sourceSequence: input.sourceSequence,
    sourceTable: input.sourceTable,
    sourceOperation: input.sourceOperation,
    sourceRowId: input.sourceRowId,
    payload,
  });
  return Object.freeze({
    deliveryId: input.deliveryId,
    invocationId: input.invocationId,
    triggerIdentity: input.triggerIdentity,
    functionIdentity: input.functionIdentity,
    manifestFingerprint: input.manifestFingerprint,
    realmName: input.realmName,
    realmFingerprint: input.realmFingerprint,
    sourceSequence: input.sourceSequence,
    sourceTable: input.sourceTable,
    sourceOperation: input.sourceOperation,
    sourceRowId: input.sourceRowId,
    payload,
    payloadJson,
    payloadBytes,
    commandFingerprint,
    availableAt,
    createdAt: now,
  });
}

/** Parse a persisted active payload and require its exact canonical encoding. */
export function parseCanonicalDatabaseAutomationPayload(
  payloadJson: string,
  expectedBytes: number,
): DatabaseAutomationValue {
  try {
    if (textEncoder.encode(payloadJson).byteLength !== expectedBytes) {
      throw new TypeError('byte count differs');
    }
    const parsed = cloneDatabaseSerializableValue(
      JSON.parse(payloadJson),
    ) as DatabaseAutomationValue;
    if (canonicalDatabaseAutomationJson(parsed) !== payloadJson) {
      throw new TypeError('canonical representation differs');
    }
    return parsed;
  } catch (cause) {
    throw automationOutboxCorrupt(cause);
  }
}

/** Produce deterministic JSON by recursively sorting object keys. */
export function canonicalDatabaseAutomationJson(
  value: DatabaseAutomationValue,
): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalDatabaseAutomationJson).join(',')}]`;
  }
  const record = value as { readonly [key: string]: DatabaseAutomationValue };
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalDatabaseAutomationJson(record[key]!)}`
  ).join(',')}}`;
}

/** Validate a low-cardinality persisted delivery failure code. */
export function assertDatabaseAutomationErrorCode(value: string): void {
  if (!isDatabaseAutomationErrorCode(value)) {
    throw payloadInvalid('Database automation delivery error code is invalid.');
  }
}

/** Return true for persisted low-cardinality delivery failure codes. */
export function isDatabaseAutomationErrorCode(value: unknown): value is string {
  return typeof value === 'string' && ERROR_CODE_PATTERN.test(value);
}

/** Validate a worker identity without exposing it through a failure. */
export function assertDatabaseAutomationLeaseOwner(value: string): void {
  if (typeof value !== 'string' || !OPAQUE_ID_PATTERN.test(value)) {
    throw payloadInvalid('Database automation lease owner is invalid.');
  }
}

/** Validate one opaque lease fence without reflecting it through a failure. */
export function assertDatabaseAutomationLeaseToken(value: string): void {
  if (typeof value !== 'string' || !OPAQUE_ID_PATTERN.test(value)) {
    throw payloadInvalid('Database automation lease token is invalid.');
  }
}

/** Validate a non-negative millisecond timestamp. */
export function assertSafeTimestamp(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw payloadInvalid(`Database automation ${label} timestamp is invalid.`);
  }
}

/** Stable fail-closed error for private outbox state. */
export function automationOutboxCorrupt(cause?: unknown): DatabaseError {
  return new DatabaseError(
    'DATABASE_SCHEMA_MISMATCH',
    'Database automation outbox state is incompatible.',
    cause === undefined ? undefined : { cause },
  );
}

/** Recompute the immutable idempotency fingerprint for an active row. */
export function fingerprintDatabaseAutomationOutboxCommand(input: {
  readonly deliveryId: string;
  readonly invocationId: string;
  readonly triggerIdentity: string;
  readonly functionIdentity: string;
  readonly manifestFingerprint: string;
  readonly realmName: string;
  readonly realmFingerprint: string;
  readonly sourceSequence: number;
  readonly sourceTable: string;
  readonly sourceOperation: DatabaseAutomationSourceOperation;
  readonly sourceRowId: string;
  readonly payload: DatabaseAutomationValue;
}): string {
  const immutable: DatabaseAutomationValue = {
    contract: 'zero.database-automation-delivery.v1',
    deliveryId: input.deliveryId,
    invocationId: input.invocationId,
    triggerIdentity: input.triggerIdentity,
    functionIdentity: input.functionIdentity,
    manifestFingerprint: input.manifestFingerprint,
    realmName: input.realmName,
    realmFingerprint: input.realmFingerprint,
    sourceSequence: input.sourceSequence,
    sourceTable: input.sourceTable,
    sourceOperation: input.sourceOperation,
    sourceRowId: input.sourceRowId,
    payload: input.payload,
  };
  return sha256(canonicalDatabaseAutomationJson(immutable));
}

function assertOpaqueId(value: string, label: string): void {
  if (typeof value !== 'string' || !OPAQUE_ID_PATTERN.test(value)) {
    throw payloadInvalid(`Database automation ${label} identity is invalid.`);
  }
}

function assertDefinitionIdentity(value: string, kind: 'trigger' | 'function'): void {
  if (typeof value !== 'string'
    || value.length > 192
    || !DEFINITION_IDENTITY_PATTERN.test(value)
    || !value.startsWith(`${kind}:`)) {
    throw payloadInvalid(`Database automation ${kind} identity is invalid.`);
  }
}

/** Validate one SHA-256 deployment binding without reflecting its value. */
export function assertDatabaseAutomationFingerprint(
  value: string,
  label: 'manifest' | 'realm' = 'manifest',
): void {
  if (typeof value !== 'string' || !FINGERPRINT_PATTERN.test(value)) {
    throw payloadInvalid(`Database automation ${label} fingerprint is invalid.`);
  }
}

function assertSourceRowId(value: string): void {
  if (typeof value !== 'string'
    || value.length === 0
    || textEncoder.encode(value).byteLength > REACTIVE_DB_ROW_ID_MAX_BYTES) {
    throw payloadInvalid('Database automation source row identity is invalid.');
  }
}

function isSourceOperation(value: unknown): value is DatabaseAutomationSourceOperation {
  return value === 'insert' || value === 'update' || value === 'delete';
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      `Database automation outbox ${label} limit is invalid.`,
    );
  }
  return value;
}

function payloadInvalid(message: string, cause?: unknown): DatabaseError {
  return new DatabaseError(
    'DATABASE_PAYLOAD_INVALID',
    message,
    cause === undefined ? undefined : { cause },
  );
}

function sha256(value: string): string {
  return `sha256:${new Bun.CryptoHasher('sha256').update(value).digest('hex')}`;
}
