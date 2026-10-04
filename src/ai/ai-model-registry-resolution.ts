/** Capability-checked model resolution for an active Zero AI registry. */

import type { Experimental_VideoModelV4 } from '@ai-sdk/provider';
import type {
  EmbeddingModel,
  ImageModel,
  LanguageModel,
  RerankingModel,
  SpeechModel,
  TranscriptionModel,
} from 'ai';

import { AIError } from './ai-errors';
import { resolveAIModelReference, type AIModelReference } from './ai-model-aliases';
import { emitAIModelAliasUnresolved } from './ai-observability';
import { hasAICapability } from './ai-provider-catalog';
import type { AIRegistry, ResolvedAIModel } from './ai-registry';
import type { AICapability } from './ai-types';

/** Resolve a language model from an alias or provider-qualified model id. */
export function resolveLanguageModel(
  registry: AIRegistry,
  aliases: Record<string, string>,
  requested: string | undefined,
  defaultAlias = 'smart',
  capability: Extract<AICapability, 'text' | 'streaming'> = 'text',
): ResolvedAIModel<LanguageModel> {
  return resolveModel(registry, aliases, requested, defaultAlias, capability, (id) =>
    registry.registry.languageModel(id as `${string}/${string}`)
  );
}

/** Resolve an embedding model from an alias or provider-qualified model id. */
export function resolveEmbeddingModel(
  registry: AIRegistry,
  aliases: Record<string, string>,
  requested: string | undefined,
  defaultAlias = 'embedding',
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
  defaultAlias = 'image',
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
  defaultAlias = 'transcription',
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
  defaultAlias = 'speech',
): ResolvedAIModel<SpeechModel> {
  return resolveModel(registry, aliases, requested, defaultAlias, 'speech', (id) =>
    registry.registry.speechModel(id as `${string}/${string}`)
  );
}

/** Resolve a reranking model from an alias or provider-qualified model id. */
export function resolveRerankingModel(
  registry: AIRegistry,
  aliases: Record<string, string>,
  requested: string | undefined,
  defaultAlias = 'reranking',
): ResolvedAIModel<RerankingModel> {
  return resolveModel(registry, aliases, requested, defaultAlias, 'reranking', (id) =>
    registry.registry.rerankingModel(id as `${string}/${string}`)
  );
}

/** Resolve a preview video model from an alias or provider-qualified model id. */
export function resolveVideoModel(
  registry: AIRegistry,
  aliases: Record<string, string>,
  requested: string | undefined,
  defaultAlias = 'video',
): ResolvedAIModel<Experimental_VideoModelV4> {
  return resolveModel(registry, aliases, requested, defaultAlias, 'video', (id) =>
    registry.registry.videoModel(id as `${string}/${string}`)
  );
}

function resolveModel<TModel>(
  registry: AIRegistry,
  aliases: Record<string, string>,
  requested: string | undefined,
  defaultAlias: string,
  capability: AICapability,
  resolve: (id: string) => TModel,
): ResolvedAIModel<TModel> {
  let reference: AIModelReference;
  try {
    reference = resolveAIModelReference(requested, aliases, defaultAlias);
  } catch (error) {
    emitAIModelAliasUnresolved({
      requestedModel: requested?.trim() || defaultAlias,
      capability,
      reason: error instanceof AIError ? error.code : 'AI_MODEL_NOT_CONFIGURED',
    }, registry.emitCode);
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
    }, registry.emitCode);
    throw new AIError(
      `AI provider "${reference.providerId}" is not configured.`,
      'AI_PROVIDER_NOT_CONFIGURED',
      400,
    );
  }
  if (!provider.active || !registry.providerInstances[provider.id]) {
    emitAIModelAliasUnresolved({
      providerId: provider.id,
      providerType: provider.type,
      requestedModel: reference.requested,
      model: reference.resolved,
      capability,
      reason: provider.reason ?? 'AI_PROVIDER_NOT_ACTIVE',
    }, registry.emitCode);
    throw new AIError(
      `AI provider "${reference.providerId}" is not active: ${provider.reason ?? 'not configured'}.`,
      'AI_PROVIDER_NOT_ACTIVE',
      503,
    );
  }
  if (!hasAICapability(provider.capabilities, capability)) {
    throw new AIError(
      `AI provider "${reference.providerId}" does not support ${capability}.`,
      'AI_CAPABILITY_NOT_SUPPORTED',
      400,
    );
  }

  try {
    return {
      reference,
      provider,
      model: resolve(reference.resolved),
      ...(registry.emitCode === undefined ? {} : { emitCode: registry.emitCode }),
    };
  } catch (error) {
    emitAIModelAliasUnresolved({
      providerId: provider.id,
      providerType: provider.type,
      requestedModel: reference.requested,
      model: reference.resolved,
      capability,
      reason: 'AI_MODEL_INVALID',
    }, registry.emitCode);
    throw new AIError(
      error instanceof Error
        ? error.message
        : `AI model "${reference.resolved}" could not be resolved.`,
      'AI_MODEL_INVALID',
      400,
    );
  }
}
