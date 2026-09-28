/**
 * database-executor-validation.ts
 *
 * Shared, side-effect-free validation for both ends of the database executor
 * protocol. These limits are deliberately stricter than Bun's advanced IPC
 * serializer so every accepted value has one bounded, backend-neutral shape.
 */

import { Buffer } from 'node:buffer';
import { types as nodeUtilTypes } from 'node:util';

import type { DatabaseExecutorValue } from './database-executor';

export const DATABASE_EXECUTOR_ROLE_MAX_LENGTH = 64;
export const DATABASE_EXECUTOR_OPERATION_MAX_LENGTH = 96;
export const DATABASE_EXECUTOR_VALUE_MAX_DEPTH = 32;
export const DATABASE_EXECUTOR_VALUE_MAX_NODES = 20_000;
export const DATABASE_EXECUTOR_VALUE_MAX_BYTES = 8 * 1024 * 1024;
export const DATABASE_EXECUTOR_VALUE_MAX_ARRAY_LENGTH = 10_000;
export const DATABASE_EXECUTOR_VALUE_MAX_OBJECT_PROPERTIES = 1_000;
export const DATABASE_EXECUTOR_VALUE_MAX_STRING_BYTES = 1024 * 1024;
export const DATABASE_EXECUTOR_VALUE_MAX_BINARY_BYTES = 8 * 1024 * 1024;

const ROLE_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/u;
const OPERATION_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/u;

/** Return true for a bounded, non-secret role identifier. */
export function isDatabaseExecutorRole(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= DATABASE_EXECUTOR_ROLE_MAX_LENGTH
    && ROLE_PATTERN.test(value);
}

/** Return true for a bounded operation identifier. */
export function isDatabaseExecutorOperationName(
  value: unknown,
): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= DATABASE_EXECUTOR_OPERATION_MAX_LENGTH
    && OPERATION_PATTERN.test(value);
}

/**
 * Read only enumerable own data properties from a plain object.
 *
 * Accessors, symbols, arrays, custom prototypes, and most hostile proxies are
 * rejected without evaluating application-controlled getters.
 */
export function readDatabaseExecutorDataRecord(
  value: unknown,
): Record<string, unknown> | null {
  if (typeof value !== 'object'
    || value === null
    || Array.isArray(value)
    || nodeUtilTypes.isProxy(value)) {
    return null;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const record: Record<string, unknown> = Object.create(null);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable || !('value' in descriptor)) return null;
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    return null;
  }
}

/** Return true only when an envelope has exactly the expected string keys. */
export function hasExactDatabaseExecutorKeys(
  record: Record<string, unknown>,
  expected: ReadonlySet<string>,
): boolean {
  const keys = Object.keys(record);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

/**
 * Validate a bounded portable value tree.
 *
 * Cycles and shared references are rejected. Accepted containers are dense
 * arrays and plain data objects; supported atoms are the public
 * DatabaseExecutorValue atoms. The budget is logical rather than an estimate
 * of JSC's private wire framing.
 */
export function isDatabaseExecutorValue(
  root: unknown,
): root is DatabaseExecutorValue {
  const work: Array<{ readonly value: unknown; readonly depth: number }> = [{
    value: root,
    depth: 0,
  }];
  const seen = new WeakSet<object>();
  let nodes = 0;
  let bytes = 0;

  const consumeBytes = (amount: number): boolean => {
    bytes += amount;
    return Number.isSafeInteger(bytes)
      && bytes <= DATABASE_EXECUTOR_VALUE_MAX_BYTES;
  };

  while (work.length > 0) {
    const item = work.pop();
    if (!item) return false;
    const { value, depth } = item;
    nodes += 1;
    if (nodes > DATABASE_EXECUTOR_VALUE_MAX_NODES
      || depth > DATABASE_EXECUTOR_VALUE_MAX_DEPTH) {
      return false;
    }
    if (value === null || value === undefined) {
      if (!consumeBytes(1)) return false;
      continue;
    }

    switch (typeof value) {
      case 'boolean':
      case 'number':
        if (!consumeBytes(8)) return false;
        continue;
      case 'bigint':
        if (!consumeBytes(Math.ceil(value.toString(16).length / 2))) return false;
        continue;
      case 'string': {
        const stringBytes = Buffer.byteLength(value, 'utf8');
        if (stringBytes > DATABASE_EXECUTOR_VALUE_MAX_STRING_BYTES
          || !consumeBytes(stringBytes)) {
          return false;
        }
        continue;
      }
      case 'object':
        break;
      default:
        return false;
    }

    if (nodeUtilTypes.isProxy(value) || seen.has(value)) return false;
    seen.add(value);

    if (value instanceof Date) {
      if (Object.getOwnPropertyNames(value).length !== 0
        || Object.getOwnPropertySymbols(value).length !== 0
        || !consumeBytes(8)) {
        return false;
      }
      continue;
    }
    if (value instanceof ArrayBuffer || value instanceof Uint8Array) {
      if (value.byteLength > DATABASE_EXECUTOR_VALUE_MAX_BINARY_BYTES
        || !consumeBytes(value.byteLength)) {
        return false;
      }
      continue;
    }

    try {
      if (Array.isArray(value)) {
        if (value.length > DATABASE_EXECUTOR_VALUE_MAX_ARRAY_LENGTH) return false;
        const names = Object.getOwnPropertyNames(value);
        if (Object.getOwnPropertySymbols(value).length !== 0
          || names.length !== value.length + 1
          || !names.includes('length')) {
          return false;
        }
        const descriptors = Object.getOwnPropertyDescriptors(value);
        for (let index = 0; index < value.length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
            return false;
          }
          work.push({ value: descriptor.value, depth: depth + 1 });
        }
        continue;
      }

      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return false;
      if (Object.getOwnPropertySymbols(value).length !== 0) return false;
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const entries = Object.entries(descriptors);
      if (entries.length > DATABASE_EXECUTOR_VALUE_MAX_OBJECT_PROPERTIES) {
        return false;
      }
      for (const [key, descriptor] of entries) {
        if (!descriptor.enumerable || !('value' in descriptor)) return false;
        const keyBytes = Buffer.byteLength(key, 'utf8');
        if (keyBytes > DATABASE_EXECUTOR_VALUE_MAX_STRING_BYTES
          || !consumeBytes(keyBytes)) {
          return false;
        }
        work.push({ value: descriptor.value, depth: depth + 1 });
      }
    } catch {
      return false;
    }
  }
  return true;
}
