/**
 * ai-video-operation-envelope.ts
 *
 * Owns validation and immutable snapshots for durable video operation
 * envelopes. It does not resolve models, poll providers, or persist jobs.
 */

import type { JSONValue } from '@ai-sdk/provider';

import { AIError } from './ai-errors';
import { parseAIModelReference } from './ai-model-aliases';
import type { AIVideoOperationEnvelope } from './ai-video-types';

const MAX_OPERATION_BYTES = 1024 * 1024;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 10_000;

/** Snapshot an SDK start operation into Zero's versioned durable envelope. */
export function createAIVideoOperationEnvelope(
  resolvedModel: string,
  operation: unknown
): AIVideoOperationEnvelope {
  if (!parseAIModelReference(resolvedModel)) {
    throw invalidProviderResponse('AI video provider resolved an invalid model reference.');
  }
  return deepFreeze({
    version: 1 as const,
    resolvedModel,
    operation: snapshotJSON(operation, 'provider'),
  });
}

/** Validate an untrusted persisted operation before resolving its pinned model. */
export function validateAIVideoOperationEnvelope(
  value: unknown
): AIVideoOperationEnvelope {
  if (!isPlainRecord(value)
    || value.version !== 1
    || typeof value.resolvedModel !== 'string'
    || value.resolvedModel.length > 1024
    || !parseAIModelReference(value.resolvedModel)) {
    throw invalidRequest('Video operation envelope is invalid or unsupported.');
  }
  return deepFreeze({
    version: 1 as const,
    resolvedModel: value.resolvedModel,
    operation: snapshotJSON(value.operation, 'request'),
  });
}

function snapshotJSON(value: unknown, source: 'request' | 'provider'): JSONValue {
  let nodes = 0;
  let bytes = 0;
  const addBytes = (count: number): void => {
    bytes += count;
    if (bytes > MAX_OPERATION_BYTES) throw malformedJSON(source);
  };
  const clone = (input: unknown, depth: number): JSONValue => {
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) throw malformedJSON(source);
    if (input === null) {
      addBytes(4);
      return input;
    }
    if (typeof input === 'boolean') {
      addBytes(input ? 4 : 5);
      return input;
    }
    if (typeof input === 'string') {
      addBytes(utf8Bytes(input) + 2);
      return input;
    }
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw malformedJSON(source);
      addBytes(String(input).length);
      return input;
    }
    if (Array.isArray(input)) {
      addBytes(input.length + 2);
      const output = new Array<JSONValue>(input.length);
      for (let index = 0; index < input.length; index += 1) {
        if (!Object.hasOwn(input, index)) throw malformedJSON(source);
        output[index] = clone(input[index], depth + 1);
      }
      return output;
    }
    if (!isPlainRecord(input)) throw malformedJSON(source);
    const output = Object.create(null) as Record<string, JSONValue>;
    const entries = Object.entries(input);
    addBytes(entries.length + 2);
    for (const [key, entry] of entries) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        throw malformedJSON(source);
      }
      addBytes(utf8Bytes(key) + 3);
      output[key] = clone(entry, depth + 1);
    }
    return output;
  };

  let result: JSONValue;
  try {
    result = clone(value, 0);
    const serialized = JSON.stringify(result);
    if (serialized === undefined || utf8Bytes(serialized) > MAX_OPERATION_BYTES) {
      throw malformedJSON(source);
    }
  } catch (error) {
    if (error instanceof AIError) throw error;
    throw malformedJSON(source);
  }
  return result;
}

function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function malformedJSON(source: 'request' | 'provider'): AIError {
  return source === 'request'
    ? invalidRequest('Video operation contains invalid or oversized JSON data.')
    : invalidProviderResponse('AI video provider returned an invalid operation reference.');
}

function invalidRequest(message: string): AIError {
  return new AIError(message, 'AI_REQUEST_INVALID', 400);
}

function invalidProviderResponse(message: string): AIError {
  return new AIError(message, 'AI_PROVIDER_RESPONSE_INVALID', 502);
}
