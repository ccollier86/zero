/**
 * ai-video-validation.ts
 *
 * Applies request, resource, polling, and webhook bounds to preview video
 * operations. This module is pure validation; it does not resolve models,
 * invoke providers, download media, or emit telemetry.
 */

import type { GenerateVideoPrompt } from 'ai';

import { AIError } from './ai-errors';
import { normalizeAIProviderOptions } from './ai-provider-options';
import { snapshotAIHeaders } from './ai-request-snapshot';
import {
  AI_DEFAULT_VIDEO_DOWNLOAD_MAX_BYTES,
  type AIVideoPollOptions,
  type AIVideoRequestOptions,
  type AIVideoWebhookFactory,
} from './ai-video-types';

export const AI_MAX_VIDEOS_PER_REQUEST = 4;
export const AI_MIN_VIDEO_POLL_INTERVAL_MS = 250;
export const AI_MAX_VIDEO_POLL_INTERVAL_MS = 60_000;
export const AI_MIN_VIDEO_POLL_TIMEOUT_MS = 1_000;
export const AI_MAX_VIDEO_POLL_TIMEOUT_MS = 24 * 60 * 60 * 1_000;

const MAX_VIDEO_DURATION_SECONDS = 60 * 60;
const MAX_VIDEO_PROMPT_BYTES = 1024 * 1024;
const MAX_VIDEO_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_VIDEO_INPUT_AGGREGATE_BYTES = 256 * 1024 * 1024;
const MAX_RETRIES = 10;

/** Validated common controls forwarded to SDK video functions. */
export type ValidatedAIVideoRequestOptions = Omit<AIVideoRequestOptions, 'headers'> & {
  n: number;
  headers?: Record<string, string>;
};

/** Validate common generate/start controls and detach mutable arrays. */
export function validateAIVideoRequestOptions(
  request: AIVideoRequestOptions
): ValidatedAIVideoRequestOptions {
  const prompt = snapshotVideoPrompt(request.prompt);
  const n = boundedInteger(request.n ?? 1, 'n', 1, AI_MAX_VIDEOS_PER_REQUEST);
  const maxVideosPerCall = request.maxVideosPerCall === undefined
    ? undefined
    : boundedInteger(
        request.maxVideosPerCall,
        'maxVideosPerCall',
        1,
        AI_MAX_VIDEOS_PER_REQUEST
      );
  const fps = request.fps === undefined
    ? undefined
    : boundedInteger(request.fps, 'fps', 1, 120);
  const duration = request.duration === undefined
    ? undefined
    : boundedFinite(request.duration, 'duration', Number.EPSILON, MAX_VIDEO_DURATION_SECONDS);
  const seed = request.seed === undefined
    ? undefined
    : boundedSafeInteger(request.seed, 'seed');
  const maxRetries = request.maxRetries === undefined
    ? undefined
    : boundedInteger(request.maxRetries, 'maxRetries', 0, MAX_RETRIES);

  validateAspectRatio(request.aspectRatio);
  validateResolution(request.resolution);
  const frameImages = snapshotFrameImages(request.frameImages);
  const inputReferences = snapshotInputReferences(request.inputReferences);

  const {
    prompt: _prompt,
    headers: _headers,
    providerOptions: _providerOptions,
    frameImages: _frameImages,
    inputReferences: _inputReferences,
    ...rest
  } = request;
  return {
    ...rest,
    prompt,
    n,
    ...optional('maxVideosPerCall', maxVideosPerCall),
    ...optional('fps', fps),
    ...optional('duration', duration),
    ...optional('seed', seed),
    ...optional('maxRetries', maxRetries),
    ...optional('headers', snapshotAIHeaders(request.headers)),
    ...optional('providerOptions', normalizeAIProviderOptions(request.providerOptions)),
    ...(frameImages === undefined ? {} : { frameImages }),
    ...(inputReferences === undefined ? {} : { inputReferences }),
  };
}

/** Validate the materialized output ceiling and apply Zero's 256 MiB default. */
export function validateAIVideoDownloadLimit(
  value: unknown,
  name = 'downloadMaxBytes'
): number {
  const maxBytes = value ?? AI_DEFAULT_VIDEO_DOWNLOAD_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes)
    || (maxBytes as number) < 1
    || (maxBytes as number) > AI_DEFAULT_VIDEO_DOWNLOAD_MAX_BYTES) {
    throw invalidRequest(
      `${name} must be an integer between 1 and ${AI_DEFAULT_VIDEO_DOWNLOAD_MAX_BYTES}.`
    );
  }
  return maxBytes as number;
}

/** Validate bounded polling controls before allowing an SDK polling loop. */
export function validateAIVideoPollOptions(
  value: AIVideoPollOptions | undefined
): AIVideoPollOptions | undefined {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) throw invalidRequest('Video poll settings are invalid.');
  const intervalMs = value.intervalMs === undefined
    ? undefined
    : boundedInteger(
        value.intervalMs,
        'poll.intervalMs',
        AI_MIN_VIDEO_POLL_INTERVAL_MS,
        AI_MAX_VIDEO_POLL_INTERVAL_MS
      );
  const timeoutMs = value.timeoutMs === undefined
    ? undefined
    : boundedInteger(
        value.timeoutMs,
        'poll.timeoutMs',
        AI_MIN_VIDEO_POLL_TIMEOUT_MS,
        AI_MAX_VIDEO_POLL_TIMEOUT_MS
      );
  if (intervalMs !== undefined && timeoutMs !== undefined && intervalMs > timeoutMs) {
    throw invalidRequest('poll.intervalMs cannot exceed poll.timeoutMs.');
  }
  if (value.delay !== undefined && typeof value.delay !== 'function') {
    throw invalidRequest('poll.delay must be a function.');
  }
  const delay = value.delay as AIVideoPollOptions['delay'];
  return {
    ...optional('intervalMs', intervalMs),
    ...optional('timeoutMs', timeoutMs),
    ...optional('delay', delay),
  };
}

/** Validate one provider-facing webhook URL. */
export function validateAIVideoWebhookURL(
  value: unknown,
  allowInsecureLocalhost: boolean
): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw invalidRequest('Video webhook URL must be a non-empty URL string.');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidRequest('Video webhook URL is invalid.');
  }
  if (url.protocol === 'https:') return url.toString();
  if (url.protocol === 'http:'
    && allowInsecureLocalhost
    && isLocalhost(url.hostname)) {
    return url.toString();
  }
  throw invalidRequest('Video webhook URL must use HTTPS outside local development.');
}

/** Wrap a webhook factory so its URL is checked only if the model uses it. */
export function validateAIVideoWebhookFactory(
  factory: AIVideoWebhookFactory | undefined,
  allowInsecureLocalhost: boolean
): AIVideoWebhookFactory | undefined {
  if (factory === undefined) return undefined;
  if (typeof factory !== 'function') throw invalidRequest('Video webhook must be a function.');
  return async () => {
    const result = await factory();
    if (!isPlainRecord(result)
      || typeof result.url !== 'string'
      || !isPromiseLike(result.received)) {
      throw invalidRequest('Video webhook factory returned an invalid receiver.');
    }
    return {
      url: validateAIVideoWebhookURL(result.url, allowInsecureLocalhost),
      received: result.received,
    };
  };
}

function snapshotVideoPrompt(value: unknown): GenerateVideoPrompt {
  if (typeof value === 'string') {
    if (!/\S/u.test(value)) throw invalidRequest('Video prompt must not be blank.');
    if (utf8Bytes(value) > MAX_VIDEO_PROMPT_BYTES) {
      throw requestLimit('Video prompt exceeds the configured byte limit.');
    }
    return value;
  }
  if (!isPlainRecord(value) || !('image' in value)) {
    throw invalidRequest('Video prompt must contain text or an image.');
  }
  if (value.text !== undefined && (typeof value.text !== 'string' || !/\S/u.test(value.text))) {
    throw invalidRequest('Video prompt text must not be blank.');
  }
  if (typeof value.text === 'string' && utf8Bytes(value.text) > MAX_VIDEO_PROMPT_BYTES) {
    throw requestLimit('Video prompt exceeds the configured byte limit.');
  }
  return Object.freeze({
    image: snapshotVideoDataContent(value.image, 'prompt image').value,
    ...(value.text === undefined ? {} : { text: value.text }),
  });
}

function validateAspectRatio(value: unknown): void {
  if (value === undefined || value === 'adaptive') return;
  if (typeof value !== 'string' || !/^[1-9]\d*:[1-9]\d*$/u.test(value)) {
    throw invalidRequest('aspectRatio must use width:height or adaptive.');
  }
  const [width, height] = value.split(':').map(Number);
  if (!Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width > 10_000
    || height > 10_000) {
    throw invalidRequest('aspectRatio components must be integers between 1 and 10000.');
  }
}

function validateResolution(value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || !/^[1-9]\d*x[1-9]\d*$/u.test(value)) {
    throw invalidRequest('resolution must use WIDTHxHEIGHT.');
  }
  const [width, height] = value.split('x').map(Number);
  if (!Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width > 16_384
    || height > 16_384) {
    throw invalidRequest('resolution dimensions must be integers between 1 and 16384.');
  }
}

function snapshotFrameImages(value: unknown): AIVideoRequestOptions['frameImages'] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > 2) {
    throw invalidRequest('frameImages must contain one or two role-tagged images.');
  }
  const roles = new Set<string>();
  const result: NonNullable<AIVideoRequestOptions['frameImages']> = [];
  for (const entry of value) {
    if (!isPlainRecord(entry)
      || (entry.frameType !== 'first_frame' && entry.frameType !== 'last_frame')
      || !('image' in entry)
      || roles.has(entry.frameType)) {
      throw invalidRequest('frameImages contain an invalid or duplicate frame role.');
    }
    result.push(Object.freeze({
      frameType: entry.frameType,
      image: snapshotVideoDataContent(entry.image, 'frame image').value,
    }));
    roles.add(entry.frameType);
  }
  return Object.freeze(result) as NonNullable<AIVideoRequestOptions['frameImages']>;
}

function snapshotInputReferences(value: unknown): AIVideoRequestOptions['inputReferences'] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) {
    throw invalidRequest('inputReferences must contain between 1 and 16 entries.');
  }
  let aggregateBytes = 0;
  const result: NonNullable<AIVideoRequestOptions['inputReferences']> = [];
  for (const entry of value) {
    if (isPlainRecord(entry)) {
      if (!('data' in entry)
        || (entry.mediaType !== undefined
          && (typeof entry.mediaType !== 'string'
            || entry.mediaType.length === 0
            || /[\u0000-\u001f\u007f-\u009f]/u.test(entry.mediaType)))) {
        throw invalidRequest('Video input reference is invalid.');
      }
      const data = snapshotVideoDataContent(entry.data, 'input reference');
      aggregateBytes += data.bytes;
      result.push(Object.freeze({
        data: data.value,
        ...(entry.mediaType === undefined ? {} : { mediaType: entry.mediaType }),
      }));
    } else {
      const data = snapshotVideoDataContent(entry, 'input reference');
      aggregateBytes += data.bytes;
      result.push(data.value);
    }
    if (aggregateBytes > MAX_VIDEO_INPUT_AGGREGATE_BYTES) {
      throw requestLimit('Video input references exceed the aggregate byte limit.');
    }
  }
  return Object.freeze(result) as NonNullable<AIVideoRequestOptions['inputReferences']>;
}

function snapshotVideoDataContent(value: unknown, label: string): {
  value: string | Uint8Array | ArrayBuffer;
  bytes: number;
} {
  let bytes: number;
  let snapshot: string | Uint8Array | ArrayBuffer;
  if (typeof value === 'string') {
    bytes = utf8Bytes(value);
    snapshot = value;
  } else if (value instanceof Uint8Array) {
    bytes = value.byteLength;
    snapshot = new Uint8Array(value);
  } else if (value instanceof ArrayBuffer) {
    bytes = value.byteLength;
    snapshot = value.slice(0);
  }
  else throw invalidRequest(`Video ${label} data is invalid.`);
  if (bytes > MAX_VIDEO_INPUT_BYTES) {
    throw requestLimit(`Video ${label} exceeds the per-input byte limit.`);
  }
  return { value: snapshot, bytes };
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function boundedInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw invalidRequest(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value as number;
}

function boundedSafeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value)) throw invalidRequest(`${name} must be a safe integer.`);
  return value as number;
}

function boundedFinite(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number'
    || !Number.isFinite(value)
    || value < minimum
    || value > maximum) {
    throw invalidRequest(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return value !== null
    && (typeof value === 'object' || typeof value === 'function')
    && typeof (value as PromiseLike<unknown>).then === 'function';
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

function optional<Key extends string, Value>(
  key: Key,
  value: Value | undefined
): { [Property in Key]?: Value } {
  return value === undefined ? {} : { [key]: value } as { [Property in Key]: Value };
}
