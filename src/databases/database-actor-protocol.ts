/**
 * database-actor-protocol.ts
 *
 * Defines the database-specific payloads carried by the backend-neutral
 * executor transport. Physical paths appear only in the trusted one-time bind
 * request; public database operations never accept routing identifiers.
 */

import { isAbsolute, normalize, resolve } from 'node:path';

import { DatabaseError } from './database-error';
import {
  normalizeDatabaseRef,
  type DatabaseRef,
} from './database-file';
import {
  cloneDatabaseSerializableValue,
  createDatabaseSequenceToken,
  validateDatabaseOperation,
  type DatabaseOperation,
  type DatabaseOperationCatalog,
  type DatabaseSequenceToken,
  type DatabaseSerializableValue,
} from './database-operations';

/** Executor operation names understood by a Zero database actor. */
export const DATABASE_ACTOR_OPERATIONS = Object.freeze({
  bindWriter: 'database.writer.bind',
  bindReader: 'database.reader.bind',
  execute: 'database.execute',
  replay: 'database.replay',
  unbind: 'database.unbind',
} as const);

/** Highest number of durable changes returned by one replay page. */
export const DATABASE_ACTOR_MAX_REPLAY_CHANGES = 500;

/** Maximum UTF-8 byte length accepted for an internal canonical file path. */
export const DATABASE_ACTOR_MAX_PATH_BYTES = 4_096;

const REALM_FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SCHEMA_CHECKSUM_PATTERN = /^[0-9a-f]{64}$/u;
const SAFE_EPOCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SYNCHRONOUS_MODES = new Set(['OFF', 'NORMAL', 'FULL', 'EXTRA']);
const TEMP_STORE_MODES = new Set(['DEFAULT', 'FILE', 'MEMORY']);
const BIND_FIELDS = new Set([
  'databaseRef',
  'filePath',
  'realmFingerprint',
  'sqlite',
]);
const SQLITE_FIELDS = new Set([
  'cacheSize',
  'mmapSize',
  'walAutocheckpoint',
  'pageSize',
  'synchronous',
  'tempStore',
  'busyTimeout',
  'statementCacheSize',
  'bufferPool',
  'ringBufferDepth',
]);
const BUFFER_POOL_FIELDS = new Set(['maxPoolSize', 'preallocate']);
const textEncoder = new TextEncoder();

/** Actor roles have distinct connection and mutation capabilities. */
export type DatabaseActorRole = 'writer' | 'reader';

/** File-safe SQLite/ReactiveDB settings accepted during actor binding. */
export interface DatabaseActorSQLiteConfig {
  readonly cacheSize?: number;
  readonly mmapSize?: number;
  readonly walAutocheckpoint?: number;
  readonly pageSize?: number;
  readonly synchronous?: 'OFF' | 'NORMAL' | 'FULL' | 'EXTRA';
  readonly tempStore?: 'DEFAULT' | 'FILE' | 'MEMORY';
  readonly busyTimeout?: number;
  readonly statementCacheSize?: number;
  readonly bufferPool?: false | Readonly<{
    readonly maxPoolSize?: number;
    readonly preallocate?: boolean;
  }>;
  readonly ringBufferDepth?: number;
}

/**
 * Validate, detach, and freeze the file-safe SQLite settings shared by the
 * parent coordinator and actor bind protocol.
 */
export function normalizeDatabaseActorSQLiteConfig(
  value: unknown,
): DatabaseActorSQLiteConfig {
  return parseSQLiteConfig(cloneDatabaseSerializableValue(value));
}

/** Trusted one-time file binding. The path never enters the public facade. */
export interface DatabaseActorBindPayload {
  readonly databaseRef: DatabaseRef;
  readonly filePath: string;
  readonly realmFingerprint: string;
  readonly sqlite: DatabaseActorSQLiteConfig;
}

/** Actor readiness proof returned after open/migration/schema validation. */
export interface DatabaseActorBindResult {
  readonly databaseRef: DatabaseRef;
  readonly role: DatabaseActorRole;
  readonly realmFingerprint: string;
  readonly schemaChecksum: string;
  readonly sequence: DatabaseSequenceToken;
  readonly syncEpoch: string | null;
}

/** One operation routed only after the actor is bound to this reference. */
export interface DatabaseActorExecutePayload {
  readonly databaseRef: DatabaseRef;
  readonly operation: DatabaseOperation;
}

/** One bounded, contiguous durable change-log replay request. */
export interface DatabaseActorReplayPayload {
  readonly databaseRef: DatabaseRef;
  readonly afterSeq: number;
  readonly limit: number;
}

/** Release the actor's current file before slot reuse or shutdown. */
export interface DatabaseActorUnbindPayload {
  readonly databaseRef: DatabaseRef;
}

/** Validate and detach a trusted actor bind payload. */
export function validateDatabaseActorBindPayload(
  value: unknown,
): DatabaseActorBindPayload {
  const record = dataRecord(cloneDatabaseSerializableValue(value));
  assertExactFields(record, BIND_FIELDS);
  const result = {
    databaseRef: parseDatabaseRef(record.databaseRef),
    filePath: parseCanonicalFilePath(record.filePath),
    realmFingerprint: parseRealmFingerprint(record.realmFingerprint),
    sqlite: normalizeDatabaseActorSQLiteConfig(record.sqlite),
  };
  return Object.freeze(result);
}

/** Validate and detach an actor readiness result. */
export function validateDatabaseActorBindResult(
  value: unknown,
): DatabaseActorBindResult {
  const record = dataRecord(cloneDatabaseSerializableValue(value));
  assertExactFields(record, new Set([
    'databaseRef',
    'role',
    'realmFingerprint',
    'schemaChecksum',
    'sequence',
    'syncEpoch',
  ]));
  if (record.role !== 'writer' && record.role !== 'reader') {
    throw payloadInvalid('Invalid database actor role.');
  }
  if (typeof record.schemaChecksum !== 'string'
    || !SCHEMA_CHECKSUM_PATTERN.test(record.schemaChecksum)) {
    throw payloadInvalid('Invalid database actor schema checksum.');
  }
  if (record.syncEpoch !== null
    && (typeof record.syncEpoch !== 'string'
      || !SAFE_EPOCH_PATTERN.test(record.syncEpoch))) {
    throw payloadInvalid('Invalid database actor sync epoch.');
  }
  if (record.role === 'writer' && record.syncEpoch === null) {
    throw payloadInvalid('Writer database actors must return a sync epoch.');
  }
  if (record.role === 'reader' && record.syncEpoch !== null) {
    throw payloadInvalid('Reader database actors must not return a sync epoch.');
  }
  return Object.freeze({
    databaseRef: parseDatabaseRef(record.databaseRef),
    role: record.role,
    realmFingerprint: parseRealmFingerprint(record.realmFingerprint),
    schemaChecksum: record.schemaChecksum,
    sequence: parseSequenceToken(record.sequence),
    syncEpoch: record.syncEpoch,
  });
}

/** Validate one database operation after actor routing has been selected. */
export function validateDatabaseActorExecutePayload(
  value: unknown,
  catalog: DatabaseOperationCatalog,
): DatabaseActorExecutePayload {
  const record = dataRecord(cloneDatabaseSerializableValue(value));
  assertExactFields(record, new Set(['databaseRef', 'operation']));
  return Object.freeze({
    databaseRef: parseDatabaseRef(record.databaseRef),
    operation: validateDatabaseOperation(record.operation, catalog),
  });
}

/** Validate one bounded durable replay request. */
export function validateDatabaseActorReplayPayload(
  value: unknown,
): DatabaseActorReplayPayload {
  const record = dataRecord(cloneDatabaseSerializableValue(value));
  assertExactFields(record, new Set(['databaseRef', 'afterSeq', 'limit']));
  if (!Number.isSafeInteger(record.afterSeq) || (record.afterSeq as number) < 0) {
    throw payloadInvalid('Invalid database replay cursor.');
  }
  if (!Number.isSafeInteger(record.limit)
    || (record.limit as number) < 1
    || (record.limit as number) > DATABASE_ACTOR_MAX_REPLAY_CHANGES) {
    throw payloadInvalid('Invalid database replay limit.');
  }
  return Object.freeze({
    databaseRef: parseDatabaseRef(record.databaseRef),
    afterSeq: record.afterSeq as number,
    limit: record.limit as number,
  });
}

/** Validate a request to release the actor's current database. */
export function validateDatabaseActorUnbindPayload(
  value: unknown,
): DatabaseActorUnbindPayload {
  const record = dataRecord(cloneDatabaseSerializableValue(value));
  assertExactFields(record, new Set(['databaseRef']));
  return Object.freeze({
    databaseRef: parseDatabaseRef(record.databaseRef),
  });
}

function parseSQLiteConfig(value: unknown): DatabaseActorSQLiteConfig {
  const record = dataRecord(value);
  assertExactFields(record, SQLITE_FIELDS, false);
  const output: Record<string, DatabaseSerializableValue> = {};

  copySafeInteger(record, output, 'cacheSize');
  copySafeInteger(record, output, 'mmapSize', 0);
  copySafeInteger(record, output, 'walAutocheckpoint', 1);
  copySafeInteger(record, output, 'pageSize', 1);
  copySafeInteger(record, output, 'busyTimeout', 1);
  copySafeInteger(record, output, 'statementCacheSize', 1);
  copySafeInteger(record, output, 'ringBufferDepth', 1);

  if (Object.hasOwn(record, 'synchronous')) {
    if (typeof record.synchronous !== 'string'
      || !SYNCHRONOUS_MODES.has(record.synchronous)) {
      throw payloadInvalid('Invalid database actor synchronous mode.');
    }
    output.synchronous = record.synchronous;
  }
  if (Object.hasOwn(record, 'tempStore')) {
    if (typeof record.tempStore !== 'string'
      || !TEMP_STORE_MODES.has(record.tempStore)) {
      throw payloadInvalid('Invalid database actor temp-store mode.');
    }
    output.tempStore = record.tempStore;
  }
  if (Object.hasOwn(record, 'bufferPool')) {
    if (record.bufferPool === false) {
      output.bufferPool = false;
    } else {
      const bufferPool = dataRecord(record.bufferPool);
      assertExactFields(bufferPool, BUFFER_POOL_FIELDS, false);
      const normalized: Record<string, DatabaseSerializableValue> = {};
      copySafeInteger(bufferPool, normalized, 'maxPoolSize', 1);
      if (Object.hasOwn(bufferPool, 'preallocate')) {
        if (typeof bufferPool.preallocate !== 'boolean') {
          throw payloadInvalid('Invalid database actor buffer-pool setting.');
        }
        normalized.preallocate = bufferPool.preallocate;
      }
      output.bufferPool = Object.freeze(normalized);
    }
  }

  return Object.freeze(output) as DatabaseActorSQLiteConfig;
}

function copySafeInteger(
  source: Record<string, unknown>,
  target: Record<string, DatabaseSerializableValue>,
  field: string,
  minimum?: number,
): void {
  if (!Object.hasOwn(source, field)) return;
  const value = source[field];
  if (!Number.isSafeInteger(value)
    || (minimum !== undefined && (value as number) < minimum)) {
    throw payloadInvalid('Invalid numeric database actor setting.');
  }
  target[field] = value as number;
}

function parseDatabaseRef(value: unknown): DatabaseRef {
  try {
    return normalizeDatabaseRef(value as string);
  } catch {
    throw payloadInvalid('Invalid database actor reference.');
  }
}

function parseCanonicalFilePath(value: unknown): string {
  if (typeof value !== 'string'
    || value.length === 0
    || value.includes('\0')
    || textEncoder.encode(value).byteLength > DATABASE_ACTOR_MAX_PATH_BYTES
    || !isAbsolute(value)
    || normalize(value) !== value
    || resolve(value) !== value) {
    throw payloadInvalid('Invalid database actor file location.');
  }
  return value;
}

function parseRealmFingerprint(value: unknown): string {
  if (typeof value !== 'string' || !REALM_FINGERPRINT_PATTERN.test(value)) {
    throw payloadInvalid('Invalid database actor realm fingerprint.');
  }
  return value;
}

function parseSequenceToken(value: unknown): DatabaseSequenceToken {
  const record = dataRecord(value);
  assertExactFields(record, new Set(['seq']));
  return createDatabaseSequenceToken(record.seq as number);
}

function dataRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw payloadInvalid('Invalid database actor payload.');
  }
  return value as Record<string, unknown>;
}

function assertExactFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  requireAll = true,
): void {
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.has(key))
    || (requireAll && keys.length !== allowed.size)) {
    throw payloadInvalid('Invalid database actor payload fields.');
  }
}

function payloadInvalid(message: string): DatabaseError {
  return new DatabaseError('DATABASE_PAYLOAD_INVALID', message);
}
