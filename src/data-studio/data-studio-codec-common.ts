/** Shared hostile-input and canonical-JSON primitives for Data Studio codecs. */

import type { DataStudioSchema, DataStudioValue } from './data-studio-contracts';
import { DataStudioError } from './data-studio-error';

const ARRAY_INDEX_PATTERN = /^(?:0|[1-9]\d*)$/u;
const TEXT_ENCODER = new TextEncoder();

export const DATA_STUDIO_BLOCKED_OBJECT_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

export function readClosedDataStudioRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  label: string,
): Record<string, unknown> {
  const record = readDataStudioRecord(value);
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw invalidDataStudioSchema(`Data Studio ${label} contains an unknown field.`);
    }
  }
  return record;
}

export function readDataStudioRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidDataStudioValue('Data Studio value must be a plain data object.');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidDataStudioValue('Data Studio objects must use a plain prototype.');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') {
      throw invalidDataStudioValue('Data Studio objects cannot contain symbol fields.');
    }
    const descriptor = descriptors[key]!;
    if (!descriptor.enumerable || !('value' in descriptor)) {
      throw invalidDataStudioValue(
        'Data Studio objects must contain enumerable data fields only.',
      );
    }
    result[key] = descriptor.value;
  }
  return result;
}

export function assertDenseDataStudioArray(value: unknown[], label: string): void {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some((key) => typeof key === 'symbol'
    || (key !== 'length' && !isArrayIndexKey(key, value.length)))) {
    throw invalidDataStudioValue(`${label} cannot contain named or symbol members.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[index];
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw invalidDataStudioValue(`${label} must not be sparse or contain accessors.`);
    }
  }
}

export function boundedDataStudioString(
  value: unknown,
  maxLength: number,
  message: string,
): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw invalidDataStudioSchema(message);
  }
  return value;
}

export function boundedDataStudioDisplayString(
  value: unknown,
  maxLength: number,
  message: string,
): string {
  if (typeof value !== 'string') throw invalidDataStudioSchema(message);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw invalidDataStudioSchema(message);
  }
  return normalized;
}

export function canonicalDataStudioJson(
  value: DataStudioSchema | DataStudioValue,
): string {
  return JSON.stringify(sortForCanonicalJson(value));
}

export function assertDataStudioUtf8Limit(
  text: string,
  limit: number,
  message: string,
): void {
  if (TEXT_ENCODER.encode(text).byteLength > limit) {
    throw dataStudioLimitExceeded(message);
  }
}

export function invalidDataStudioSchema(
  message: string,
  cause?: unknown,
): DataStudioError {
  return new DataStudioError('DATA_STUDIO_SCHEMA_INVALID', message, { cause });
}

export function invalidDataStudioValue(
  message: string,
  cause?: unknown,
): DataStudioError {
  return new DataStudioError('DATA_STUDIO_VALUE_INVALID', message, { cause });
}

export function dataStudioLimitExceeded(message: string): DataStudioError {
  return new DataStudioError('DATA_STUDIO_LIMIT_EXCEEDED', message);
}

function isArrayIndexKey(key: string, length: number): boolean {
  if (!ARRAY_INDEX_PATTERN.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index)
    && index >= 0
    && index < length
    && String(index) === key;
}

function sortForCanonicalJson(value: DataStudioSchema | DataStudioValue): unknown {
  if (Array.isArray(value)) return value.map((entry) => sortForCanonicalJson(entry));
  if (value === null || typeof value !== 'object') return value;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    const entry = (value as unknown as Record<string, DataStudioValue>)[key];
    result[key] = sortForCanonicalJson(entry!);
  }
  return result;
}
