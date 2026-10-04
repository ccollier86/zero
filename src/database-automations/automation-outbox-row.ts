/**
 * automation-outbox-row.ts
 *
 * Validates and projects private SQLite automation-delivery rows. It performs
 * no queries and exposes no raw persistence representation to host handlers.
 */

import {
  isDatabaseRegistryName,
  isDatabaseTableName,
} from '../databases/database-operations';
import { REACTIVE_DB_ROW_ID_MAX_BYTES } from '../sync/row-identity';
import {
  DATABASE_AUTOMATION_OUTBOX_MAX_ATTEMPTS,
  DATABASE_AUTOMATION_OUTBOX_MAX_PAYLOAD_BYTES,
  DATABASE_AUTOMATION_OUTBOX_SCHEMA_VERSION,
  type ClaimedDatabaseAutomationDelivery,
  type DatabaseAutomationOutboxRecord,
  type DatabaseAutomationOutboxStatus,
  type DatabaseAutomationSourceOperation,
} from './automation-outbox-contracts';
import {
  automationOutboxCorrupt,
  fingerprintDatabaseAutomationOutboxCommand,
  isDatabaseAutomationErrorCode,
  parseCanonicalDatabaseAutomationPayload,
} from './automation-outbox-codec';
import type { DatabaseAutomationValue } from './database-function';

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,191}$/u;
const FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const DEFINITION_IDENTITY_PATTERN = /^(?:function|trigger):[a-z][a-z0-9._-]{0,127}@[1-9][0-9]*$/u;
const textEncoder = new TextEncoder();

/** Shared projection used by schema validation and prepared store reads. */
export const DATABASE_AUTOMATION_OUTBOX_ROW_COLUMNS = `
  delivery_id,
  command_fingerprint,
  invocation_id,
  trigger_identity,
  function_identity,
  manifest_fingerprint,
  realm_name,
  realm_fingerprint,
  source_sequence,
  source_table,
  source_operation,
  source_row_id,
  payload_json,
  payload_bytes,
  status,
  attempt_count,
  max_attempts,
  available_at,
  lease_owner,
  lease_token,
  lease_expires_at,
  last_error_code,
  created_at,
  updated_at,
  completed_at,
  insertion_ordinal,
  schema_version`;

/** Internal SQLite row shape; every value is revalidated before projection. */
export interface DatabaseAutomationOutboxSqlRow {
  delivery_id: unknown;
  command_fingerprint: unknown;
  invocation_id: unknown;
  trigger_identity: unknown;
  function_identity: unknown;
  manifest_fingerprint: unknown;
  realm_name: unknown;
  realm_fingerprint: unknown;
  source_sequence: unknown;
  source_table: unknown;
  source_operation: unknown;
  source_row_id: unknown;
  payload_json: unknown;
  payload_bytes: unknown;
  status: unknown;
  attempt_count: unknown;
  max_attempts: unknown;
  available_at: unknown;
  lease_owner: unknown;
  lease_token: unknown;
  lease_expires_at: unknown;
  last_error_code: unknown;
  created_at: unknown;
  updated_at: unknown;
  completed_at: unknown;
  insertion_ordinal: unknown;
  schema_version: unknown;
}

/** Validate a raw row and return its detached public projection. */
export function projectDatabaseAutomationOutboxRow(
  row: DatabaseAutomationOutboxSqlRow,
): DatabaseAutomationOutboxRecord {
  const validated = validateScalarFields(row);
  const scalar = validated.record;
  let input: DatabaseAutomationValue | null = null;
  if (scalar.status === 'pending' || scalar.status === 'processing') {
    if (typeof row.payload_json !== 'string'
      || !isSafeIntegerBetween(
        row.payload_bytes,
        1,
        DATABASE_AUTOMATION_OUTBOX_MAX_PAYLOAD_BYTES,
      )) {
      throw automationOutboxCorrupt();
    }
    input = parseCanonicalDatabaseAutomationPayload(
      row.payload_json,
      row.payload_bytes,
    );
    const expectedFingerprint = fingerprintDatabaseAutomationOutboxCommand({
      deliveryId: scalar.deliveryId,
      invocationId: scalar.invocationId,
      triggerIdentity: scalar.triggerIdentity,
      functionIdentity: scalar.functionIdentity,
      manifestFingerprint: scalar.manifestFingerprint,
      realmName: scalar.realmName,
      realmFingerprint: scalar.realmFingerprint,
      sourceSequence: scalar.sourceSequence,
      sourceTable: scalar.sourceTable,
      sourceOperation: scalar.sourceOperation,
      sourceRowId: scalar.sourceRowId,
      payload: input,
    });
    if (expectedFingerprint !== validated.commandFingerprint) {
      throw automationOutboxCorrupt();
    }
  } else if (row.payload_json !== null || row.payload_bytes !== 0) {
    throw automationOutboxCorrupt();
  }

  return Object.freeze({
    ...scalar,
    input,
  });
}

/** Require an active processing row and project its exact lease fence. */
export function projectClaimedDatabaseAutomationDelivery(
  row: DatabaseAutomationOutboxSqlRow,
): ClaimedDatabaseAutomationDelivery {
  const record = projectDatabaseAutomationOutboxRow(row);
  if (record.status !== 'processing'
    || typeof row.lease_owner !== 'string'
    || !OPAQUE_ID_PATTERN.test(row.lease_owner)
    || typeof row.lease_token !== 'string'
    || !OPAQUE_ID_PATTERN.test(row.lease_token)
    || !isNonNegativeSafeInteger(row.lease_expires_at)
    || row.lease_expires_at <= record.updatedAt) {
    throw automationOutboxCorrupt();
  }
  return Object.freeze({
    ...record,
    status: 'processing' as const,
    input: record.input,
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at,
  });
}

function validateScalarFields(row: DatabaseAutomationOutboxSqlRow): Readonly<{
  record: Omit<DatabaseAutomationOutboxRecord, 'input'>;
  commandFingerprint: string;
}> {
  if (typeof row.delivery_id !== 'string'
    || !OPAQUE_ID_PATTERN.test(row.delivery_id)
    || typeof row.invocation_id !== 'string'
    || !OPAQUE_ID_PATTERN.test(row.invocation_id)
    || typeof row.trigger_identity !== 'string'
    || row.trigger_identity.length > 192
    || !DEFINITION_IDENTITY_PATTERN.test(row.trigger_identity)
    || !row.trigger_identity.startsWith('trigger:')
    || typeof row.function_identity !== 'string'
    || row.function_identity.length > 192
    || !DEFINITION_IDENTITY_PATTERN.test(row.function_identity)
    || !row.function_identity.startsWith('function:')
    || typeof row.command_fingerprint !== 'string'
    || !FINGERPRINT_PATTERN.test(row.command_fingerprint)
    || typeof row.manifest_fingerprint !== 'string'
    || !FINGERPRINT_PATTERN.test(row.manifest_fingerprint)
    || typeof row.realm_fingerprint !== 'string'
    || !FINGERPRINT_PATTERN.test(row.realm_fingerprint)
    || !isDatabaseRegistryName(row.realm_name)
    || !isDatabaseTableName(row.source_table)
    || !isSourceOperation(row.source_operation)
    || typeof row.source_row_id !== 'string'
    || row.source_row_id.length === 0
    || textEncoder.encode(row.source_row_id).byteLength > REACTIVE_DB_ROW_ID_MAX_BYTES
    || !isSafeIntegerBetween(row.source_sequence, 1, Number.MAX_SAFE_INTEGER)
    || !isStatus(row.status)
    || !isSafeIntegerBetween(row.attempt_count, 0, DATABASE_AUTOMATION_OUTBOX_MAX_ATTEMPTS)
    || !isSafeIntegerBetween(row.max_attempts, 1, DATABASE_AUTOMATION_OUTBOX_MAX_ATTEMPTS)
    || row.attempt_count > row.max_attempts
    || !isNonNegativeSafeInteger(row.available_at)
    || !isNonNegativeSafeInteger(row.created_at)
    || !isNonNegativeSafeInteger(row.updated_at)
    || row.updated_at < row.created_at
    || !isSafeIntegerBetween(row.insertion_ordinal, 1, Number.MAX_SAFE_INTEGER)
    || row.schema_version !== DATABASE_AUTOMATION_OUTBOX_SCHEMA_VERSION) {
    throw automationOutboxCorrupt();
  }
  let lastErrorCode: string | null;
  if (row.last_error_code === null) {
    lastErrorCode = null;
  } else {
    if (!isDatabaseAutomationErrorCode(row.last_error_code)) {
      throw automationOutboxCorrupt();
    }
    lastErrorCode = row.last_error_code;
  }
  const terminal = row.status === 'completed' || row.status === 'dead';
  let completedAt: number | null;
  if (terminal) {
    if (!isNonNegativeSafeInteger(row.completed_at)) {
      throw automationOutboxCorrupt();
    }
    completedAt = row.completed_at;
  } else {
    if (row.completed_at !== null) throw automationOutboxCorrupt();
    completedAt = null;
  }
  if ((completedAt !== null && completedAt < row.created_at)
    || (row.status === 'completed' && lastErrorCode !== null)
    || (row.status === 'dead' && lastErrorCode === null)
    || (row.status === 'pending'
      && (row.lease_owner !== null
        || row.lease_token !== null
        || row.lease_expires_at !== null))
    || (terminal
      && (row.lease_owner !== null
        || row.lease_token !== null
        || row.lease_expires_at !== null))) {
    throw automationOutboxCorrupt();
  }
  return Object.freeze({
    commandFingerprint: row.command_fingerprint,
    record: Object.freeze({
      deliveryId: row.delivery_id,
      invocationId: row.invocation_id,
      triggerIdentity: row.trigger_identity,
      functionIdentity: row.function_identity,
      manifestFingerprint: row.manifest_fingerprint,
      realmName: row.realm_name,
      realmFingerprint: row.realm_fingerprint,
      sourceSequence: row.source_sequence,
      sourceTable: row.source_table,
      sourceOperation: row.source_operation,
      sourceRowId: row.source_row_id,
      status: row.status,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      availableAt: row.available_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt,
      lastErrorCode,
      insertionOrdinal: row.insertion_ordinal,
    }),
  });
}

function isSourceOperation(value: unknown): value is DatabaseAutomationSourceOperation {
  return value === 'insert' || value === 'update' || value === 'delete';
}

function isStatus(value: unknown): value is DatabaseAutomationOutboxStatus {
  return value === 'pending'
    || value === 'processing'
    || value === 'completed'
    || value === 'dead';
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isSafeIntegerBetween(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return Number.isSafeInteger(value)
    && (value as number) >= minimum
    && (value as number) <= maximum;
}
