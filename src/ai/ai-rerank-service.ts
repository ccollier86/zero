/** Bounded SDK orchestration for Zero's document reranking operation. */

import {
  InvalidResponseDataError,
  TypeValidationError,
  rerank,
  type RerankingModel,
} from 'ai';
import type { JSONObject, SharedV4ProviderMetadata } from '@ai-sdk/provider';
import type { Context } from '@ai-sdk/provider-utils';

import { AIError } from './ai-errors';
import { snapshotAIJSONValue } from './ai-json-value-snapshot';
import { validateAIRerankInput } from './ai-operation-limits';
import { normalizeAIProviderOptions } from './ai-provider-options';
import { snapshotAIHeaders } from './ai-request-snapshot';
import type { AIRequestTelemetry } from './ai-request-telemetry';
import type {
  AIRerankDocument,
  AIRerankRequest,
  AIRerankResult,
} from './ai-rerank-types';
import { normalizeAIRequestError } from './ai-service-support';

/** Explicit dependencies supplied after AIService resolves a model and telemetry. */
export interface AIRerankOperationContext {
  model: RerankingModel;
  requestTelemetry: AIRequestTelemetry;
}

/** Execute a bounded reranking call and validate provider result integrity. */
export async function executeAIRerank<
  VALUE extends AIRerankDocument,
  RUNTIME_CONTEXT extends Context = Context,
>(
  request: AIRerankRequest<VALUE, RUNTIME_CONTEXT>,
  context: AIRerankOperationContext
): Promise<AIRerankResult<VALUE>> {
  try {
    const validated = validateAIRerankInput<VALUE>({
      query: request.query,
      documents: request.documents,
      topN: request.topN,
      maxRetries: request.maxRetries,
    });
    freezeDocuments(validated.documents);

    const result = await rerank({
      model: validateRerankingModelResponses(context.model),
      documents: validated.documents,
      query: validated.query,
      topN: validated.topN,
      maxRetries: validated.maxRetries,
      abortSignal: request.abortSignal,
      headers: snapshotAIHeaders(request.headers),
      providerOptions: normalizeAIProviderOptions(request.providerOptions),
      runtimeContext: request.runtimeContext,
      telemetry: request.telemetry,
      onStart: request.onStart,
      onEnd: request.onEnd,
    });
    const detached = validateAndDetachRerankResult(
      result,
      validated.documents,
      validated.topN
    );
    context.requestTelemetry.complete();
    return detached;
  } catch (error) {
    const normalized = normalizeAIOperationError(error, request.abortSignal);
    context.requestTelemetry.fail(normalized);
    throw normalized;
  }
}

function validateRerankingModelResponses(model: RerankingModel): RerankingModel {
  if (typeof model !== 'object' || model === null) return model;
  const method = Reflect.get(model, 'doRerank');
  if (typeof method !== 'function') return model;

  return new Proxy(model, {
    get(target, property, receiver) {
      if (property !== 'doRerank') return Reflect.get(target, property, receiver);
      return async (options: unknown) => {
        const response: unknown = await Reflect.apply(method, target, [options]);
        assertRawRerankingResponse(response, options);
        return response;
      };
    },
  }) as RerankingModel;
}

function assertRawRerankingResponse(response: unknown, options: unknown): void {
  if (!isRecord(response) || !Array.isArray(response.ranking)
    || !isRecord(options) || !isRecord(options.documents)
    || !Array.isArray(options.documents.values)) {
    throw invalidProviderResponse();
  }
  const documentCount = options.documents.values.length;
  const maximumResults = typeof options.topN === 'number' ? options.topN : documentCount;
  if (response.ranking.length > maximumResults) throw invalidProviderResponse();

  const seen = new Set<number>();
  for (const entry of response.ranking) {
    if (!isRecord(entry)
      || !Number.isSafeInteger(entry.index)
      || (entry.index as number) < 0
      || (entry.index as number) >= documentCount
      || seen.has(entry.index as number)
      || typeof entry.relevanceScore !== 'number'
      || !Number.isFinite(entry.relevanceScore)) {
      throw invalidProviderResponse();
    }
    seen.add(entry.index as number);
  }
  if (response.warnings !== undefined && !Array.isArray(response.warnings)) {
    throw invalidProviderResponse();
  }
  if (response.response !== undefined && !isRecord(response.response)) {
    throw invalidProviderResponse();
  }
}

function validateAndDetachRerankResult<VALUE extends AIRerankDocument>(
  result: AIRerankResult<VALUE>,
  expectedDocuments: readonly VALUE[],
  topN: number | undefined
): AIRerankResult<VALUE> {
  if (!result || !Array.isArray(result.originalDocuments)
    || !Array.isArray(result.ranking)
    || !Array.isArray(result.rerankedDocuments)
    || result.originalDocuments.length !== expectedDocuments.length
    || result.ranking.length !== result.rerankedDocuments.length
    || result.ranking.length > (topN ?? expectedDocuments.length)) {
    throw invalidProviderResponse();
  }
  for (let index = 0; index < expectedDocuments.length; index += 1) {
    if (!Object.is(result.originalDocuments[index], expectedDocuments[index])) {
      throw invalidProviderResponse();
    }
  }

  const seen = new Set<number>();
  const ranking = new Array<{
    originalIndex: number;
    score: number;
    document: VALUE;
  }>(result.ranking.length);
  const rerankedDocuments = new Array<VALUE>(result.ranking.length);

  for (let index = 0; index < result.ranking.length; index += 1) {
    const entry = result.ranking[index];
    if (!entry
      || !Number.isSafeInteger(entry.originalIndex)
      || entry.originalIndex < 0
      || entry.originalIndex >= expectedDocuments.length
      || seen.has(entry.originalIndex)
      || !Number.isFinite(entry.score)) {
      throw invalidProviderResponse();
    }
    const expected = expectedDocuments[entry.originalIndex];
    if (!Object.is(entry.document, expected)
      || !Object.is(result.rerankedDocuments[index], expected)) {
      throw invalidProviderResponse();
    }
    seen.add(entry.originalIndex);
    ranking[index] = {
      originalIndex: entry.originalIndex,
      score: entry.score,
      document: expected,
    };
    rerankedDocuments[index] = expected;
  }

  if (!result.response
    || !(result.response.timestamp instanceof Date)
    || !Number.isFinite(result.response.timestamp.getTime())
    || typeof result.response.modelId !== 'string'
    || result.response.modelId.length === 0) {
    throw invalidProviderResponse();
  }

  return {
    originalDocuments: [...result.originalDocuments],
    rerankedDocuments,
    ranking,
    ...(result.providerMetadata === undefined
      ? {}
      : { providerMetadata: snapshotProviderMetadata(result.providerMetadata) }),
    response: {
      ...result.response,
      timestamp: new Date(result.response.timestamp.getTime()),
      ...(result.response.headers === undefined
        ? {}
        : { headers: { ...result.response.headers } }),
    },
  };
}

function snapshotProviderMetadata(value: unknown): SharedV4ProviderMetadata {
  try {
    const snapshot = snapshotAIJSONValue(value, 'AI reranking provider metadata');
    if (!isRecord(snapshot)) throw new Error('metadata');
    return snapshot as SharedV4ProviderMetadata;
  } catch {
    throw invalidProviderResponse();
  }
}

function freezeDocuments(documents: readonly AIRerankDocument[]): void {
  const stack: object[] = [];
  for (const document of documents) {
    if (typeof document === 'object' && document !== null) stack.push(document);
  }
  while (stack.length > 0) {
    const value = stack.pop()!;
    const children: readonly unknown[] = Array.isArray(value)
      ? value
      : Object.values(value as JSONObject);
    for (const child of children) {
      if (typeof child === 'object' && child !== null) stack.push(child);
    }
    Object.freeze(value);
  }
  Object.freeze(documents);
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
    'AI reranking provider returned an invalid response.',
    'AI_PROVIDER_RESPONSE_INVALID',
    502
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
