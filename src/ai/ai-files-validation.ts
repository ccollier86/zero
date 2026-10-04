/**
 * ai-files-validation.ts
 *
 * Validates and snapshots provider-hosted file inputs and references. This
 * module owns resource and path-safety bounds only; it does not call provider
 * APIs, consume application authorization, or emit telemetry.
 */

import type { SharedV4ProviderReference } from '@ai-sdk/provider';

import { AIError } from './ai-errors';
import {
  AI_DEFAULT_HOSTED_FILE_MAX_BYTES,
  type AIHostedFileLocator,
  type AIHostedFileUploadSource,
} from './ai-files-types';

const MAX_FILENAME_BYTES = 255;
const MAX_MEDIA_TYPE_LENGTH = 255;
const MAX_PROVIDER_ID_LENGTH = 255;
const MAX_REFERENCE_ENTRIES = 32;
const MAX_REFERENCE_KEY_BYTES = 255;
const MAX_REFERENCE_VALUE_BYTES = 16 * 1024;
const FORBIDDEN_REFERENCE_KEYS = new Set(['__proto__', 'prototype', 'constructor', 'type']);

/** Validated upload input detached from mutable caller-owned byte arrays. */
export interface ValidatedAIHostedFileUpload {
  data: AIHostedFileUploadSource;
  mediaType: string;
  filename?: string;
  maxBytes: number;
}

/** Validate one upload without accepting network URLs as a data source. */
export function validateAIHostedFileUpload(input: {
  data: unknown;
  mediaType: unknown;
  filename?: unknown;
  maxBytes?: unknown;
}): ValidatedAIHostedFileUpload {
  const maxBytes = validateAIFileByteLimit(input.maxBytes);
  const data = validateUploadSource(input.data, maxBytes);
  const mediaType = validateMediaType(input.mediaType);
  const filename = input.filename === undefined
    ? undefined
    : validateFilename(input.filename);
  return {
    data,
    mediaType,
    ...(filename === undefined ? {} : { filename }),
    maxBytes,
  };
}

/** Validate an optional transfer limit and apply Zero's 64 MiB default. */
export function validateAIFileByteLimit(value: unknown): number {
  const maxBytes = value ?? AI_DEFAULT_HOSTED_FILE_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes)
    || (maxBytes as number) < 1
    || (maxBytes as number) > AI_DEFAULT_HOSTED_FILE_MAX_BYTES) {
    throw invalidRequest(
      `maxBytes must be an integer between 1 and ${AI_DEFAULT_HOSTED_FILE_MAX_BYTES}.`
    );
  }
  return maxBytes as number;
}

/** Validate and detach a persisted hosted-file locator. */
export function validateAIHostedFileLocator(value: unknown): AIHostedFileLocator {
  if (!isPlainRecord(value) || value.version !== 1) {
    throw invalidRequest('Hosted file locator must use version 1.');
  }
  if (typeof value.providerId !== 'string'
    || value.providerId.length === 0
    || value.providerId.length > MAX_PROVIDER_ID_LENGTH
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value.providerId)) {
    throw invalidRequest('Hosted file locator has an invalid provider id.');
  }
  return Object.freeze({
    version: 1 as const,
    providerId: value.providerId,
    providerReference: snapshotProviderReference(value.providerReference, 'request'),
  });
}

/** Validate a provider response reference and bind it to Zero's provider id. */
export function createAIHostedFileLocator(
  providerId: string,
  providerReference: unknown
): AIHostedFileLocator {
  if (typeof providerId !== 'string'
    || providerId.length === 0
    || providerId.length > MAX_PROVIDER_ID_LENGTH
    || /[\u0000-\u001f\u007f-\u009f]/u.test(providerId)) {
    throw invalidProviderResponse('AI files provider resolved an invalid provider id.');
  }
  return Object.freeze({
    version: 1 as const,
    providerId,
    providerReference: snapshotProviderReference(providerReference, 'provider'),
  });
}

/** Merge a provider's operated reference without dropping existing entries. */
export function mergeAIHostedFileReference(
  file: AIHostedFileLocator,
  providerReference: unknown
): AIHostedFileLocator {
  const current = validateAIHostedFileLocator(file);
  const incoming = snapshotProviderReference(providerReference, 'provider');
  const merged = Object.create(null) as SharedV4ProviderReference;
  for (const [key, value] of Object.entries(current.providerReference)) merged[key] = value;
  for (const [key, value] of Object.entries(incoming)) merged[key] = value;
  return createAIHostedFileLocator(current.providerId, merged);
}

/** Validate optional provider-reported byte counts and transfer ceilings. */
export function validateAIProviderByteSize(value: unknown, maxBytes?: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalidProviderResponse('AI files provider returned an invalid byte size.');
  }
  if (maxBytes !== undefined && (value as number) > maxBytes) {
    throw requestLimit('Provider-hosted file exceeds the configured byte limit.');
  }
  return value as number;
}

/** Validate and detach an optional provider-reported timestamp. */
export function validateAIProviderDate(value: unknown): Date | undefined {
  if (value === undefined) return undefined;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw invalidProviderResponse('AI files provider returned an invalid timestamp.');
  }
  return new Date(value.getTime());
}

/** Validate an optional provider-returned filename before exposing it. */
export function validateAIProviderFilename(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    return validateFilename(value);
  } catch {
    throw invalidProviderResponse('AI files provider returned an invalid filename.');
  }
}

/** Validate an optional provider-returned media type before exposing it. */
export function validateAIProviderMediaType(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    return validateMediaType(value);
  } catch {
    throw invalidProviderResponse('AI files provider returned an invalid media type.');
  }
}

function validateUploadSource(value: unknown, maxBytes: number): AIHostedFileUploadSource {
  if (!isPlainRecord(value) || typeof value.type !== 'string') {
    throw invalidRequest('Hosted file data must be tagged as data, text, or stream.');
  }
  switch (value.type) {
    case 'data': {
      if (!(value.data instanceof Uint8Array)) {
        throw invalidRequest('Hosted file data must be a Uint8Array.');
      }
      if (value.data.byteLength > maxBytes) {
        throw requestLimit('Hosted file upload exceeds the configured byte limit.');
      }
      return { type: 'data', data: value.data.slice() };
    }
    case 'text': {
      if (typeof value.text !== 'string') {
        throw invalidRequest('Hosted text file data must be a string.');
      }
      if (new TextEncoder().encode(value.text).byteLength > maxBytes) {
        throw requestLimit('Hosted file upload exceeds the configured byte limit.');
      }
      return { type: 'text', text: value.text };
    }
    case 'stream':
      if (!(value.stream instanceof ReadableStream)) {
        throw invalidRequest('Hosted file stream must be a ReadableStream.');
      }
      if (value.stream.locked) {
        throw invalidRequest('Hosted file stream is already locked.');
      }
      return { type: 'stream', stream: value.stream as ReadableStream<Uint8Array> };
    case 'url':
      throw invalidRequest('Uploading provider-hosted files from a URL is not permitted.');
    default:
      throw invalidRequest('Hosted file data must be tagged as data, text, or stream.');
  }
}

function validateMediaType(value: unknown): string {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_MEDIA_TYPE_LENGTH
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    || !/^[A-Za-z0-9!#$&^_.+\-]+\/[A-Za-z0-9!#$&^_.+\-]+(?:\s*;[^\r\n]*)?$/u.test(value)) {
    throw invalidRequest('Hosted file mediaType must be a valid IANA media type.');
  }
  return value;
}

function validateFilename(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidRequest('Hosted file filename must be a non-empty string.');
  }
  if (value === '.' || value === '..'
    || /[\/\\\u0000-\u001f\u007f-\u009f]/u.test(value)
    || new TextEncoder().encode(value).byteLength > MAX_FILENAME_BYTES) {
    throw invalidRequest('Hosted file filename contains a path separator, control character, or exceeds 255 bytes.');
  }
  return value;
}

function snapshotProviderReference(
  value: unknown,
  source: 'request' | 'provider'
): SharedV4ProviderReference {
  const malformed = (): AIError => source === 'request'
    ? invalidRequest('Hosted file locator has an invalid provider reference.')
    : invalidProviderResponse('AI files provider returned an invalid file reference.');
  if (!isPlainRecord(value)) {
    throw malformed();
  }
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > MAX_REFERENCE_ENTRIES) {
    throw malformed();
  }

  const snapshot = Object.create(null) as SharedV4ProviderReference;
  for (const [key, id] of entries) {
    if (FORBIDDEN_REFERENCE_KEYS.has(key)
      || key.length === 0
      || new TextEncoder().encode(key).byteLength > MAX_REFERENCE_KEY_BYTES
      || typeof id !== 'string'
      || id.length === 0
      || /[\u0000-\u001f\u007f-\u009f]/u.test(id)
      || new TextEncoder().encode(id).byteLength > MAX_REFERENCE_VALUE_BYTES) {
      throw malformed();
    }
    snapshot[key] = id;
  }
  return Object.freeze(snapshot);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalidRequest(message: string): AIError {
  return new AIError(message, 'AI_REQUEST_INVALID', 400);
}

function requestLimit(message: string): AIError {
  return new AIError(message, 'AI_REQUEST_LIMIT_EXCEEDED', 413);
}

function invalidProviderResponse(message: string): AIError {
  return new AIError(message, 'AI_PROVIDER_RESPONSE_INVALID', 502);
}
