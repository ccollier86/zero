/** Validates and snapshots provider-specific request options at the SDK edge. */

import type { JSONValue } from '@ai-sdk/provider';
import type { ProviderOptions } from '@ai-sdk/provider-utils';

import { AIError } from './ai-errors';
import type { AIProviderOptions } from './ai-types';

const MAX_PROVIDER_OPTIONS_BYTES = 1024 * 1024;
const MAX_PROVIDER_OPTIONS_DEPTH = 32;
const MAX_PROVIDER_OPTIONS_NODES = 100_000;

/** Preserve Zero's broad public type while enforcing SDK JSON at runtime. */
export function normalizeAIProviderOptions(
  value: AIProviderOptions | undefined,
): ProviderOptions | undefined {
  if (value === undefined) return undefined;
  try {
    const snapshot = cloneObject(value, new Set<object>(), 0, { nodes: 0 });
    const serialized = JSON.stringify(snapshot);
    if (new TextEncoder().encode(serialized).byteLength > MAX_PROVIDER_OPTIONS_BYTES) {
      throw new AIError(
        'AI provider options exceed the byte limit.',
        'AI_REQUEST_LIMIT_EXCEEDED',
        413,
      );
    }
    return deepFreeze(snapshot) as ProviderOptions;
  } catch (error) {
    if (error instanceof AIError) throw error;
    throw invalid();
  }
}

function cloneObject(
  value: unknown,
  ancestors: Set<object>,
  depth: number,
  state: { nodes: number },
): Record<string, JSONValue> {
  state.nodes += 1;
  if (!isPlainObject(value)
    || depth > MAX_PROVIDER_OPTIONS_DEPTH
    || state.nodes > MAX_PROVIDER_OPTIONS_NODES
    || ancestors.has(value)) throw invalid();
  ancestors.add(value);
  try {
    const result = Object.create(null) as Record<string, JSONValue>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw invalid();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw invalid();
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: cloneValue(descriptor.value, ancestors, depth + 1, state),
      });
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function cloneValue(
  value: unknown,
  ancestors: Set<object>,
  depth: number,
  state: { nodes: number },
): JSONValue {
  state.nodes += 1;
  if (state.nodes > MAX_PROVIDER_OPTIONS_NODES) throw invalid();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (depth > MAX_PROVIDER_OPTIONS_DEPTH || ancestors.has(value)) throw invalid();
    ancestors.add(value);
    try {
      const result: JSONValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) throw invalid();
        result.push(cloneValue(value[index], ancestors, depth + 1, state));
      }
      return result;
    } finally {
      ancestors.delete(value);
    }
  }
  if (isPlainObject(value)) {
    state.nodes -= 1;
    return cloneObject(value, ancestors, depth, state);
  }
  throw invalid();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function invalid(): AIError {
  return new AIError(
    'AI provider options must contain only plain JSON data.',
    'AI_REQUEST_INVALID',
    400,
  );
}
