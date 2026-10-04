/** Bounded image-generation orchestration and provider-result validation. */

import {
  InvalidResponseDataError,
  TypeValidationError,
  generateImage,
  type ImageModel,
} from 'ai';

import { AIError } from './ai-errors';
import { snapshotAIJSONValue } from './ai-json-value-snapshot';
import { utf8ByteLength } from './ai-operation-limits';
import type { AIRequestTelemetry } from './ai-request-telemetry';
import { normalizeAIRequestError } from './ai-service-support';
import { normalizeAIProviderOptions } from './ai-provider-options';
import { snapshotAIHeaders } from './ai-request-snapshot';
import type {
  AIDataContent,
  AIGenerateImageRequest,
  AIImagePrompt,
  AIImageResult,
} from './ai-types';

export const AI_MAX_IMAGES_PER_REQUEST = 16;
export const AI_MAX_IMAGE_INPUT_BYTES = 64 * 1024 * 1024;
export const AI_MAX_GENERATED_IMAGE_BYTES = 64 * 1024 * 1024;
export const AI_MAX_GENERATED_IMAGE_AGGREGATE_BYTES = 256 * 1024 * 1024;

export interface AIImageOperationContext {
  readonly model: ImageModel;
  readonly requestTelemetry: AIRequestTelemetry;
}

/** Generate bounded images without allowing caller-controlled provider fanout. */
export async function executeAIGenerateImage(
  request: AIGenerateImageRequest,
  context: AIImageOperationContext,
): Promise<AIImageResult> {
  try {
    const validated = validateImageRequest(request);
    const result = await generateImage({
      model: validateImageModelResponses(context.model),
      prompt: validated.prompt,
      n: validated.n,
      maxImagesPerCall: validated.maxImagesPerCall,
      size: request.size,
      aspectRatio: request.aspectRatio,
      seed: request.seed,
      maxRetries: validated.maxRetries,
      abortSignal: request.abortSignal,
      headers: snapshotAIHeaders(request.headers),
      providerOptions: normalizeAIProviderOptions(request.providerOptions),
    });
    validateImageResult(result, validated.n);
    context.requestTelemetry.complete({ usage: result.usage });
    return result;
  } catch (error) {
    const normalized = normalizeImageError(error, request.abortSignal);
    context.requestTelemetry.fail(normalized);
    throw normalized;
  }
}

interface ValidatedImageRequest {
  readonly prompt: AIImagePrompt;
  readonly n: number;
  readonly maxImagesPerCall?: number;
  readonly maxRetries?: number;
}

function validateImageRequest(request: AIGenerateImageRequest): ValidatedImageRequest {
  const n = boundedInteger(request.n ?? 1, 'n', 1, AI_MAX_IMAGES_PER_REQUEST);
  const maxImagesPerCall = request.maxImagesPerCall === undefined
    ? undefined
    : boundedInteger(
        request.maxImagesPerCall,
        'maxImagesPerCall',
        1,
        AI_MAX_IMAGES_PER_REQUEST,
      );
  const maxRetries = request.maxRetries === undefined
    ? undefined
    : boundedInteger(request.maxRetries, 'maxRetries', 0, 10);
  return {
    prompt: snapshotImagePrompt(request.prompt),
    n,
    ...(maxImagesPerCall === undefined ? {} : { maxImagesPerCall }),
    ...(maxRetries === undefined ? {} : { maxRetries }),
  };
}

function snapshotImagePrompt(prompt: AIImagePrompt): AIImagePrompt {
  if (typeof prompt === 'string') {
    assertInputBytes(utf8ByteLength(prompt, AI_MAX_IMAGE_INPUT_BYTES));
    return prompt;
  }
  if (!prompt || typeof prompt !== 'object' || !Array.isArray(prompt.images)
    || prompt.images.length === 0 || prompt.images.length > AI_MAX_IMAGES_PER_REQUEST) {
    throw invalidRequest('Image prompt inputs must contain 1 through 16 images.');
  }

  let bytes = 0;
  const images = prompt.images.map((image) => {
    const snapshot = snapshotImageContent(image);
    bytes += snapshot.bytes;
    assertInputBytes(bytes);
    return snapshot.value;
  });
  const mask = prompt.mask === undefined ? undefined : snapshotImageContent(prompt.mask);
  if (mask) {
    bytes += mask.bytes;
    assertInputBytes(bytes);
  }
  if (prompt.text !== undefined) {
    if (typeof prompt.text !== 'string') throw invalidRequest('Image prompt text must be a string.');
    bytes += utf8ByteLength(prompt.text, AI_MAX_IMAGE_INPUT_BYTES);
    assertInputBytes(bytes);
  }
  return Object.freeze({
    images: Object.freeze(images) as AIDataContent[],
    ...(prompt.text === undefined ? {} : { text: prompt.text }),
    ...(mask === undefined ? {} : { mask: mask.value }),
  });
}

function snapshotImageContent(value: AIDataContent): {
  readonly value: AIDataContent;
  readonly bytes: number;
} {
  if (typeof value === 'string') {
    return { value, bytes: utf8ByteLength(value, AI_MAX_IMAGE_INPUT_BYTES) };
  }
  if (value instanceof Uint8Array) {
    return { value: new Uint8Array(value), bytes: value.byteLength };
  }
  if (value instanceof ArrayBuffer) {
    return { value: value.slice(0), bytes: value.byteLength };
  }
  throw invalidRequest('Image prompt data must be a string, Uint8Array, or ArrayBuffer.');
}

function validateImageModelResponses(model: ImageModel): ImageModel {
  if (typeof model !== 'object' || model === null) return model;
  const method = Reflect.get(model, 'doGenerate');
  if (typeof method !== 'function') return model;
  let aggregateBytes = 0;

  return new Proxy(model, {
    get(target, property, receiver) {
      if (property !== 'doGenerate') return Reflect.get(target, property, receiver);
      return async (options: unknown) => {
        const response: unknown = await Reflect.apply(method, target, [options]);
        if (!isRecord(response) || !Array.isArray(response.images)) {
          throw invalidProviderResponse();
        }
        if (!Array.isArray(response.warnings) || !validResponseMetadata(response.response)) {
          throw invalidProviderResponse();
        }
        const expected = isRecord(options) && typeof options.n === 'number'
          ? options.n
          : AI_MAX_IMAGES_PER_REQUEST;
        if (response.images.length === 0 || response.images.length > expected) {
          throw invalidProviderResponse();
        }
        const images = response.images.map((image) => {
          const bytes = rawImageBytes(image);
          if (bytes > AI_MAX_GENERATED_IMAGE_BYTES) throw resultLimit();
          aggregateBytes += bytes;
          if (aggregateBytes > AI_MAX_GENERATED_IMAGE_AGGREGATE_BYTES) throw resultLimit();
          return image instanceof Uint8Array ? new Uint8Array(image) : image;
        });
        return {
          ...response,
          images,
          warnings: Object.freeze(response.warnings.map(snapshotWarning)),
          response: snapshotResponseMetadata(response.response),
          ...snapshotProviderMetadataProperty(response.providerMetadata),
        };
      };
    },
  }) as ImageModel;
}

function rawImageBytes(value: unknown): number {
  if (value instanceof Uint8Array) return value.byteLength;
  if (typeof value !== 'string' || value.length === 0) throw invalidProviderResponse();
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

function validateImageResult(result: AIImageResult, requested: number): void {
  if (!result || !Array.isArray(result.images) || result.images.length === 0
    || result.images.length > requested || !Array.isArray(result.calls)
    || !Array.isArray(result.warnings) || !Array.isArray(result.responses)) {
    throw invalidProviderResponse();
  }
  let bytes = 0;
  for (const image of result.images) {
    const data = image?.uint8Array;
    if (!(data instanceof Uint8Array) || data.byteLength === 0) throw invalidProviderResponse();
    if (data.byteLength > AI_MAX_GENERATED_IMAGE_BYTES) throw resultLimit();
    bytes += data.byteLength;
    if (bytes > AI_MAX_GENERATED_IMAGE_AGGREGATE_BYTES) throw resultLimit();
  }
  for (const value of [
    result.usage?.inputTokens,
    result.usage?.outputTokens,
    result.usage?.totalTokens,
  ]) {
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
      throw invalidProviderResponse();
    }
  }
}

function validResponseMetadata(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && value.timestamp instanceof Date
    && Number.isFinite(value.timestamp.getTime())
    && typeof value.modelId === 'string'
    && value.modelId.length > 0
    && (value.headers === undefined
      || (isRecord(value.headers)
        && Object.values(value.headers).every((entry) => typeof entry === 'string')));
}

function snapshotResponseMetadata(value: Record<string, unknown>): Record<string, unknown> {
  return Object.freeze({
    ...value,
    timestamp: new Date((value.timestamp as Date).getTime()),
    ...(value.headers === undefined
      ? {}
      : { headers: Object.freeze({ ...(value.headers as Record<string, string>) }) }),
  });
}

function snapshotWarning(value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value) || typeof value.type !== 'string') throw invalidProviderResponse();
  return Object.freeze({ ...value });
}

function snapshotProviderMetadataProperty(value: unknown): { providerMetadata?: unknown } {
  if (value === undefined) return {};
  try {
    const snapshot = snapshotAIJSONValue(value, 'AI image provider metadata');
    if (!isRecord(snapshot)) throw invalidProviderResponse();
    return { providerMetadata: snapshot };
  } catch {
    throw invalidProviderResponse();
  }
}

function boundedInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw invalidRequest(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value as number;
}

function assertInputBytes(bytes: number): void {
  if (bytes > AI_MAX_IMAGE_INPUT_BYTES) {
    throw new AIError(
      'Image prompt inputs exceed the aggregate byte limit.',
      'AI_REQUEST_LIMIT_EXCEEDED',
      413,
    );
  }
}

function normalizeImageError(error: unknown, abortSignal?: AbortSignal): AIError {
  if (error instanceof AIError) return error;
  if (InvalidResponseDataError.isInstance(error) || TypeValidationError.isInstance(error)) {
    return invalidProviderResponse();
  }
  return normalizeAIRequestError(error, abortSignal);
}

function invalidRequest(message: string): AIError {
  return new AIError(message, 'AI_REQUEST_INVALID', 400);
}

function invalidProviderResponse(): AIError {
  return new AIError(
    'AI image provider returned an invalid response.',
    'AI_PROVIDER_RESPONSE_INVALID',
    502,
  );
}

function resultLimit(): AIError {
  return new AIError(
    'Generated images exceed Zero\'s byte limits.',
    'AI_REQUEST_LIMIT_EXCEEDED',
    413,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
