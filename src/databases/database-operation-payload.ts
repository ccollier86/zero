/** Canonical payload cloning and hostile-object inspection boundaries. */

import { types as utilTypes } from 'node:util';
import {
  DATABASE_IDEMPOTENCY_KEY_MAX_LENGTH,
  DATABASE_OPERATION_MAX_ARRAY_ITEMS,
  DATABASE_OPERATION_MAX_BYTES,
  DATABASE_OPERATION_MAX_DEPTH,
  DATABASE_OPERATION_MAX_NAME_LENGTH,
  DATABASE_OPERATION_MAX_NODES,
  DATABASE_OPERATION_MAX_OBJECT_ENTRIES,
  DATABASE_OPERATION_MAX_STRING_BYTES,
  type DatabaseSequenceToken,
  type DatabaseSerializableValue,
} from './database-operation-contracts';
import { DatabaseError } from './database-error';

const REGISTRY_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u;
const TABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const RESERVED_PAYLOAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const textEncoder = new TextEncoder();

interface PayloadState {
  bytes: number;
  nodes: number;
  readonly ancestors: Set<object>;
}

/** Internal detached representation of an inspected operation object. */
export type DatabaseOperationRecord = Record<string, unknown>;

/** Return true for a portable realm/query/command registry name. */
export function isDatabaseRegistryName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= DATABASE_OPERATION_MAX_NAME_LENGTH
    && !RESERVED_PAYLOAD_KEYS.has(value)
    && REGISTRY_NAME_PATTERN.test(value);
}

/** Return true for a ReactiveDB-compatible SQL table/column identifier. */
export function isDatabaseTableName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= DATABASE_OPERATION_MAX_NAME_LENGTH
    && !RESERVED_PAYLOAD_KEYS.has(value)
    && TABLE_NAME_PATTERN.test(value);
}

/** Return true for a bounded opaque mutation deduplication key. */
export function isDatabaseIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= DATABASE_IDEMPOTENCY_KEY_MAX_LENGTH
    && IDEMPOTENCY_KEY_PATTERN.test(value);
}

/** Create an immutable validated sequence token. */
export function createDatabaseSequenceToken(seq: number): DatabaseSequenceToken {
  if (!Number.isSafeInteger(seq) || seq < 0) {
    throw databasePayloadInvalid(
      'Database sequence must be a non-negative safe integer.',
    );
  }
  return Object.freeze({ seq });
}

/**
 * Validate, detach, and deeply freeze a canonical operation payload value.
 * This function is also the actor boundary for registered handler input/output.
 */
export function cloneDatabaseSerializableValue<T extends DatabaseSerializableValue>(
  value: T,
): T;
export function cloneDatabaseSerializableValue(value: unknown): DatabaseSerializableValue;
export function cloneDatabaseSerializableValue(value: unknown): DatabaseSerializableValue {
  const state: PayloadState = {
    bytes: 0,
    nodes: 0,
    ancestors: new Set<object>(),
  };
  return clonePayload(value, state, 0);
}

/** Return true only when a value satisfies the canonical payload contract. */
export function isDatabaseSerializableValue(
  value: unknown,
): value is DatabaseSerializableValue {
  try {
    cloneDatabaseSerializableValue(value);
    return true;
  } catch {
    return false;
  }
}

/** Safely copy the enumerable data fields of a plain operation object. */
export function databaseOperationRecord(value: unknown): DatabaseOperationRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw databasePayloadInvalid('Database operation must be a plain object.');
  }
  if (isDatabasePayloadProxy(value)) {
    throw databasePayloadInvalid('Database operation proxies are not supported.');
  }
  const prototype = safeDatabasePayloadPrototype(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw databasePayloadInvalid('Database operation must use a plain prototype.');
  }

  const descriptors = safeDatabasePayloadDescriptors(value);
  const keys = safeDatabasePayloadOwnKeys(value);
  if (keys.some((key) => typeof key !== 'string')) {
    throw databasePayloadInvalid('Database operation must not contain symbol fields.');
  }
  const record: DatabaseOperationRecord = Object.create(null) as DatabaseOperationRecord;
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw databasePayloadInvalid(
        'Database operation fields must be enumerable data properties.',
      );
    }
    record[key] = descriptor.value;
  }
  return record;
}

export function requireDatabaseStringField(
  record: DatabaseOperationRecord,
  field: string,
): string {
  requireDatabaseOwnField(record, field);
  const value = record[field];
  if (typeof value !== 'string' || !isWellFormedDatabaseUnicode(value)) {
    throw databasePayloadInvalid(
      `Database operation ${field} must be a safe string.`,
    );
  }
  return value;
}

export function requireDatabaseOwnField(
  record: DatabaseOperationRecord,
  field: string,
): void {
  if (!hasDatabaseOwnField(record, field)) {
    throw databasePayloadInvalid(
      `Database operation is missing required field ${field}.`,
    );
  }
}

export function hasDatabaseOwnField(
  record: DatabaseOperationRecord,
  field: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(record, field);
}

export function assertExactDatabaseFields(
  record: DatabaseOperationRecord,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  for (const field of Object.keys(record)) {
    if (!allowedSet.has(field)) {
      throw databasePayloadInvalid('Database operation contains an unknown field.');
    }
  }
}

export function safeDatabasePayloadPrototype(value: object): object | null {
  try {
    return Object.getPrototypeOf(value);
  } catch {
    throw databasePayloadInvalid('Database payload object could not be inspected.');
  }
}

export function safeDatabasePayloadOwnKeys(value: object): (string | symbol)[] {
  try {
    return Reflect.ownKeys(value);
  } catch {
    throw databasePayloadInvalid('Database payload object could not be inspected.');
  }
}

export function safeDatabasePayloadDescriptors(
  value: object,
): PropertyDescriptorMap {
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    throw databasePayloadInvalid('Database payload object could not be inspected.');
  }
}

export function isDatabasePayloadProxy(value: object): boolean {
  try {
    return utilTypes.isProxy(value);
  } catch {
    return true;
  }
}

export function isWellFormedDatabaseUnicode(value: string): boolean {
  const candidate = value as string & { isWellFormed?: () => boolean };
  if (typeof candidate.isWellFormed === 'function') return candidate.isWellFormed();
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function databaseUtf8ByteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

export function databasePayloadInvalid(message: string): DatabaseError {
  return new DatabaseError('DATABASE_PAYLOAD_INVALID', message);
}

export function databasePayloadLimit(message: string): DatabaseError {
  return new DatabaseError('DATABASE_PAYLOAD_LIMIT', message);
}

function clonePayload(
  value: unknown,
  state: PayloadState,
  depth: number,
): DatabaseSerializableValue {
  addNode(state);
  if (depth > DATABASE_OPERATION_MAX_DEPTH) {
    throw databasePayloadLimit('Database payload nesting limit exceeded.');
  }

  if (value === null) {
    addBytes(state, 1);
    return null;
  }
  if (typeof value === 'string') {
    validatePayloadString(value, state);
    return value;
  }
  if (typeof value === 'boolean') {
    addBytes(state, 1);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw databasePayloadInvalid(
        'Database payload numbers must be finite canonical values.',
      );
    }
    addBytes(state, 8);
    return value;
  }
  if (typeof value !== 'object') {
    throw databasePayloadInvalid('Database payload contains an unsupported value.');
  }
  if (isDatabasePayloadProxy(value)) {
    throw databasePayloadInvalid('Database payload proxies are not supported.');
  }
  if (state.ancestors.has(value)) {
    throw databasePayloadInvalid('Database payload must not contain cycles.');
  }

  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return clonePayloadArray(value, state, depth);
    }
    return clonePayloadObject(value, state, depth);
  } finally {
    state.ancestors.delete(value);
  }
}

function clonePayloadArray(
  value: unknown[],
  state: PayloadState,
  depth: number,
): DatabaseSerializableValue {
  const ownKeys = safeDatabasePayloadOwnKeys(value);
  if (value.length > DATABASE_OPERATION_MAX_ARRAY_ITEMS) {
    throw databasePayloadLimit('Database payload array limit exceeded.');
  }
  if (ownKeys.length !== value.length + 1 || !ownKeys.includes('length')) {
    throw databasePayloadInvalid('Database payload arrays must be dense and unextended.');
  }
  const descriptors = safeDatabasePayloadDescriptors(value);
  const clone: DatabaseSerializableValue[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw databasePayloadInvalid('Database payload arrays must use data elements.');
    }
    clone.push(clonePayload(descriptor.value, state, depth + 1));
  }
  addBytes(state, value.length + 2);
  return Object.freeze(clone);
}

function clonePayloadObject(
  value: object,
  state: PayloadState,
  depth: number,
): DatabaseSerializableValue {
  const prototype = safeDatabasePayloadPrototype(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw databasePayloadInvalid('Database payload objects must use a plain prototype.');
  }
  const ownKeys = safeDatabasePayloadOwnKeys(value);
  if (ownKeys.some((key) => typeof key !== 'string')) {
    throw databasePayloadInvalid('Database payload symbol keys are not supported.');
  }
  if (ownKeys.length > DATABASE_OPERATION_MAX_OBJECT_ENTRIES) {
    throw databasePayloadLimit('Database payload object-property limit exceeded.');
  }
  const descriptors = safeDatabasePayloadDescriptors(value);
  const clone: Record<string, DatabaseSerializableValue> = {};
  for (const key of ownKeys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw databasePayloadInvalid(
        'Database payload objects must use enumerable data properties.',
      );
    }
    validatePayloadKey(key, state);
    clone[key] = clonePayload(descriptor.value, state, depth + 1);
  }
  addBytes(state, ownKeys.length + 2);
  return Object.freeze(clone);
}

function validatePayloadString(value: string, state: PayloadState): void {
  if (value.length > DATABASE_OPERATION_MAX_STRING_BYTES) {
    throw databasePayloadLimit('Database payload string limit exceeded.');
  }
  if (!isWellFormedDatabaseUnicode(value)) {
    throw databasePayloadInvalid(
      'Database payload strings must contain well-formed Unicode.',
    );
  }
  const bytes = databaseUtf8ByteLength(value);
  if (bytes > DATABASE_OPERATION_MAX_STRING_BYTES) {
    throw databasePayloadLimit('Database payload string limit exceeded.');
  }
  addBytes(state, bytes);
}

function validatePayloadKey(key: string, state: PayloadState): void {
  if (key.length > DATABASE_OPERATION_MAX_NAME_LENGTH) {
    throw databasePayloadLimit('Database payload object key limit exceeded.');
  }
  if (RESERVED_PAYLOAD_KEYS.has(key)
    || key.length === 0
    || !isWellFormedDatabaseUnicode(key)
    || /[\u0000-\u001f\u007f-\u009f]/u.test(key)) {
    throw databasePayloadInvalid('Database payload contains an unsafe object key.');
  }
  addBytes(state, databaseUtf8ByteLength(key));
}

function addNode(state: PayloadState): void {
  state.nodes += 1;
  if (state.nodes > DATABASE_OPERATION_MAX_NODES) {
    throw databasePayloadLimit('Database payload node limit exceeded.');
  }
}

function addBytes(state: PayloadState, count: number): void {
  state.bytes += count;
  if (state.bytes > DATABASE_OPERATION_MAX_BYTES) {
    throw databasePayloadLimit('Database payload size limit exceeded.');
  }
}
