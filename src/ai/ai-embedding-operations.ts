/** Bounded SDK orchestration for Zero's multi-value embedding operation. */

import {
  InvalidResponseDataError,
  TypeValidationError,
  embed,
  embedMany,
  type EmbeddingModel,
} from 'ai';
import type { SharedV4ProviderMetadata } from '@ai-sdk/provider';
import type { Context } from '@ai-sdk/provider-utils';

import { AIError } from './ai-errors';
import { snapshotAIJSONValue } from './ai-json-value-snapshot';
import type { AIEmbedManyRequest, AIEmbedManyResult } from './ai-embedding-types';
import type { AIEmbedRequest, AIEmbedResult } from './ai-types';
import { validateAIEmbedManyInput } from './ai-operation-limits';
import type { AIRequestTelemetry } from './ai-request-telemetry';
import { normalizeAIRequestError } from './ai-service-support';
import { normalizeAIProviderOptions } from './ai-provider-options';
import { snapshotAIHeaders } from './ai-request-snapshot';

/** Explicit dependencies supplied after AIService resolves a model and telemetry. */
export interface AIEmbeddingOperationContext {
  model: EmbeddingModel;
  requestTelemetry: AIRequestTelemetry;
}

/** Execute one bounded embedding call through the same integrity boundary. */
export async function executeAIEmbed<RUNTIME_CONTEXT extends Context = Context>(
  request: AIEmbedRequest<RUNTIME_CONTEXT>,
  context: AIEmbeddingOperationContext,
): Promise<AIEmbedResult> {
  try {
    const validated = validateAIEmbedManyInput({
      values: [request.value],
      maxParallelCalls: 1,
      maxRetries: request.maxRetries,
    });
    const value = validated.values[0]!;
    const result = await embed({
      model: validateEmbeddingModelResponses(context.model),
      value,
      maxRetries: validated.maxRetries,
      abortSignal: request.abortSignal,
      headers: snapshotAIHeaders(request.headers),
      providerOptions: normalizeAIProviderOptions(request.providerOptions),
      runtimeContext: request.runtimeContext,
      telemetry: request.telemetry,
      onStart: request.onStart,
      onEnd: request.onEnd,
    });
    if (result.value !== value || !Array.isArray(result.embedding)
      || result.embedding.length === 0
      || !result.embedding.every((coordinate) => typeof coordinate === 'number'
        && Number.isFinite(coordinate))
      || (result.usage !== undefined
        && (typeof result.usage.tokens !== 'number'
          || (Number.isFinite(result.usage.tokens) && result.usage.tokens < 0)
          || (!Number.isFinite(result.usage.tokens) && !Number.isNaN(result.usage.tokens))))) {
      throw invalidProviderResponse();
    }
    const detached: AIEmbedResult = {
      embedding: [...result.embedding],
      value,
      ...(result.usage === undefined ? {} : { usage: { ...result.usage } }),
    };
    context.requestTelemetry.complete({
      totalTokens: Number.isFinite(result.usage?.tokens)
        ? result.usage?.tokens
        : undefined,
    });
    return detached;
  } catch (error) {
    const normalized = normalizeAIOperationError(error, request.abortSignal);
    context.requestTelemetry.fail(normalized);
    throw normalized;
  }
}

/** Execute a bounded multi-value embedding call and validate provider integrity. */
export async function executeAIEmbedMany<RUNTIME_CONTEXT extends Context = Context>(
  request: AIEmbedManyRequest<RUNTIME_CONTEXT>,
  context: AIEmbeddingOperationContext
): Promise<AIEmbedManyResult> {
  try {
    const validated = validateAIEmbedManyInput({
      values: request.values,
      maxParallelCalls: request.maxParallelCalls,
      maxRetries: request.maxRetries,
    });
    Object.freeze(validated.values);

    const result = await embedMany({
      model: validateEmbeddingModelResponses(context.model),
      values: validated.values,
      maxParallelCalls: validated.maxParallelCalls,
      maxRetries: validated.maxRetries,
      abortSignal: request.abortSignal,
      headers: snapshotAIHeaders(request.headers),
      providerOptions: normalizeAIProviderOptions(request.providerOptions),
      runtimeContext: request.runtimeContext,
      telemetry: request.telemetry,
      onStart: request.onStart,
      onEnd: request.onEnd,
    });
    const detached = validateAndDetachEmbedManyResult(result, validated.values);
    context.requestTelemetry.complete({
      totalTokens: Number.isFinite(detached.usage.tokens)
        ? detached.usage.tokens
        : undefined,
    });
    return detached;
  } catch (error) {
    const normalized = normalizeAIOperationError(error, request.abortSignal);
    context.requestTelemetry.fail(normalized);
    throw normalized;
  }
}

function validateAndDetachEmbedManyResult(
  result: AIEmbedManyResult,
  expectedValues: readonly string[]
): AIEmbedManyResult {
  if (!result || !Array.isArray(result.values) || !Array.isArray(result.embeddings)
    || result.values.length !== expectedValues.length
    || result.embeddings.length !== expectedValues.length) {
    throw invalidProviderResponse();
  }
  if (!Array.isArray(result.warnings)
    || !result.usage
    || typeof result.usage.tokens !== 'number'
    || (Number.isFinite(result.usage.tokens) && result.usage.tokens < 0)
    || (!Number.isFinite(result.usage.tokens) && !Number.isNaN(result.usage.tokens))) {
    throw invalidProviderResponse();
  }

  let dimensions: number | undefined;
  const embeddings = new Array<number[]>(result.embeddings.length);
  for (let index = 0; index < expectedValues.length; index += 1) {
    if (result.values[index] !== expectedValues[index]) throw invalidProviderResponse();
    const embedding: unknown = result.embeddings[index];
    if (!Array.isArray(embedding) || embedding.length === 0) throw invalidProviderResponse();
    if (dimensions === undefined) dimensions = embedding.length;
    else if (embedding.length !== dimensions) throw invalidProviderResponse();
    if (!embedding.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))) {
      throw invalidProviderResponse();
    }
    embeddings[index] = [...embedding];
  }

  if (result.responses !== undefined && !Array.isArray(result.responses)) {
    throw invalidProviderResponse();
  }
  return {
    values: [...result.values],
    embeddings,
    usage: { tokens: result.usage.tokens },
    warnings: result.warnings.map((warning) => {
      if (!isRecord(warning) || typeof warning.type !== 'string') {
        throw invalidProviderResponse();
      }
      return Object.freeze({ ...warning });
    }),
    ...(result.providerMetadata === undefined
      ? {}
      : { providerMetadata: snapshotProviderMetadata(result.providerMetadata) }),
    ...(result.responses === undefined
      ? {}
      : {
          responses: result.responses.map((response) => response === undefined
            ? undefined
            : {
                ...response,
                ...(response.headers === undefined
                  ? {}
                  : { headers: { ...response.headers } }),
              }),
        }),
  };
}

function snapshotProviderMetadata(value: unknown): SharedV4ProviderMetadata {
  try {
    const snapshot = snapshotAIJSONValue(value, 'AI embedding provider metadata');
    if (!isRecord(snapshot)) throw new Error('metadata');
    return snapshot as SharedV4ProviderMetadata;
  } catch {
    throw invalidProviderResponse();
  }
}

function validateEmbeddingModelResponses(model: EmbeddingModel): EmbeddingModel {
  if (typeof model !== 'object' || model === null) return model;
  const method = Reflect.get(model, 'doEmbed');
  if (typeof method !== 'function') return model;

  return new Proxy(model, {
    get(target, property, receiver) {
      if (property !== 'doEmbed') return Reflect.get(target, property, receiver);
      return async (options: unknown) => {
        const response: unknown = await Reflect.apply(method, target, [options]);
        assertRawEmbeddingResponse(response, options);
        return response;
      };
    },
  }) as EmbeddingModel;
}

function assertRawEmbeddingResponse(response: unknown, options: unknown): void {
  if (!isRecord(response) || !Array.isArray(response.embeddings)
    || !isRecord(options) || !Array.isArray(options.values)
    || response.embeddings.length !== options.values.length) {
    throw invalidProviderResponse();
  }

  let dimensions: number | undefined;
  for (const embedding of response.embeddings) {
    if (!Array.isArray(embedding) || embedding.length === 0
      || !embedding.every((coordinate) => typeof coordinate === 'number'
        && Number.isFinite(coordinate))) {
      throw invalidProviderResponse();
    }
    if (dimensions === undefined) dimensions = embedding.length;
    else if (embedding.length !== dimensions) throw invalidProviderResponse();
  }
  if (response.usage !== undefined
    && (!isRecord(response.usage)
      || typeof response.usage.tokens !== 'number'
      || !Number.isFinite(response.usage.tokens)
      || response.usage.tokens < 0)) {
    throw invalidProviderResponse();
  }
  if (response.warnings !== undefined && !Array.isArray(response.warnings)) {
    throw invalidProviderResponse();
  }
  if (response.response !== undefined && !isRecord(response.response)) {
    throw invalidProviderResponse();
  }
}

function normalizeAIOperationError(error: unknown, abortSignal?: AbortSignal): AIError {
  if (error instanceof AIError) return error;
  if (InvalidResponseDataError.isInstance(error) || TypeValidationError.isInstance(error)) {
    return invalidProviderResponse();
  }
  return normalizeAIRequestError(error, abortSignal);
}

function invalidProviderResponse(): AIError {
  return new AIError(
    'AI embedding provider returned an invalid response.',
    'AI_PROVIDER_RESPONSE_INVALID',
    502
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
