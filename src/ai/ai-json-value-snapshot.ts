/** Bounded immutable snapshots for caller-owned JSON values. */

import type { JSONValue } from '@ai-sdk/provider';

import { AIError } from './ai-errors';
import { utf8ByteLength } from './ai-operation-limits';

const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_NODES = 100_000;

/** Clone JSON without invoking accessors or retaining caller-owned containers. */
export function snapshotAIJSONValue(
  value: unknown,
  label: string,
  maxBytes = DEFAULT_MAX_BYTES,
): JSONValue {
  const state = { bytes: 0, nodes: 0, maxBytes };
  try {
    return deepFreeze(cloneJSON(value, label, new Set<object>(), 0, state));
  } catch (error) {
    if (error instanceof AIError) throw error;
    throw invalidRequest(`${label} must contain bounded JSON data.`);
  }
}

function cloneJSON(
  value: unknown,
  label: string,
  ancestors: Set<object>,
  depth: number,
  state: { bytes: number; nodes: number; maxBytes: number },
): JSONValue {
  state.nodes += 1;
  if (state.nodes > MAX_NODES || depth > MAX_DEPTH) {
    throw requestLimit(`${label} exceeds the JSON complexity limit.`);
  }
  if (value === null) {
    addBytes(state, 4, label);
    return null;
  }
  if (typeof value === 'string') {
    addBytes(state, utf8ByteLength(value, state.maxBytes) + 2, label);
    return value;
  }
  if (typeof value === 'boolean') {
    addBytes(state, value ? 4 : 5, label);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalidRequest(`${label} contains a non-finite number.`);
    addBytes(state, String(value).length, label);
    return value;
  }
  if (typeof value !== 'object') {
    throw invalidRequest(`${label} contains a non-JSON value.`);
  }
  if (ancestors.has(value)) throw invalidRequest(`${label} cannot contain circular references.`);
  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? cloneArray(value, label, ancestors, depth, state)
      : cloneRecord(value, label, ancestors, depth, state);
  } finally {
    ancestors.delete(value);
  }
}

function cloneArray(
  value: unknown[],
  label: string,
  ancestors: Set<object>,
  depth: number,
  state: { bytes: number; nodes: number; maxBytes: number },
): JSONValue[] {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) {
    throw invalidRequest(`${label} cannot contain sparse or extended arrays.`);
  }
  addBytes(state, 2 + Math.max(0, value.length - 1), label);
  const result = new Array<JSONValue>(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw invalidRequest(`${label} cannot contain sparse or accessor arrays.`);
    }
    result[index] = cloneJSON(descriptor.value, label, ancestors, depth + 1, state);
  }
  return result;
}

function cloneRecord(
  value: object,
  label: string,
  ancestors: Set<object>,
  depth: number,
  state: { bytes: number; nodes: number; maxBytes: number },
): Record<string, JSONValue> {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidRequest(`${label} must contain only plain JSON objects.`);
  }
  const keys = Reflect.ownKeys(value);
  addBytes(state, 2 + Math.max(0, keys.length - 1), label);
  const result = Object.create(null) as Record<string, JSONValue>;
  for (const key of keys) {
    if (typeof key !== 'string') throw invalidRequest(`${label} cannot contain symbol keys.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw invalidRequest(`${label} cannot contain accessors or hidden properties.`);
    }
    addBytes(state, utf8ByteLength(key, state.maxBytes) + 3, label);
    result[key] = cloneJSON(descriptor.value, label, ancestors, depth + 1, state);
  }
  return result;
}

function addBytes(
  state: { bytes: number; maxBytes: number },
  count: number,
  label: string,
): void {
  state.bytes += count;
  if (state.bytes > state.maxBytes) throw requestLimit(`${label} exceeds the JSON byte limit.`);
}

function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function invalidRequest(message: string): AIError {
  return new AIError(message, 'AI_REQUEST_INVALID', 400);
}

function requestLimit(message: string): AIError {
  return new AIError(message, 'AI_REQUEST_LIMIT_EXCEEDED', 413);
}
