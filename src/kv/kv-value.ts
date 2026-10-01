/**
 * kv-value.ts
 *
 * Validates and snapshots the JSON-compatible value contract shared by live
 * KV state, journal records, and checkpoints.
 */

import { KvError } from './kv-errors';
import type { ZeroKvKind } from './kv-types';

const KV_KINDS = new Set<ZeroKvKind>([
  'value',
  'counter',
  'hash',
  'set',
  'list',
  'lease',
  'rate-limit',
]);

/** Return an isolated JSON-compatible snapshot or reject lossy values. */
export function snapshotKvValue<T>(value: T): T {
  try {
    return cloneValue(value, '$', new WeakSet<object>(), 0) as T;
  } catch (error) {
    if (error instanceof KvError) throw error;
    throw invalidValue('$', error instanceof Error ? error.message : String(error));
  }
}

/** Validate a runtime entry kind before it can reach the durable journal. */
export function assertKvKind(kind: unknown): asserts kind is ZeroKvKind | undefined {
  if (kind === undefined || (typeof kind === 'string' && KV_KINDS.has(kind as ZeroKvKind))) return;
  throw new KvError('KV_VALUE_INVALID', 'KV entry kind is invalid.', { kind });
}

function cloneValue(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
  depth: number
): unknown {
  if (depth > 100) throw invalidValue(path, 'maximum nesting depth exceeded');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalidValue(path, 'numbers must be finite');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') {
    throw invalidValue(path, `${typeof value} values are not JSON-compatible`);
  }

  if (ancestors.has(value)) throw invalidValue(path, 'cyclic values are not supported');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return cloneArray(value, path, ancestors, depth);

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw invalidValue(path, 'only plain objects and arrays are supported');
    }
    return cloneObject(value as Record<string, unknown>, path, ancestors, depth);
  } finally {
    ancestors.delete(value);
  }
}

function cloneArray(
  value: unknown[],
  path: string,
  ancestors: WeakSet<object>,
  depth: number
): unknown[] {
  const propertyNames = Object.getOwnPropertyNames(value);
  const expectedPropertyCount = value.length + 1; // Indexed entries plus `length`.
  if (
    propertyNames.length !== expectedPropertyCount
    || propertyNames[propertyNames.length - 1] !== 'length'
    || propertyNames.slice(0, -1).some((key, index) => key !== String(index))
  ) {
    throw invalidValue(path, 'array holes or extra enumerable properties are not supported');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw invalidValue(path, 'symbol properties are not supported');
  }

  const output: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw invalidValue(`${path}[${index}]`, 'only enumerable data properties are supported');
    }
    output.push(cloneValue(descriptor.value, `${path}[${index}]`, ancestors, depth + 1));
  }
  return output;
}

function cloneObject(
  value: Record<string, unknown>,
  path: string,
  ancestors: WeakSet<object>,
  depth: number
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw invalidValue(path, 'symbol properties are not supported');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw invalidValue(`${path}.${key}`, 'only enumerable data properties are supported');
    }
    Object.defineProperty(output, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: cloneValue(descriptor.value, `${path}.${key}`, ancestors, depth + 1),
    });
  }
  return output;
}

function invalidValue(path: string, reason: string): KvError {
  return new KvError('KV_VALUE_INVALID', 'KV values must be losslessly JSON-compatible.', {
    path,
    reason,
  });
}
