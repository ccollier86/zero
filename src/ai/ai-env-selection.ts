/**
 * ai-env-selection.ts
 *
 * Resolves provider-neutral AI selections after provider activation: default
 * model aliases and the hosted-files provider. It does not activate clients.
 */

import { AIError } from './ai-errors';
import type { ResolvedAIProviderConfig } from './ai-types';
import {
  AI_DEFAULT_ALIAS_CANDIDATES,
  AI_DEFAULT_ALIAS_ENV_KEYS,
} from './ai-provider-catalog';
import type { AIEnv } from './ai-env-values';
import {
  normalizeAIEnvString,
  validateAIProviderId,
} from './ai-env-values';

/** Resolve the hosted-files provider from explicit config before environment. */
export function resolveAIEnvFilesProvider(
  configured: string | undefined,
  env: AIEnv
): string | null {
  if (configured !== undefined) {
    const providerId = normalizeAIEnvString(configured);
    if (!providerId) {
      throw new AIError(
        'AI filesProvider must identify a configured provider.',
        'AI_PROVIDER_CONFIG_INVALID',
        500
      );
    }
    validateAIProviderId(providerId);
    return providerId;
  }

  const providerId = normalizeAIEnvString(env.ZERO_AI_FILES_PROVIDER);
  if (!providerId) return null;
  validateAIProviderId(providerId);
  return providerId;
}

/** Resolve explicit, environment, and capability-aware default model aliases. */
export function resolveAIEnvAliases(
  explicitAliases: Record<string, string>,
  providers: Record<string, ResolvedAIProviderConfig>,
  env: AIEnv
): Record<string, string> {
  const aliases: Record<string, string> = {};

  for (const [alias, envKey] of Object.entries(AI_DEFAULT_ALIAS_ENV_KEYS)) {
    const envModel = normalizeAIEnvString(env[envKey]);
    if (envModel) {
      aliases[alias] = envModel;
      continue;
    }

    const candidates = AI_DEFAULT_ALIAS_CANDIDATES[
      alias as keyof typeof AI_DEFAULT_ALIAS_CANDIDATES
    ];
    const candidate = candidates.find((model) => {
      const parsed = parseProviderModel(model);
      if (!parsed) return false;
      const provider = providers[parsed.providerId];
      const capability = capabilityForDefaultAlias(alias);
      return Boolean(provider?.active && provider.capabilities[capability]);
    });
    if (candidate) aliases[alias] = candidate;
  }

  return { ...aliases, ...explicitAliases };
}

function capabilityForDefaultAlias(
  alias: string
): keyof ResolvedAIProviderConfig['capabilities'] {
  switch (alias) {
    case 'embedding':
      return 'embeddings';
    case 'image':
      return 'images';
    case 'transcription':
      return 'transcription';
    case 'speech':
      return 'speech';
    case 'reranking':
      return 'reranking';
    case 'video':
      return 'video';
    default:
      return 'text';
  }
}

function parseProviderModel(
  model: string
): { providerId: string; modelId: string } | null {
  const index = model.indexOf('/');
  if (index <= 0 || index === model.length - 1) return null;
  return {
    providerId: model.slice(0, index),
    modelId: model.slice(index + 1),
  };
}
