/** Iterative, allocation-aware JSON snapshots for reranking documents. */

import type { JSONArray, JSONObject, JSONValue } from '@ai-sdk/provider';

import { AIError } from './ai-errors';

export interface AIRerankJSONObjectSnapshot {
  value: JSONObject;
  bytes: number;
}

type CloneContainer = JSONObject | JSONArray | { root?: JSONValue };
type CloneKey = string | number | 'root';

type JSONCloneFrame = {
  kind: 'value';
  source: unknown;
  target: CloneContainer;
  key: CloneKey;
} | {
  kind: 'exit';
  source: object;
};

interface JSONByteCounter {
  bytes: number;
  maxBytes: number;
}

export function isPlainAIJSONObject(value: unknown): value is JSONObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

export function snapshotAIRerankJSONObject(
  source: JSONObject,
  maxBytes: number,
): AIRerankJSONObjectSnapshot {
  const root: { root?: JSONValue } = {};
  const visiting = new WeakSet<object>();
  const counter: JSONByteCounter = { bytes: 0, maxBytes };
  const stack: JSONCloneFrame[] = [{ kind: 'value', source, target: root, key: 'root' }];

  try {
    while (stack.length > 0) {
      const frame = stack.pop()!;
      if (frame.kind === 'exit') {
        visiting.delete(frame.source);
        continue;
      }
      cloneJSONValue(frame, stack, visiting, counter);
    }
  } catch (error) {
    if (error instanceof AIError) throw error;
    throw invalidRequest('Rerank object documents must contain bounded JSON data.');
  }

  if (!isPlainAIJSONObject(root.root)) {
    throw invalidRequest('Rerank object documents must be plain JSON objects.');
  }
  return { value: root.root, bytes: counter.bytes };
}

function cloneJSONValue(
  frame: Extract<JSONCloneFrame, { kind: 'value' }>,
  stack: JSONCloneFrame[],
  visiting: WeakSet<object>,
  counter: JSONByteCounter,
): void {
  const value = frame.source;
  if (value === null) {
    addJSONBytes(counter, 4);
    assignJSONValue(frame.target, frame.key, null);
    return;
  }
  switch (typeof value) {
    case 'string':
      addJSONBytes(counter, jsonStringByteLength(value, counter.maxBytes));
      assignJSONValue(frame.target, frame.key, value);
      return;
    case 'boolean':
      addJSONBytes(counter, value ? 4 : 5);
      assignJSONValue(frame.target, frame.key, value);
      return;
    case 'number':
      if (!Number.isFinite(value)) {
        throw invalidRequest('Rerank object documents cannot contain non-finite numbers.');
      }
      addJSONBytes(counter, String(value).length);
      assignJSONValue(frame.target, frame.key, value);
      return;
    case 'object':
      cloneJSONContainer(value, frame, stack, visiting, counter);
      return;
    default:
      throw invalidRequest('Rerank object documents contain an unsupported JSON value.');
  }
}

function cloneJSONContainer(
  source: object,
  frame: Extract<JSONCloneFrame, { kind: 'value' }>,
  stack: JSONCloneFrame[],
  visiting: WeakSet<object>,
  counter: JSONByteCounter,
): void {
  if (visiting.has(source)) {
    throw invalidRequest('Rerank object documents cannot contain circular references.');
  }
  visiting.add(source);
  stack.push({ kind: 'exit', source });

  if (Array.isArray(source)) {
    const entries = arrayEntries(source, counter);
    const clone: JSONArray = new Array<JSONValue>(entries.length);
    assignJSONValue(frame.target, frame.key, clone);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      stack.push({ kind: 'value', source: entries[index], target: clone, key: index });
    }
    return;
  }

  if (!isPlainAIJSONObject(source)) {
    throw invalidRequest('Rerank object documents must contain only plain objects and arrays.');
  }
  const entries = objectEntries(source, counter);
  const clone = Object.create(Object.getPrototypeOf(source)) as JSONObject;
  assignJSONValue(frame.target, frame.key, clone);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const [key, value] = entries[index];
    stack.push({ kind: 'value', source: value, target: clone, key });
  }
}

function arrayEntries(value: unknown[], counter: JSONByteCounter): unknown[] {
  const length = value.length;
  if (length > counter.maxBytes) {
    throw requestLimit('A rerank document exceeds the maximum byte size.');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || !keys.includes('length')) {
    throw invalidRequest('Rerank object documents cannot contain sparse or extended arrays.');
  }
  for (const key of keys) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !isCanonicalArrayIndex(key, length)) {
      throw invalidRequest('Rerank object documents cannot contain sparse or extended arrays.');
    }
  }

  addJSONBytes(counter, 2 + Math.max(0, length - 1));
  const entries = new Array<unknown>(length);
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw invalidRequest('Rerank object documents cannot contain sparse or accessor arrays.');
    }
    entries[index] = descriptor.value;
  }
  return entries;
}

function objectEntries(value: JSONObject, counter: JSONByteCounter): [string, unknown][] {
  const keys = Reflect.ownKeys(value);
  addJSONBytes(counter, 2 + Math.max(0, keys.length - 1));
  const entries: [string, unknown][] = [];

  for (const key of keys) {
    if (typeof key !== 'string') {
      throw invalidRequest('Rerank object documents cannot contain symbol keys.');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw invalidRequest('Rerank object documents cannot contain hidden or accessor properties.');
    }
    addJSONBytes(counter, jsonStringByteLength(key, counter.maxBytes) + 1);
    entries.push([key, descriptor.value]);
  }
  return entries;
}

function isCanonicalArrayIndex(key: string, length: number): boolean {
  const index = Number(key);
  return Number.isSafeInteger(index)
    && index >= 0
    && index < length
    && String(index) === key;
}

function assignJSONValue(target: CloneContainer, key: CloneKey, value: JSONValue): void {
  if (key === 'root') {
    (target as { root?: JSONValue }).root = value;
    return;
  }
  if (Array.isArray(target)) {
    target[key as number] = value;
    return;
  }
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function addJSONBytes(counter: JSONByteCounter, bytes: number): void {
  counter.bytes += bytes;
  if (counter.bytes > counter.maxBytes) {
    throw requestLimit('A rerank document exceeds the maximum byte size.');
  }
}

function jsonStringByteLength(value: string, stopAfter: number): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) bytes += 2;
    else if (
      code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d
    ) bytes += 2;
    else if (code <= 0x1f) bytes += 6;
    else if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (
      code >= 0xd800
      && code <= 0xdbff
      && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00
      && value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else if (code >= 0xd800 && code <= 0xdfff) bytes += 6;
    else bytes += 3;

    if (bytes > stopAfter) return bytes;
  }
  return bytes;
}

function invalidRequest(message: string): AIError {
  return new AIError(message, 'AI_REQUEST_INVALID', 400);
}

function requestLimit(message: string): AIError {
  return new AIError(message, 'AI_REQUEST_LIMIT_EXCEEDED', 413);
}
