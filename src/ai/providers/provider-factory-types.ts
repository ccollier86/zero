/** Shared contracts and small utilities for built-in AI provider factories. */

import {
  NoSuchModelError,
  type ProviderV3,
  type ProviderV4,
} from '@ai-sdk/provider';

import type {
  AIFetchFunction,
  AIProviderAdapter,
  ResolvedAIProviderConfig,
} from '../ai-provider-types';
import { asAISDKFetch } from '../ai-fetch';

export { asAISDKFetch } from '../ai-fetch';

/** Factory used by Zero's exhaustive provider dispatch table. */
export type AIProviderFactory = (provider: ResolvedAIProviderConfig) => unknown;

/** Keep an explicit endpoint suppression authoritative over SDK environment fallback. */
export function resolvedProviderBaseURL(
  provider: ResolvedAIProviderConfig,
  suppressedDefault?: string
): string | undefined {
  return provider.baseURLSuppressed
    ? suppressedDefault
    : provider.baseURL ?? undefined;
}

/** Common API-key provider options understood by most official adapters. */
export function commonProviderOptions(
  provider: ResolvedAIProviderConfig,
  suppressedDefault?: string
) {
  return {
    apiKey: provider.apiKey ?? undefined,
    baseURL: resolvedProviderBaseURL(provider, suppressedDefault),
    headers: provider.headers,
    fetch: asAISDKFetch(provider.fetch),
  };
}

/** API-key provider options for adapters whose endpoints are fixed. */
export function fixedEndpointProviderOptions(provider: ResolvedAIProviderConfig) {
  return {
    apiKey: provider.apiKey ?? undefined,
    headers: provider.headers,
    fetch: asAISDKFetch(provider.fetch),
  };
}

/**
 * Normalize modality aliases used inconsistently across AI SDK provider generations.
 *
 * The AI SDK registry consumes the `*Model` names, while several official
 * audio adapters publish only `speech()` or `transcription()` in their public
 * type. The proxy keeps the complete vendor surface (including callable
 * providers and V4 video/files/skills/evaluation extensions) while binding
 * canonical aliases to the original instance.
 */
export function normalizeProviderAdapter(provider: unknown): AIProviderAdapter {
  if ((typeof provider !== 'object' || provider === null) && typeof provider !== 'function') {
    throw new TypeError('AI provider factory did not return a provider object.');
  }

  const target = provider as Record<string, unknown>;
  if (target.specificationVersion !== 'v3' && target.specificationVersion !== 'v4') {
    throw new TypeError('AI provider factory did not return a ProviderV3 or ProviderV4 adapter.');
  }

  return target.specificationVersion === 'v4'
    ? normalizeProviderV4(target)
    : normalizeProviderV3(target);
}

function normalizeProviderV4(target: Record<string, unknown>): ProviderV4 {
  const languageModel = boundMethod<ProviderV4['languageModel']>(target, ['languageModel']);
  const embeddingModel = boundMethod<ProviderV4['embeddingModel']>(
    target,
    ['embeddingModel', 'embedding', 'textEmbeddingModel']
  );
  const imageModel = boundMethod<ProviderV4['imageModel']>(target, ['imageModel', 'image']);
  const transcriptionModel = boundMethod<NonNullable<ProviderV4['transcriptionModel']>>(
    target,
    ['transcriptionModel', 'transcription']
  );
  const speechModel = boundMethod<NonNullable<ProviderV4['speechModel']>>(
    target,
    ['speechModel', 'speech']
  );
  const rerankingModel = boundMethod<NonNullable<ProviderV4['rerankingModel']>>(
    target,
    ['rerankingModel', 'reranking']
  );
  const files = boundMethod<NonNullable<ProviderV4['files']>>(target, ['files']);
  const skills = boundMethod<NonNullable<ProviderV4['skills']>>(target, ['skills']);

  return createBoundProviderView<ProviderV4>(target, {
    specificationVersion: 'v4',
    languageModel: languageModel ?? unsupportedModel('languageModel'),
    embeddingModel: embeddingModel ?? unsupportedModel('embeddingModel'),
    imageModel: imageModel ?? unsupportedModel('imageModel'),
    ...(transcriptionModel ? { transcriptionModel } : {}),
    ...(speechModel ? { speechModel } : {}),
    ...(rerankingModel ? { rerankingModel } : {}),
    ...(files ? { files } : {}),
    ...(skills ? { skills } : {}),
  });
}

function normalizeProviderV3(target: Record<string, unknown>): ProviderV3 {

  const languageModel = boundMethod<ProviderV3['languageModel']>(target, ['languageModel']);
  const embeddingModel = boundMethod<ProviderV3['embeddingModel']>(
    target,
    ['embeddingModel', 'embedding', 'textEmbeddingModel']
  );
  const imageModel = boundMethod<ProviderV3['imageModel']>(target, ['imageModel', 'image']);
  const transcriptionModel = boundMethod<NonNullable<ProviderV3['transcriptionModel']>>(
    target,
    ['transcriptionModel', 'transcription']
  );
  const speechModel = boundMethod<NonNullable<ProviderV3['speechModel']>>(
    target,
    ['speechModel', 'speech']
  );
  const rerankingModel = boundMethod<NonNullable<ProviderV3['rerankingModel']>>(
    target,
    ['rerankingModel', 'reranking']
  );

  return createBoundProviderView<ProviderV3>(target, {
    specificationVersion: 'v3',
    languageModel: languageModel ?? unsupportedModel('languageModel'),
    embeddingModel: embeddingModel ?? unsupportedModel('embeddingModel'),
    imageModel: imageModel ?? unsupportedModel('imageModel'),
    ...(transcriptionModel ? { transcriptionModel } : {}),
    ...(speechModel ? { speechModel } : {}),
    ...(rerankingModel ? { rerankingModel } : {}),
  });
}

function createBoundProviderView<TProvider extends ProviderV3 | ProviderV4>(
  target: Record<string, unknown>,
  overrides: Record<string, unknown>
): TProvider {
  const boundMethods = new Map<PropertyKey, Function>();
  return new Proxy(target, {
    get(source, property) {
      if (Object.prototype.hasOwnProperty.call(overrides, property)) {
        return overrides[property as keyof typeof overrides];
      }

      const value = Reflect.get(source, property, source);
      if (typeof value !== 'function') return value;

      const existing = boundMethods.get(property);
      if (existing) return existing;
      const bound = value.bind(source);
      boundMethods.set(property, bound);
      return bound;
    },
    has(source, property) {
      return Object.prototype.hasOwnProperty.call(overrides, property)
        || Reflect.has(source, property);
    },
    ownKeys(source) {
      return [...new Set([...Reflect.ownKeys(source), ...Reflect.ownKeys(overrides)])];
    },
    getOwnPropertyDescriptor(source, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(source, property);
      if (descriptor) return descriptor;
      if (!Object.prototype.hasOwnProperty.call(overrides, property)) return undefined;
      return {
        configurable: true,
        enumerable: true,
        value: overrides[property as keyof typeof overrides],
        writable: false,
      };
    },
  }) as TProvider;
}

/** Rewrite one provider's fixed upstream origin while retaining path/query. */
export function createBaseURLRewriteFetch(
  baseURL: string,
  upstreamBaseURL: string,
  delegate: AIFetchFunction = fetch
): AIFetchFunction {
  const upstream = new URL(upstreamBaseURL);
  const targetBase = new URL(baseURL);
  const targetPathPrefix = targetBase.pathname.replace(/\/$/, '');

  const rewriteFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const sourceURL = new URL(input instanceof Request ? input.url : input.toString());
    if (sourceURL.origin !== upstream.origin) return delegate(input as RequestInfo | URL, init);

    const target = new URL(targetBase);
    target.pathname = `${targetPathPrefix}${sourceURL.pathname}`.replace(/\/{2,}/g, '/');
    target.search = sourceURL.search;
    target.hash = sourceURL.hash;

    return delegate(input instanceof Request ? new Request(target, input) : target, init);
  }) as AIFetchFunction;

  const delegateWithPreconnect = delegate as AIFetchFunction & {
    preconnect?: (...args: unknown[]) => unknown;
  };
  if (delegateWithPreconnect.preconnect) {
    (rewriteFetch as AIFetchFunction & { preconnect?: (...args: unknown[]) => unknown }).preconnect =
      (...args: unknown[]) => delegateWithPreconnect.preconnect?.(...args);
  }
  return rewriteFetch;
}

type ProviderMethod = (...args: never[]) => unknown;

function boundMethod<TMethod extends ProviderMethod>(
  target: Record<string, unknown>,
  sources: readonly string[]
): TMethod | undefined {
  const source = sources.find((candidate) => typeof target[candidate] === 'function');
  if (!source) return undefined;
  return (target[source] as ProviderMethod).bind(target) as TMethod;
}

function unsupportedModel<TMethod extends ProviderMethod>(
  modelType: NoSuchModelError['modelType'],
  providerId = 'provider'
): TMethod {
  return ((modelId: string) => {
    throw new NoSuchModelError({
      modelId,
      modelType,
      message: `${providerId} does not provide ${modelType} models.`,
    });
  }) as unknown as TMethod;
}
