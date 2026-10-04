/** Strict projection for full durable-delivery claims crossing actor IPC. */

import {
  DATABASE_AUTOMATION_OUTBOX_MAX_ATTEMPTS,
  DATABASE_AUTOMATION_OUTBOX_MAX_PAYLOAD_BYTES,
  DATABASE_AUTOMATION_OUTBOX_MAX_STORED_RECORDS,
  type ClaimedDatabaseAutomationDelivery,
  type DatabaseAutomationSourceOperation,
} from '../database-automations/automation-outbox-contracts';
import {
  canonicalDatabaseAutomationJson,
  isDatabaseAutomationErrorCode,
} from '../database-automations/automation-outbox-codec';
import type { DatabaseAutomationValue } from '../database-automations/database-function';
import { REACTIVE_DB_ROW_ID_MAX_BYTES } from '../sync/row-identity';
import {
  cloneDatabaseSerializableValue,
  isDatabaseRegistryName,
  isDatabaseTableName,
} from './database-operations';
import {
  assertDatabaseAutomationActorFields,
  databaseAutomationActorRecord,
  parseDatabaseAutomationActorOpaqueId,
  parseDatabaseAutomationActorTimestamp,
} from './database-automation-actor-protocol-validation';

const CLAIM_FIELDS = new Set([
  'deliveryId',
  'invocationId',
  'triggerIdentity',
  'functionIdentity',
  'manifestFingerprint',
  'realmName',
  'realmFingerprint',
  'sourceSequence',
  'sourceTable',
  'sourceOperation',
  'sourceRowId',
  'input',
  'status',
  'attemptCount',
  'maxAttempts',
  'availableAt',
  'createdAt',
  'updatedAt',
  'completedAt',
  'lastErrorCode',
  'insertionOrdinal',
  'leaseOwner',
  'leaseToken',
  'leaseExpiresAt',
]);
const FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const DEFINITION_IDENTITY_PATTERN =
  /^(?:function|trigger):[a-z][a-z0-9._-]{0,127}@[1-9][0-9]*$/u;
const textEncoder = new TextEncoder();

/**
 * Validate and detach one full processing claim before host dispatch.
 *
 * Failure details are intentionally left to the enclosing protocol adapter so
 * no command input or logical identity is ever reflected in an actor error.
 */
export function parseDatabaseAutomationActorClaim(
  value: unknown,
): ClaimedDatabaseAutomationDelivery {
  const record = databaseAutomationActorRecord(value);
  assertDatabaseAutomationActorFields(record, CLAIM_FIELDS);
  if (record.status !== 'processing' || record.completedAt !== null) {
    throw new TypeError('invalid claim state');
  }

  const input = cloneDatabaseSerializableValue(
    record.input,
  ) as DatabaseAutomationValue;
  if (textEncoder.encode(canonicalDatabaseAutomationJson(input)).byteLength
    > DATABASE_AUTOMATION_OUTBOX_MAX_PAYLOAD_BYTES) {
    throw new TypeError('claim input exceeds limit');
  }

  const createdAt = parseDatabaseAutomationActorTimestamp(record.createdAt);
  const updatedAt = parseDatabaseAutomationActorTimestamp(record.updatedAt);
  const leaseExpiresAt = parseDatabaseAutomationActorTimestamp(
    record.leaseExpiresAt,
  );
  const maxAttempts = parseBoundedInteger(
    record.maxAttempts,
    1,
    DATABASE_AUTOMATION_OUTBOX_MAX_ATTEMPTS,
  );
  const attemptCount = parseBoundedInteger(record.attemptCount, 1, maxAttempts);
  if (updatedAt < createdAt || leaseExpiresAt <= updatedAt) {
    throw new TypeError('invalid claim chronology');
  }

  return Object.freeze({
    deliveryId: parseDatabaseAutomationActorOpaqueId(record.deliveryId),
    invocationId: parseDatabaseAutomationActorOpaqueId(record.invocationId),
    triggerIdentity: parseDefinitionIdentity(record.triggerIdentity, 'trigger'),
    functionIdentity: parseDefinitionIdentity(record.functionIdentity, 'function'),
    manifestFingerprint: parseFingerprint(record.manifestFingerprint),
    realmName: parseRegistryName(record.realmName),
    realmFingerprint: parseFingerprint(record.realmFingerprint),
    sourceSequence: parseBoundedInteger(
      record.sourceSequence,
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    sourceTable: parseTableName(record.sourceTable),
    sourceOperation: parseSourceOperation(record.sourceOperation),
    sourceRowId: parseSourceRowId(record.sourceRowId),
    input,
    status: 'processing' as const,
    attemptCount,
    maxAttempts,
    availableAt: parseDatabaseAutomationActorTimestamp(record.availableAt),
    createdAt,
    updatedAt,
    completedAt: null,
    lastErrorCode: parseLastErrorCode(record.lastErrorCode),
    insertionOrdinal: parseBoundedInteger(
      record.insertionOrdinal,
      1,
      DATABASE_AUTOMATION_OUTBOX_MAX_STORED_RECORDS,
    ),
    leaseOwner: parseDatabaseAutomationActorOpaqueId(record.leaseOwner),
    leaseToken: parseDatabaseAutomationActorOpaqueId(record.leaseToken),
    leaseExpiresAt,
  });
}

function parseDefinitionIdentity(
  value: unknown,
  kind: 'trigger' | 'function',
): string {
  if (typeof value !== 'string'
    || value.length > 192
    || !DEFINITION_IDENTITY_PATTERN.test(value)
    || !value.startsWith(`${kind}:`)) {
    throw new TypeError('invalid definition identity');
  }
  return value;
}

function parseFingerprint(value: unknown): string {
  if (typeof value !== 'string' || !FINGERPRINT_PATTERN.test(value)) {
    throw new TypeError('invalid fingerprint');
  }
  return value;
}

function parseRegistryName(value: unknown): string {
  if (!isDatabaseRegistryName(value)) throw new TypeError('invalid registry name');
  return value;
}

function parseTableName(value: unknown): string {
  if (!isDatabaseTableName(value)) throw new TypeError('invalid table name');
  return value;
}

function parseSourceOperation(value: unknown): DatabaseAutomationSourceOperation {
  if (value !== 'insert' && value !== 'update' && value !== 'delete') {
    throw new TypeError('invalid source operation');
  }
  return value;
}

function parseSourceRowId(value: unknown): string {
  if (typeof value !== 'string'
    || value.length === 0
    || textEncoder.encode(value).byteLength > REACTIVE_DB_ROW_ID_MAX_BYTES) {
    throw new TypeError('invalid source row identity');
  }
  return value;
}

function parseLastErrorCode(value: unknown): string | null {
  if (value === null) return null;
  if (!isDatabaseAutomationErrorCode(value)) {
    throw new TypeError('invalid prior error code');
  }
  return value;
}

function parseBoundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value)
    || (value as number) < minimum
    || (value as number) > maximum) {
    throw new TypeError('invalid bounded integer');
  }
  return value as number;
}
