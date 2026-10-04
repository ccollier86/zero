/** Pure, allocation-aware validation for bounded AI batch operations. */

import { AIError } from './ai-errors';
import {
  isPlainAIJSONObject,
  snapshotAIRerankJSONObject,
} from './ai-rerank-document-snapshot';
import type { AIRerankDocument } from './ai-rerank-types';

export const AI_MAX_OPERATION_ITEMS = 10_000;
export const AI_MAX_ITEM_BYTES = 1024 * 1024;
export const AI_MAX_AGGREGATE_BYTES = 16 * 1024 * 1024;
export const AI_MAX_RERANK_QUERY_BYTES = 64 * 1024;
export const AI_DEFAULT_EMBED_PARALLEL_CALLS = 4;
export const AI_MAX_EMBED_PARALLEL_CALLS = 32;
export const AI_MAX_OPERATION_RETRIES = 10;

/** Validated, detached input for a multi-value embedding call. */
export interface ValidatedAIEmbedManyInput {
  values: string[];
  maxParallelCalls: number;
  maxRetries?: number;
}

/** Validated, detached input for a reranking call. */
export interface ValidatedAIRerankInput<VALUE extends AIRerankDocument = AIRerankDocument> {
  query: string;
  documents: VALUE[];
  topN?: number;
  maxRetries?: number;
}

/** Validate embedding count, byte budgets, concurrency, and retries. */
export function validateAIEmbedManyInput(input: {
  values: unknown;
  maxParallelCalls?: unknown;
  maxRetries?: unknown;
}): ValidatedAIEmbedManyInput {
  if (!Array.isArray(input.values) || input.values.length === 0) {
    throw invalidRequest('Embedding values must be a non-empty array.');
  }
  if (input.values.length > AI_MAX_OPERATION_ITEMS) {
    throw requestLimit('Embedding request exceeds the maximum value count.');
  }

  let aggregateBytes = 0;
  const values = new Array<string>(input.values.length);
  for (let index = 0; index < input.values.length; index += 1) {
    const value: unknown = input.values[index];
    if (typeof value !== 'string') {
      throw invalidRequest('Every embedding value must be a string.');
    }
    const bytes = utf8ByteLength(value, AI_MAX_ITEM_BYTES);
    if (bytes > AI_MAX_ITEM_BYTES) {
      throw requestLimit('An embedding value exceeds the maximum byte size.');
    }
    aggregateBytes += bytes;
    if (aggregateBytes > AI_MAX_AGGREGATE_BYTES) {
      throw requestLimit('Embedding values exceed the aggregate byte limit.');
    }
    values[index] = value;
  }

  return {
    values,
    maxParallelCalls: boundedInteger(
      input.maxParallelCalls ?? AI_DEFAULT_EMBED_PARALLEL_CALLS,
      'maxParallelCalls',
      1,
      AI_MAX_EMBED_PARALLEL_CALLS,
    ),
    ...optionalRetries(input.maxRetries),
  };
}

/** Validate and deeply snapshot a homogeneous reranking request. */
export function validateAIRerankInput<
  VALUE extends AIRerankDocument = AIRerankDocument,
>(input: {
  query: unknown;
  documents: unknown;
  topN?: unknown;
  maxRetries?: unknown;
}): ValidatedAIRerankInput<VALUE> {
  if (typeof input.query !== 'string' || !/\S/u.test(input.query)) {
    throw invalidRequest('Rerank query must be a non-blank string.');
  }
  if (utf8ByteLength(input.query, AI_MAX_RERANK_QUERY_BYTES) > AI_MAX_RERANK_QUERY_BYTES) {
    throw requestLimit('Rerank query exceeds the maximum byte size.');
  }
  if (!Array.isArray(input.documents) || input.documents.length === 0) {
    throw invalidRequest('Rerank documents must be a non-empty array.');
  }
  if (input.documents.length > AI_MAX_OPERATION_ITEMS) {
    throw requestLimit('Rerank request exceeds the maximum document count.');
  }

  const documentKind = typeof input.documents[0] === 'string' ? 'string' : 'object';
  const documents = new Array<AIRerankDocument>(input.documents.length);
  let aggregateBytes = 0;

  for (let index = 0; index < input.documents.length; index += 1) {
    const document: unknown = input.documents[index];
    if (documentKind === 'string') {
      if (typeof document !== 'string') {
        throw invalidRequest('Rerank documents must all use the same document type.');
      }
      const bytes = utf8ByteLength(document, AI_MAX_ITEM_BYTES);
      if (bytes > AI_MAX_ITEM_BYTES) {
        throw requestLimit('A rerank document exceeds the maximum byte size.');
      }
      aggregateBytes += bytes;
      documents[index] = document;
    } else {
      if (!isPlainAIJSONObject(document)) {
        throw invalidRequest('Rerank object documents must be plain JSON objects.');
      }
      const snapshot = snapshotAIRerankJSONObject(document, AI_MAX_ITEM_BYTES);
      aggregateBytes += snapshot.bytes;
      documents[index] = snapshot.value;
    }

    if (aggregateBytes > AI_MAX_AGGREGATE_BYTES) {
      throw requestLimit('Rerank documents exceed the aggregate byte limit.');
    }
  }

  const topN = input.topN === undefined
    ? undefined
    : boundedInteger(input.topN, 'topN', 1, documents.length);

  return {
    query: input.query,
    documents: documents as VALUE[],
    ...(topN === undefined ? {} : { topN }),
    ...optionalRetries(input.maxRetries),
  };
}

export function utf8ByteLength(value: string, stopAfter: number): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
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
    } else bytes += 3;
    if (bytes > stopAfter) return bytes;
  }
  return bytes;
}

function optionalRetries(value: unknown): { maxRetries?: number } {
  return value === undefined
    ? {}
    : { maxRetries: boundedInteger(value, 'maxRetries', 0, AI_MAX_OPERATION_RETRIES) };
}

function boundedInteger(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw invalidRequest(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value as number;
}

function invalidRequest(message: string): AIError {
  return new AIError(message, 'AI_REQUEST_INVALID', 400);
}

function requestLimit(message: string): AIError {
  return new AIError(message, 'AI_REQUEST_LIMIT_EXCEEDED', 413);
}
