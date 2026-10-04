/**
 * ai-video-response.ts
 *
 * Validates video-provider responses before Zero exposes or persists them.
 * This module owns response integrity and inline byte bounds only; it does not
 * invoke models, resolve aliases, download URLs, or emit telemetry.
 */

import type {
  Experimental_VideoModelV4OperationStatusResult,
  Experimental_VideoModelV4VideoData,
  JSONObject,
  SharedV4ProviderMetadata,
} from '@ai-sdk/provider';
import {
  DefaultGeneratedFile,
  type GenerateVideoResult,
  type StartVideoResult,
} from 'ai';

import { AIError } from './ai-errors';
import { snapshotAIJSONValue } from './ai-json-value-snapshot';
import { utf8ByteLength } from './ai-operation-limits';
import type {
  AIGenerateVideoResult,
  AIStartVideoResult,
  AIVideoStatusResult,
} from './ai-video-types';
import { createAIVideoOperationEnvelope } from './ai-video-operation-envelope';

/** Validate materialized generated files and their per-file byte ceiling. */
export function validateAIGenerateVideoResult(
  result: GenerateVideoResult,
  maxBytes: number
): AIGenerateVideoResult {
  if (!isRecord(result)
    || !Array.isArray(result.videos)
    || result.videos.length === 0
    || result.videos.length > 4
    || result.video !== result.videos[0]
    || !Array.isArray(result.warnings)
    || !Array.isArray(result.responses)) {
    throw invalidProviderResponse('AI video provider returned an invalid generation response.');
  }
  const videos = result.videos.map((video) => {
    if (!isRecord(video)
      || typeof video.mediaType !== 'string'
      || video.mediaType.length === 0
      || !(video.uint8Array instanceof Uint8Array)) {
      throw invalidProviderResponse('AI video provider returned an invalid generated file.');
    }
    if (video.uint8Array.byteLength > maxBytes) throw videoLimit();
    return new DefaultGeneratedFile({
      data: new Uint8Array(video.uint8Array),
      mediaType: video.mediaType,
      ...snapshotGeneratedFileMetadata(video.providerMetadata),
    });
  });
  const responses = result.responses.map((response) => {
    if (!validResponseMetadata(response)) {
      throw invalidProviderResponse('AI video provider returned invalid response metadata.');
    }
    return detachResponseMetadata(response);
  });
  return Object.freeze({
    video: videos[0]!,
    videos: Object.freeze(videos) as unknown as typeof result.videos,
    warnings: snapshotWarnings(result.warnings),
    responses: Object.freeze(responses) as typeof result.responses,
    providerMetadata: snapshotProviderMetadata(result.providerMetadata),
  }) as GenerateVideoResult;
}

/** Replace an SDK operation with a versioned, model-pinned Zero envelope. */
export function validateAIStartVideoResult(
  resolvedModel: string,
  result: StartVideoResult
): AIStartVideoResult {
  if (!isRecord(result)
    || !Array.isArray(result.warnings)
    || !validResponseMetadata(result.response)) {
    throw invalidProviderResponse('AI video provider returned an invalid start response.');
  }
  return Object.freeze({
    operation: createAIVideoOperationEnvelope(resolvedModel, result.operation),
    warnings: snapshotWarnings(result.warnings),
    ...optionalProviderMetadata(result.providerMetadata),
    response: detachResponseMetadata(result.response),
  });
}

/** Validate a single asynchronous status response and bound inline media. */
export function validateAIVideoStatusResult(
  result: Experimental_VideoModelV4OperationStatusResult,
  inlineMaxBytes: number
): AIVideoStatusResult {
  if (!isRecord(result)
    || (result.status !== 'pending'
      && result.status !== 'completed'
      && result.status !== 'error')
    || !validResponseMetadata(result.response)) {
    throw invalidProviderResponse('AI video provider returned an invalid status response.');
  }
  if (result.status === 'pending') {
    if (result.warnings !== undefined && !Array.isArray(result.warnings)) {
      throw invalidProviderResponse('AI video provider returned invalid status warnings.');
    }
    return Object.freeze({
      ...result,
      response: detachResponseMetadata(result.response),
      ...(result.warnings === undefined ? {} : { warnings: snapshotWarnings(result.warnings) }),
      ...optionalProviderMetadata(result.providerMetadata),
    });
  }
  if (result.status === 'error') {
    if (typeof result.error !== 'string'
      || result.error.length === 0
      || utf8ByteLength(result.error, 64 * 1024) > 64 * 1024) {
      throw invalidProviderResponse('AI video provider returned an invalid terminal error.');
    }
    return Object.freeze({
      ...result,
      response: detachResponseMetadata(result.response),
      ...optionalProviderMetadata(result.providerMetadata),
    });
  }
  if (!Array.isArray(result.videos)
    || result.videos.length === 0
    || result.videos.length > 4
    || !Array.isArray(result.warnings)) {
    throw invalidProviderResponse('AI video provider returned invalid completed media.');
  }
  const videos = result.videos.map((video) => snapshotStatusVideo(video, inlineMaxBytes));
  return Object.freeze({
    ...result,
    videos: Object.freeze(videos) as unknown as typeof result.videos,
    warnings: snapshotWarnings(result.warnings),
    response: detachResponseMetadata(result.response),
    ...optionalProviderMetadata(result.providerMetadata),
  });
}

function snapshotStatusVideo(
  video: Experimental_VideoModelV4VideoData,
  maxBytes: number
): Experimental_VideoModelV4VideoData {
  if (!isRecord(video)
    || (video.type !== 'url' && video.type !== 'base64' && video.type !== 'binary')
    || typeof video.mediaType !== 'string'
    || video.mediaType.length === 0) {
    throw invalidProviderResponse('AI video provider returned invalid completed media.');
  }
  if (video.type === 'url') {
    if (typeof video.url !== 'string') {
      throw invalidProviderResponse('AI video provider returned an invalid media URL.');
    }
    try {
      const parsed = new URL(video.url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('protocol');
    } catch {
      throw invalidProviderResponse('AI video provider returned an invalid media URL.');
    }
    return Object.freeze({ ...video, url: video.url });
  }
  if (video.type === 'binary') {
    if (!(video.data instanceof Uint8Array)) {
      throw invalidProviderResponse('AI video provider returned invalid binary media.');
    }
    if (video.data.byteLength > maxBytes) throw videoLimit();
    return Object.freeze({ ...video, data: new Uint8Array(video.data) });
  }
  if (typeof video.data !== 'string') {
    throw invalidProviderResponse('AI video provider returned invalid base64 media.');
  }
  // The encoded length is a conservative allocation-free upper bound.
  if (Math.ceil(video.data.length * 3 / 4) > maxBytes) throw videoLimit();
  return Object.freeze({ ...video, data: video.data });
}

function validResponseMetadata(value: unknown): value is StartVideoResult['response'] {
  return isRecord(value)
    && value.timestamp instanceof Date
    && Number.isFinite(value.timestamp.getTime())
    && typeof value.modelId === 'string'
    && value.modelId.length > 0
    && (value.headers === undefined || isStringRecord(value.headers));
}

function detachResponseMetadata(
  response: StartVideoResult['response']
): {
  timestamp: Date;
  modelId: string;
  headers: Record<string, string> | undefined;
  providerMetadata?: SharedV4ProviderMetadata;
} {
  return Object.freeze({
    timestamp: new Date(response.timestamp.getTime()),
    modelId: response.modelId,
    headers: response.headers === undefined
      ? undefined
      : Object.freeze({ ...response.headers }),
    ...optionalProviderMetadata(response.providerMetadata),
  });
}

function snapshotWarnings<Value>(value: readonly Value[]): Value[] {
  const warnings = value.map((warning) => {
    if (!isRecord(warning) || typeof warning.type !== 'string') {
      throw invalidProviderResponse('AI video provider returned invalid warnings.');
    }
    return Object.freeze({ ...warning }) as Value;
  });
  return Object.freeze(warnings) as Value[];
}

function snapshotGeneratedFileMetadata(
  value: unknown,
): { providerMetadata?: Record<string, JSONObject> } {
  if (value === undefined) return {};
  return {
    providerMetadata: snapshotProviderMetadata(value),
  };
}

function optionalProviderMetadata(value: unknown): { providerMetadata?: SharedV4ProviderMetadata } {
  return value === undefined ? {} : { providerMetadata: snapshotProviderMetadata(value) };
}

function snapshotProviderMetadata(value: unknown): SharedV4ProviderMetadata {
  try {
    const snapshot = snapshotAIJSONValue(value ?? {}, 'AI video provider metadata');
    if (!isRecord(snapshot)) throw new Error('metadata');
    return snapshot as SharedV4ProviderMetadata;
  } catch {
    throw invalidProviderResponse('AI video provider returned invalid provider metadata.');
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function videoLimit(): AIError {
  return new AIError(
    'Generated video exceeds the configured byte limit.',
    'AI_REQUEST_LIMIT_EXCEEDED',
    413
  );
}

function invalidProviderResponse(message: string): AIError {
  return new AIError(message, 'AI_PROVIDER_RESPONSE_INVALID', 502);
}

function optional<Key extends string, Value>(
  key: Key,
  value: Value | undefined
): { [Property in Key]?: Value } {
  return value === undefined ? {} : { [key]: value } as { [Property in Key]: Value };
}
