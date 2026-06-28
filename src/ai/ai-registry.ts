/**
 * ai-registry.ts
 *
 * Builds the active AI SDK provider registry from resolved Zero AI config.
 * This file owns provider instantiation and model lookup only; it does not
 * expose HTTP routes, execute tools, or decide app authorization.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createCohere } from '@ai-sdk/cohere';
import { createDeepgram } from '@ai-sdk/deepgram';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createXai } from '@ai-sdk/xai';
import {
  createProviderRegistry,
  type EmbeddingModel,
  type ImageModel,
  type LanguageModel,
  type ProviderRegistryProvider,
  type SpeechModel,
  type TranscriptionModel,
} from 'ai';

import { AIError } from './ai-errors';
import type {
  AICapability,
  AIProviderStatus,
  ResolvedAIConfig,
  ResolvedAIProviderConfig,
} from './ai-types';
import { hasAICapability } from './ai-provider-catalog';
import { parseAIModelReference, resolveAIModelReference, type AIModelReference } from './ai-model-aliases';
import { createMetaLlama } from './adapters/meta-llama';
import { emitAIModelAliasUnresolved } from './ai-observability';

type ProviderMap = Record<string, unknown>;

/** Active provider registry and SDK provider instances owned by AIService. */
export interface AIRegistry {
  providers: Record<string, ResolvedAIProviderConfig>;
  providerInstances: ProviderMap;
  registry: ProviderRegistryProvider<any, '/'>;
}

/** Model resolution result with provider metadata used for observability. */
export interface ResolvedAIModel<TModel> {
  reference: AIModelReference;
  provider: ResolvedAIProviderConfig;
  model: TModel;
}

/** Create an AI SDK provider registry from active resolved providers. */
export function createAIRegistry(config: ResolvedAIConfig): AIRegistry {
  const providerInstances: ProviderMap = {};

  for (const provider of Object.values(config.providers)) {
    if (!provider.active) continue;
    const instance = createProviderInstance(provider);
    if (instance) {
      providerInstances[provider.id] = instance;
    }
  }

  return {
    providers: config.providers,
    providerInstances,
    registry: createProviderRegistry(providerInstances as any, { separator: '/' }),
  };
}

/** Return public-safe provider statuses for runtime inspection. */
export function getAIProviderStatuses(config: ResolvedAIConfig, registry: AIRegistry): AIProviderStatus[] {
  return Object.values(config.providers).map((provider) => ({
    id: provider.id,
    type: provider.type,
    active: Boolean(provider.active && registry.providerInstances[provider.id]),
    source: provider.source,
    configuredBy: provider.configuredBy,
    baseURL: provider.baseURL ?? null,
    capabilities: provider.capabilities,
    reason: provider.reason,
  }));
}

/** Resolve a language model from an alias or provider-qualified model id. */
export function resolveLanguageModel(
  registry: AIRegistry,
  aliases: Record<string, string>,
  requested: string | undefined,
  defaultAlias = 'smart'
): ResolvedAIModel<LanguageModel> {
  return resolveModel(registry, aliases, requested, defaultAlias, 'text', (id) =>
    registry.registry.languageModel(id as `${string}/${string}`)
  );
}

/** Resolve an embedding model from an alias or provider-qualified model id. */
export function resolveEmbeddingModel(
  registry: AIRegistry,
  aliases: Record<string, string>,
  requested: string | undefined,
  defaultAlias = 'embedding'
): ResolvedAIModel<EmbeddingModel> {
  return resolveModel(registry, aliases, requested, defaultAlias, 'embeddings', (id) =>
    registry.registry.embeddingModel(id as `${string}/${string}`)
  );
}

/** Resolve an image model from an alias or provider-qualified model id. */
export function resolveImageModel(
  registry: AIRegistry,
  aliases: Record<string, string>,
  requested: string | undefined,
  defaultAlias = 'image'
): ResolvedAIModel<ImageModel> {
  return resolveModel(registry, aliases, requested, defaultAlias, 'images', (id) =>
    registry.registry.imageModel(id as `${string}/${string}`)
  );
}

/** Resolve a transcription model from an alias or provider-qualified model id. */
export function resolveTranscriptionModel(
  registry: AIRegistry,
  aliases: Record<string, string>,
  requested: string | undefined,
  defaultAlias = 'transcription'
): ResolvedAIModel<TranscriptionModel> {
  return resolveModel(registry, aliases, requested, defaultAlias, 'transcription', (id) =>
    registry.registry.transcriptionModel(id as `${string}/${string}`)
  );
}

/** Resolve a speech model from an alias or provider-qualified model id. */
export function resolveSpeechModel(
  registry: AIRegistry,
  aliases: Record<string, string>,
  requested: string | undefined,
  defaultAlias = 'speech'
): ResolvedAIModel<SpeechModel> {
  return resolveModel(registry, aliases, requested, defaultAlias, 'speech', (id) =>
    registry.registry.speechModel(id as `${string}/${string}`)
  );
}

/** Return whether a model or alias is usable for a capability. */
export function isAIModelActive(
  registry: AIRegistry,
  aliases: Record<string, string>,
  requested: string,
  capability: AICapability = 'text'
): { active: boolean; reason: string | null; resolved?: string } {
  try {
    const reference = resolveAIModelReference(requested, aliases, requested);
    const provider = registry.providers[reference.providerId];
    if (!provider) return { active: false, reason: 'provider_not_configured', resolved: reference.resolved };
    if (!provider.active || !registry.providerInstances[provider.id]) {
      return { active: false, reason: provider.reason ?? 'provider_not_active', resolved: reference.resolved };
    }
    if (!hasAICapability(provider.capabilities, capability)) {
      return { active: false, reason: `capability_${capability}_not_supported`, resolved: reference.resolved };
    }
    return { active: true, reason: null, resolved: reference.resolved };
  } catch (error) {
    return {
      active: false,
      reason: error instanceof Error ? error.message : 'invalid_model',
    };
  }
}

function resolveModel<TModel>(
  registry: AIRegistry,
  aliases: Record<string, string>,
  requested: string | undefined,
  defaultAlias: string,
  capability: AICapability,
  resolve: (id: string) => TModel
): ResolvedAIModel<TModel> {
  let reference: AIModelReference;
  try {
    reference = resolveAIModelReference(requested, aliases, defaultAlias);
  } catch (error) {
    emitAIModelAliasUnresolved({
      requestedModel: requested?.trim() || defaultAlias,
      capability,
      reason: error instanceof AIError ? error.code : 'AI_MODEL_NOT_CONFIGURED',
    });
    throw error;
  }

  const provider = registry.providers[reference.providerId];

  if (!provider) {
    emitAIModelAliasUnresolved({
      providerId: reference.providerId,
      requestedModel: reference.requested,
      model: reference.resolved,
      capability,
      reason: 'AI_PROVIDER_NOT_CONFIGURED',
    });
    throw new AIError(`AI provider "${reference.providerId}" is not configured.`, 'AI_PROVIDER_NOT_CONFIGURED', 400);
  }
  if (!provider.active || !registry.providerInstances[provider.id]) {
    emitAIModelAliasUnresolved({
      providerId: provider.id,
      providerType: provider.type,
      requestedModel: reference.requested,
      model: reference.resolved,
      capability,
      reason: provider.reason ?? 'AI_PROVIDER_NOT_ACTIVE',
    });
    throw new AIError(
      `AI provider "${reference.providerId}" is not active: ${provider.reason ?? 'not configured'}.`,
      'AI_PROVIDER_NOT_ACTIVE',
      503
    );
  }
  if (!hasAICapability(provider.capabilities, capability)) {
    throw new AIError(
      `AI provider "${reference.providerId}" does not support ${capability}.`,
      'AI_CAPABILITY_NOT_SUPPORTED',
      400
    );
  }

  try {
    return {
      reference,
      provider,
      model: resolve(reference.resolved),
    };
  } catch (error) {
    emitAIModelAliasUnresolved({
      providerId: provider.id,
      providerType: provider.type,
      requestedModel: reference.requested,
      model: reference.resolved,
      capability,
      reason: 'AI_MODEL_INVALID',
    });
    throw new AIError(
      error instanceof Error ? error.message : `AI model "${reference.resolved}" could not be resolved.`,
      'AI_MODEL_INVALID',
      400
    );
  }
}

function createProviderInstance(provider: ResolvedAIProviderConfig): unknown | null {
  const common = {
    apiKey: provider.apiKey ?? undefined,
    baseURL: provider.baseURL ?? undefined,
  };

  switch (provider.type) {
    case 'openai':
      return createOpenAI(common);
    case 'anthropic':
      return createAnthropic(common);
    case 'google':
      return createGoogleGenerativeAI(common);
    case 'groq':
      return createGroq(common);
    case 'xai':
      return createXai(common);
    case 'cohere':
      return createCohere(common);
    case 'deepgram':
      return createDeepgram({
        apiKey: provider.apiKey ?? undefined,
        headers: provider.headers,
        fetch: provider.baseURL
          ? createBaseURLRewriteFetch(provider.baseURL, 'https://api.deepgram.com')
          : undefined,
      });
    case 'openai-compatible':
      if (!provider.baseURL) return null;
      return createOpenAICompatible({
        name: provider.id,
        apiKey: provider.apiKey ?? undefined,
        baseURL: provider.baseURL,
      });
    case 'meta-llama':
      return createMetaLlama({
        apiKey: provider.apiKey ?? undefined,
        baseURL: provider.baseURL ?? undefined,
        headers: provider.headers,
      });
    case 'custom':
      return createCustomProviderInstance(provider);
    default:
      return null;
  }
}

function createCustomProviderInstance(provider: ResolvedAIProviderConfig): unknown | null {
  if (!provider.adapter) return null;
  if (typeof provider.adapter !== 'function') return provider.adapter;

  return provider.adapter({
    id: provider.id,
    apiKey: provider.apiKey ?? undefined,
    baseURL: provider.baseURL ?? undefined,
    headers: provider.headers,
    capabilities: provider.capabilities,
  });
}

function createBaseURLRewriteFetch(baseURL: string, upstreamBaseURL: string): typeof fetch {
  const upstream = new URL(upstreamBaseURL);
  const targetBase = new URL(baseURL);
  const targetPathPrefix = targetBase.pathname.replace(/\/$/, '');

  const rewriteFetch = ((input, init) => {
    const sourceURL = new URL(input instanceof Request ? input.url : input.toString());
    if (sourceURL.origin !== upstream.origin) {
      return fetch(input as any, init);
    }

    const target = new URL(targetBase);
    target.pathname = `${targetPathPrefix}${sourceURL.pathname}`.replace(/\/{2,}/g, '/');
    target.search = sourceURL.search;
    target.hash = sourceURL.hash;

    return fetch(input instanceof Request ? new Request(target, input as any) : target, init);
  }) as typeof fetch;

  (rewriteFetch as any).preconnect = (...args: unknown[]) => (fetch as any).preconnect?.(...args);

  return rewriteFetch;
}

export { parseAIModelReference };
