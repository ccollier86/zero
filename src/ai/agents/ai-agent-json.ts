/**
 * ai-agent-json.ts
 *
 * Creates detached, deeply frozen JSON snapshots for data that crosses an
 * agent execution boundary. It rejects values whose in-memory size or
 * mutability would not be represented by JSON.stringify().
 */

import { AIError, type AIErrorCode } from '../ai-errors';

const textEncoder = new TextEncoder();
const MAX_JSON_DEPTH = 64;

export interface AIAgentJSONSnapshot<T> {
  readonly value: T;
  readonly bytes: number;
}

/** Snapshot one strict JSON value and measure the exact encoded payload. */
export function snapshotAIAgentJSON<T>(
  value: T,
  label: string,
  code: AIErrorCode,
): AIAgentJSONSnapshot<T> {
  try {
    const snapshot = cloneJSON(value, label, new Set<object>(), 0);
    const serialized = JSON.stringify(snapshot);
    if (serialized === undefined) throw new Error('Top-level value is not JSON data.');
    return {
      value: deepFreeze(snapshot) as T,
      bytes: textEncoder.encode(serialized).byteLength,
    };
  } catch (error) {
    if (error instanceof AIError) throw error;
    const wrapped = new AIError(`${label} must contain only JSON data.`, code, 400);
    Object.defineProperty(wrapped, 'cause', { value: error, configurable: true });
    throw wrapped;
  }
}

function cloneJSON(
  value: unknown,
  label: string,
  ancestors: Set<object>,
  depth: number,
): unknown {
  if (depth > MAX_JSON_DEPTH) throw new Error(`${label} exceeds the maximum JSON depth.`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite number.`);
    return value;
  }
  if (typeof value !== 'object') throw new Error(`${label} contains a non-JSON value.`);
  if (ancestors.has(value)) throw new Error(`${label} contains a cycle.`);

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new Error(`${label} contains a sparse array.`);
        }
        result.push(cloneJSON(value[index], label, ancestors, depth + 1));
      }
      if (Reflect.ownKeys(value).some((key) => key !== 'length'
        && !(typeof key === 'string' && /^(0|[1-9]\d*)$/u.test(key)))) {
        throw new Error(`${label} contains unsupported array properties.`);
      }
      return result;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${label} contains an unsupported object type.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error(`${label} contains symbol properties.`);
    }

    const result: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable || !('value' in descriptor)) {
        throw new Error(`${label} contains hidden or accessor properties.`);
      }
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: cloneJSON(descriptor.value, label, ancestors, depth + 1),
      });
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
