/**
 * ai-registry.ts
 *
 * Builds the active AI SDK provider registry and exposes its public contracts.
 * Model and hosted-files resolution live in focused capability modules.
 */

import type { FilesV4 } from '@ai-sdk/provider';
import { createProviderRegistry, type ProviderRegistryProvider } from 'ai';

import { resolveAIModelReference, type AIModelReference } from './ai-model-aliases';
import type { AIEmitCode } from './ai-observability';
import { hasAICapability } from './ai-provider-catalog';
import { createAIProviderInstance } from './ai-provider-factory';
import type {
  AICapability,
  AIProviderAdapter,
  AIProviderFileOperations,
  AIProviderStatus,
  ResolvedAIConfig,
  ResolvedAIProviderConfig,
} from './ai-types';

type ProviderMap = Record<string, AIProviderAdapter>;

/** Active provider registry and SDK provider instances owned by AIService. */
export interface AIRegistry {
  providers: Record<string, ResolvedAIProviderConfig>;
  providerInstances: ProviderMap;
  registry: ProviderRegistryProvider<any, '/'>;
  emitCode?: AIEmitCode;
}

/** Model resolution result with provider metadata used for observability. */
export interface ResolvedAIModel<TModel> {
  reference: AIModelReference;
  provider: ResolvedAIProviderConfig;
  model: TModel;
  emitCode?: AIEmitCode;
}

/** Provider-hosted files interface plus the operations Zero may expose. */
export interface ResolvedAIFilesProvider {
  provider: ResolvedAIProviderConfig;
  files: FilesV4;
  operations: AIProviderFileOperations;
  emitCode?: AIEmitCode;
}

/** Create an AI SDK provider registry from active resolved providers. */
export function createAIRegistry(config: ResolvedAIConfig, emitCode?: AIEmitCode): AIRegistry {
  const providerInstances: ProviderMap = {};

  for (const provider of Object.values(config.providers)) {
    if (!provider.active) continue;
    providerInstances[provider.id] = createAIProviderInstance(provider, emitCode);
  }

  return {
    providers: config.providers,
    providerInstances,
    registry: createProviderRegistry(providerInstances, { separator: '/' }),
    ...(emitCode === undefined ? {} : { emitCode }),
  };
}

/** Return public-safe provider statuses for runtime inspection. */
export function getAIProviderStatuses(
  config: ResolvedAIConfig,
  registry: AIRegistry,
): AIProviderStatus[] {
  return Object.values(config.providers).map((provider) => ({
    id: provider.id,
    type: provider.type,
    active: Boolean(provider.active && registry.providerInstances[provider.id]),
    source: provider.source,
    configuredBy: [...provider.configuredBy],
    baseURL: sanitizeProviderBaseURL(provider.baseURL),
    capabilities: { ...provider.capabilities },
    reason: provider.reason,
  }));
}

/** Return whether a model or alias is usable for a capability. */
export function isAIModelActive(
  registry: AIRegistry,
  aliases: Record<string, string>,
  requested: string,
  capability: AICapability = 'text',
): { active: boolean; reason: string | null; resolved?: string } {
  try {
    const reference = resolveAIModelReference(requested, aliases, requested);
    const provider = registry.providers[reference.providerId];
    if (!provider) {
      return {
        active: false,
        reason: 'provider_not_configured',
        resolved: reference.resolved,
      };
    }
    if (!provider.active || !registry.providerInstances[provider.id]) {
      return {
        active: false,
        reason: provider.reason ?? 'provider_not_active',
        resolved: reference.resolved,
      };
    }
    if (!hasAICapability(provider.capabilities, capability)) {
      return {
        active: false,
        reason: `capability_${capability}_not_supported`,
        resolved: reference.resolved,
      };
    }
    return { active: true, reason: null, resolved: reference.resolved };
  } catch (error) {
    return {
      active: false,
      reason: error instanceof Error ? error.message : 'invalid_model',
    };
  }
}

function sanitizeProviderBaseURL(baseURL: string | null | undefined): string | null {
  if (!baseURL) return null;
  try {
    const url = new URL(baseURL);
    // Paths can carry opaque proxy credentials just like query parameters.
    // Public status exposes the operationally useful origin only.
    return url.origin;
  } catch {
    return null;
  }
}

export { parseAIModelReference } from './ai-model-aliases';
export {
  getAIFilesProviderStatus,
  resolveFilesProvider,
} from './ai-files-provider-resolution';
export {
  resolveEmbeddingModel,
  resolveImageModel,
  resolveLanguageModel,
  resolveRerankingModel,
  resolveSpeechModel,
  resolveTranscriptionModel,
  resolveVideoModel,
} from './ai-model-registry-resolution';
