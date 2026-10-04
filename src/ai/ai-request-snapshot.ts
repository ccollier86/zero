/** Immutable, bounded snapshots for mutable AI request controls. */

import type { TimeoutConfiguration, ToolSet } from 'ai';

import { AIError } from './ai-errors';
import { utf8ByteLength } from './ai-operation-limits';

const MAX_HEADER_COUNT = 256;
const MAX_HEADER_NAME_BYTES = 256;
const MAX_HEADER_VALUE_BYTES = 64 * 1024;
const MAX_HEADER_AGGREGATE_BYTES = 1024 * 1024;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const HTTP_FIELD_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;

/** Detach caller-owned headers and reject values that cannot be sent safely. */
export function snapshotAIHeaders(
  value: Record<string, string | undefined> | undefined,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) throw invalidRequest('AI request headers must be a plain object.');

  const keys = Reflect.ownKeys(value);
  if (keys.length > MAX_HEADER_COUNT) {
    throw requestLimit(`AI request headers cannot exceed ${MAX_HEADER_COUNT} entries.`);
  }

  const snapshot = Object.create(null) as Record<string, string>;
  let aggregateBytes = 0;
  for (const key of keys) {
    if (typeof key !== 'string' || !HTTP_FIELD_NAME.test(key)) {
      throw invalidRequest('AI request contains an invalid header name.');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw invalidRequest('AI request headers cannot contain accessors or hidden properties.');
    }
    const headerValue: unknown = descriptor.value;
    if (headerValue === undefined) continue;
    if (typeof headerValue !== 'string' || /[\r\n\0]/u.test(headerValue)) {
      throw invalidRequest('AI request contains an invalid header value.');
    }
    const nameBytes = utf8ByteLength(key, MAX_HEADER_NAME_BYTES);
    const valueBytes = utf8ByteLength(headerValue, MAX_HEADER_VALUE_BYTES);
    if (nameBytes > MAX_HEADER_NAME_BYTES || valueBytes > MAX_HEADER_VALUE_BYTES) {
      throw requestLimit('An AI request header exceeds the byte limit.');
    }
    aggregateBytes += nameBytes + valueBytes;
    if (aggregateBytes > MAX_HEADER_AGGREGATE_BYTES) {
      throw requestLimit('AI request headers exceed the aggregate byte limit.');
    }
    snapshot[key] = headerValue;
  }
  return Object.freeze(snapshot);
}

/** Detach a timeout configuration before asynchronous steps can observe mutation. */
export function snapshotAITimeout<Tools extends ToolSet>(
  value: TimeoutConfiguration<Tools> | undefined,
): TimeoutConfiguration<Tools> | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return validTimeout(value, 'timeout');
  if (!isPlainRecord(value)) throw invalidRequest('AI timeout settings must be a plain object.');

  const allowed = new Set([
    'totalMs',
    'stepMs',
    'firstChunkMs',
    'chunkMs',
    'toolMs',
    'tools',
  ]);
  assertDataProperties(value, allowed, 'AI timeout settings');
  const tools = value.tools === undefined
    ? undefined
    : snapshotToolTimeouts(value.tools as Record<string, unknown>);
  return Object.freeze({
    ...optionalTimeout('totalMs', value.totalMs),
    ...optionalTimeout('stepMs', value.stepMs),
    ...optionalTimeout('firstChunkMs', value.firstChunkMs),
    ...optionalTimeout('chunkMs', value.chunkMs),
    ...optionalTimeout('toolMs', value.toolMs),
    ...(tools === undefined ? {} : { tools }),
  }) as TimeoutConfiguration<Tools>;
}

/** Copy a signing key so approval signatures cannot race caller mutation. */
export function snapshotAIToolApprovalSecret(
  value: string | Uint8Array | undefined,
): string | Uint8Array | undefined {
  return value instanceof Uint8Array ? new Uint8Array(value) : value;
}

/** Copy a caller-owned string list before the SDK retains it across steps. */
export function snapshotAIStringList<Value extends string>(
  value: readonly Value[] | undefined,
  label: string,
): Value[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw invalidRequest(`${label} must be an array of strings.`);
  }
  return Object.freeze([...value]) as Value[];
}

function snapshotToolTimeouts(value: Record<string, unknown>): Readonly<Record<string, number>> {
  if (!isPlainRecord(value)) {
    throw invalidRequest('AI per-tool timeout settings must be a plain object.');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length > 256) throw requestLimit('AI per-tool timeout settings exceed 256 entries.');
  const result = Object.create(null) as Record<string, number>;
  for (const key of keys) {
    if (typeof key !== 'string' || !key.endsWith('Ms') || key.length <= 2) {
      throw invalidRequest('AI per-tool timeout keys must end in "Ms".');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw invalidRequest('AI per-tool timeout settings cannot contain accessors or hidden properties.');
    }
    result[key] = validTimeout(descriptor.value, `timeout.tools.${key}`);
  }
  return Object.freeze(result);
}

function optionalTimeout<Key extends string>(
  key: Key,
  value: unknown,
): { [Property in Key]?: number } {
  return value === undefined
    ? {}
    : { [key]: validTimeout(value, `timeout.${key}`) } as { [Property in Key]: number };
}

function validTimeout(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_TIMER_DELAY_MS) {
    throw invalidRequest(`${label} must be an integer between 1 and ${MAX_TIMER_DELAY_MS}.`);
  }
  return value as number;
}

function assertDataProperties(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      throw invalidRequest(`${label} contains an unknown property.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw invalidRequest(`${label} cannot contain accessors or hidden properties.`);
    }
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function invalidRequest(message: string): AIError {
  return new AIError(message, 'AI_REQUEST_INVALID', 400);
}

function requestLimit(message: string): AIError {
  return new AIError(message, 'AI_REQUEST_LIMIT_EXCEEDED', 413);
}
