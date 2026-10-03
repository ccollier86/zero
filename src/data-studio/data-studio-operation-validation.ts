/** Validation and canonicalization for Data Studio operation payloads. */

import { types as utilTypes } from 'node:util';
import {
  DATA_STUDIO_MAX_COLUMN_ID_LENGTH,
  DATA_STUDIO_MAX_TABLE_KEY_LENGTH,
  type DataStudioRowValues,
} from './data-studio-contracts';
import {
  normalizeDataStudioRowValues,
  normalizeDataStudioSchema,
} from './data-studio-codec';
import { DataStudioError } from './data-studio-error';

const TABLE_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 2_000;
const MAX_ACTOR_ID_LENGTH = 200;

/** Normalize a human label without allowing invisible outer whitespace. */
export function normalizeDataStudioTableName(value: unknown): string {
  return boundedTrimmedString(value, MAX_NAME_LENGTH, 'Data Studio table name is invalid.');
}

/** Normalize an immutable machine-addressable table key. */
export function normalizeDataStudioTableKey(value: unknown): string {
  const key = boundedTrimmedString(
    value,
    DATA_STUDIO_MAX_TABLE_KEY_LENGTH,
    'Data Studio table key is invalid.',
  ).toLowerCase();
  if (!TABLE_KEY_PATTERN.test(key) || isBlockedKey(key)) {
    throw schemaInvalid('Data Studio table key is invalid.');
  }
  return key;
}

/** Derive a readable valid key; callers must still resolve uniqueness. */
export function deriveDataStudioTableKey(name: string): string {
  const normalized = normalizeDataStudioTableName(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, DATA_STUDIO_MAX_TABLE_KEY_LENGTH)
    .replace(/_+$/gu, '');
  return normalizeDataStudioTableKey(
    /^[a-z]/u.test(normalized) ? normalized : `table_${normalized || 'data'}`,
  );
}

export function normalizeDataStudioDescription(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return boundedTrimmedString(
    value,
    MAX_DESCRIPTION_LENGTH,
    'Data Studio table description is invalid.',
  );
}

export function normalizeDataStudioId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value) || isBlockedKey(value)) {
    throw valueInvalid(`${label} is invalid.`);
  }
  return value;
}

export function normalizeDataStudioActorId(value: unknown, label: string): string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > MAX_ACTOR_ID_LENGTH
    || value.trim() !== value) {
    throw new DataStudioError(
      'DATA_STUDIO_AUTHORITY_REQUIRED',
      `${label} is invalid.`,
    );
  }
  return value;
}

export function normalizeDataStudioRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw valueInvalid('Data Studio revision is invalid.');
  }
  return value as number;
}

export function normalizeDataStudioTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw valueInvalid('Data Studio timestamp is invalid.');
  }
  return value as number;
}

/** Convert a key/value request object into a complete canonical cell set. */
export function normalizeDataStudioValues(
  schemaValue: unknown,
  values: unknown,
): DataStudioRowValues {
  const schema = normalizeDataStudioSchema(schemaValue);
  const record = readDataStudioRecord(values, 'Data Studio row values');
  const columnsByKey = new Map(schema.columns.map((column) => [column.key, column]));
  for (const key of Object.keys(record)) {
    if (!columnsByKey.has(key)) {
      throw valueInvalid('Data Studio row contains an unknown column key.');
    }
  }
  const byId: Record<string, unknown> = Object.create(null);
  for (const column of schema.columns) {
    if (Object.hasOwn(record, column.key)) byId[column.columnId] = record[column.key];
  }
  return normalizeDataStudioRowValues(schema, byId);
}

/** Revalidate actor input expressed by stable column ids. */
export function normalizeDataStudioCells(
  schemaValue: unknown,
  values: unknown,
): DataStudioRowValues {
  const schema = normalizeDataStudioSchema(schemaValue);
  return normalizeDataStudioRowValues(schema, values);
}

export function normalizeDataStudioColumnId(value: unknown): string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > DATA_STUDIO_MAX_COLUMN_ID_LENGTH
    || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(value)
    || isBlockedKey(value)) {
    throw valueInvalid('Data Studio column id is invalid.');
  }
  return value;
}

function boundedTrimmedString(
  value: unknown,
  maxLength: number,
  message: string,
): string {
  if (typeof value !== 'string') throw schemaInvalid(message);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw schemaInvalid(message);
  return normalized;
}

export function readDataStudioRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw valueInvalid(`${label} must be a plain object.`);
  }
  try {
    if (utilTypes.isProxy(value)) throw valueInvalid(`${label} must not be a proxy.`);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw valueInvalid(`${label} must be a plain object.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')) {
      throw valueInvalid(`${label} must not contain symbols.`);
    }
    const record: Record<string, unknown> = Object.create(null);
    for (const key of keys as string[]) {
      if (isBlockedKey(key)) throw valueInvalid(`${label} contains an invalid key.`);
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw valueInvalid(`${label} must use enumerable data properties.`);
      }
      record[key] = descriptor.value;
    }
    return record;
  } catch (error) {
    if (error instanceof DataStudioError) throw error;
    throw valueInvalid(`${label} could not be inspected.`, error);
  }
}

function isBlockedKey(value: string): boolean {
  return value === '__proto__' || value === 'prototype' || value === 'constructor';
}

function schemaInvalid(message: string, cause?: unknown): DataStudioError {
  return new DataStudioError(
    'DATA_STUDIO_SCHEMA_INVALID',
    message,
    cause === undefined ? undefined : { cause },
  );
}

function valueInvalid(message: string, cause?: unknown): DataStudioError {
  return new DataStudioError(
    'DATA_STUDIO_VALUE_INVALID',
    message,
    cause === undefined ? undefined : { cause },
  );
}
