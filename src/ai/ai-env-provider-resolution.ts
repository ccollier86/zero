/**
 * ai-env-provider-resolution.ts
 *
 * Resolves explicit and auto-detected provider records without constructing
 * provider clients. It owns credential/endpoint precedence and readiness only;
 * model aliases and hosted-file selection are resolved elsewhere.
 */

import { createMetaLlamaRetiredError } from './adapters/meta-llama';
import { AIError } from './ai-errors';
import {
  resolveAIProviderCapabilities,
  resolveAIProviderReadiness,
  resolveAIProviderSettings,
  shouldInheritAIProviderApiKey,
  validateAIProviderSettings,
  validateExplicitAIProviderCredentials,
} from './ai-provider-activation';
import {
  AI_PROVIDER_CATALOG,
  findAIProviderCatalogEntry,
  mergeCapabilities,
  type AIProviderActivationKind,
  type AIProviderCatalogEntry,
} from './ai-provider-catalog';
import {
  bedrockEndpointEnvironmentExclusions,
  materializeProviderEndpointSettings,
  providerBaseURLEnvKeys,
  validateResolvedProviderBaseURLs,
} from './ai-env-provider-endpoints';
import type {
  AIProviderConfig,
  AIProviderInstanceSettings,
  ResolvedAIProviderConfig,
} from './ai-types';
import type { AIEnv } from './ai-env-values';
import {
  firstAIEnvValue,
  normalizeAIEnvString,
  validateAIProviderId,
} from './ai-env-values';

/** Resolve app-declared providers with explicit config taking env precedence. */
export function resolveExplicitAIProviders(
  providers: Record<string, AIProviderConfig | false>,
  env: AIEnv
): Record<string, ResolvedAIProviderConfig> {
  const resolved: Record<string, ResolvedAIProviderConfig> = {};

  for (const [id, provider] of Object.entries(providers)) {
    validateAIProviderId(id);
    if (provider === false) {
      resolved[id] = disabledProvider(id);
      continue;
    }
    if (provider.type === 'meta-llama' && provider.enabled !== false) {
      throw createMetaLlamaRetiredError();
    }

    const catalog = findProviderCatalog(id, provider.type);
    const activation = catalog?.activation ?? fallbackActivation(provider.type);
    validateAIProviderSettings(provider);
    validateExplicitAIProviderCredentials(provider, activation);
    const inheritApiKey = shouldInheritAIProviderApiKey(provider, activation);
    const apiKeyEnv = inheritApiKey
      ? firstAIEnvValue(providerEnvKeys(id, provider.type, catalog), env)
      : { key: null, value: normalizeAIEnvString(provider.apiKey ?? undefined) };
    const baseURLSuppressed = provider.baseURL === null;
    const explicitBaseURL = normalizeAIEnvString(provider.baseURL ?? undefined);
    const baseURLEnv = !baseURLSuppressed && !explicitBaseURL
      ? firstAIEnvValue(providerBaseURLEnvKeys(id, provider.type), env)
      : { key: null, value: explicitBaseURL };
    const apiKey = apiKeyEnv.value;
    const endpointSettingExclusions = bedrockEndpointEnvironmentExclusions(
      provider.type,
      baseURLSuppressed || Boolean(explicitBaseURL),
      baseURLEnv.key
    );
    const providerSettings = resolveAIProviderSettings(provider.settings, catalog, env, {
      excludeEnvironmentSettings: mergeEnvironmentSettingExclusions(
        environmentSettingsExcludedByApiKey(activation, apiKey),
        endpointSettingExclusions
      ),
    });
    const genericBaseURL = baseURLSuppressed
      ? catalog?.baseURL
      : baseURLEnv.value ?? catalog?.baseURL;
    const settings = materializeProviderEndpointSettings(
      provider.type,
      genericBaseURL,
      providerSettings.settings
    );
    const baseURL = provider.type === 'amazon-bedrock'
      ? providerSettings.settings?.runtimeBaseURL ?? genericBaseURL
      : genericBaseURL;
    validateResolvedProviderBaseURLs(id, provider.type, genericBaseURL, settings);
    const readiness = resolveAIProviderReadiness({
      provider,
      activation,
      apiKey,
      baseURL: provider.type === 'amazon-bedrock' ? settings?.runtimeBaseURL : baseURL,
      settings,
      explicit: true,
    });

    resolved[id] = {
      ...provider,
      id,
      source: 'config',
      active: provider.enabled !== false && readiness.active,
      apiKey,
      baseURL,
      ...(baseURLSuppressed ? { baseURLSuppressed: true as const } : {}),
      settings,
      configuredBy: resolvedProviderConfiguredBy(
        provider.type,
        apiKeyEnv.key,
        baseURLEnv.key,
        providerSettings
      ),
      capabilities: resolveAIProviderCapabilities(
        catalog?.capabilities ?? defaultCustomCapabilities(),
        provider,
        apiKey,
        settings
      ),
      reason: provider.enabled === false ? 'config_disabled' : readiness.reason,
    };
  }

  return resolved;
}

/** Auto-detect catalog providers not replaced by explicit app configuration. */
export function detectAIEnvProviders(
  env: AIEnv,
  explicitProviders: Record<string, ResolvedAIProviderConfig>
): Record<string, ResolvedAIProviderConfig> {
  const resolved: Record<string, ResolvedAIProviderConfig> = {};

  for (const catalog of AI_PROVIDER_CATALOG) {
    if (catalog.id in explicitProviders) continue;
    const detected = firstAIEnvValue(catalog.envKeys, env);
    const baseURLEnv = firstAIEnvValue(
      providerBaseURLEnvKeys(catalog.id, catalog.type),
      env
    );
    const providerSettings = resolveAIProviderSettings(undefined, catalog, env, {
      excludeEnvironmentSettings: mergeEnvironmentSettingExclusions(
        environmentSettingsExcludedByApiKey(catalog.activation, detected.value),
        bedrockEndpointEnvironmentExclusions(catalog.type, false, baseURLEnv.key)
      ),
    });
    const provider: AIProviderConfig = { type: catalog.type };
    const apiKey = detected.value;
    const genericBaseURL = baseURLEnv.value ?? catalog.baseURL;
    const settings = materializeProviderEndpointSettings(
      catalog.type,
      genericBaseURL,
      providerSettings.settings
    );
    const baseURL = catalog.type === 'amazon-bedrock'
      ? providerSettings.settings?.runtimeBaseURL ?? genericBaseURL
      : genericBaseURL;
    validateResolvedProviderBaseURLs(catalog.id, catalog.type, genericBaseURL, settings);
    const readiness = resolveAIProviderReadiness({
      provider,
      activation: catalog.activation,
      apiKey,
      baseURL: catalog.type === 'amazon-bedrock' ? settings?.runtimeBaseURL : baseURL,
      settings,
      explicit: false,
    });

    resolved[catalog.id] = {
      id: catalog.id,
      type: catalog.type,
      source: 'env',
      enabled: true,
      active: readiness.active,
      apiKey,
      baseURL,
      settings,
      configuredBy: resolvedProviderConfiguredBy(
        catalog.type,
        detected.key,
        baseURLEnv.key,
        providerSettings
      ),
      capabilities: resolveAIProviderCapabilities(
        catalog.capabilities,
        provider,
        apiKey,
        settings
      ),
      reason: readiness.reason,
    };
  }

  return resolved;
}

/** Match explicit providers without allowing reserved ids to change adapters. */
function findProviderCatalog(
  id: string,
  type: AIProviderConfig['type']
): AIProviderCatalogEntry | undefined {
  const byId = AI_PROVIDER_CATALOG.find((entry) => entry.id === id);
  if (byId) {
    // App-owned and OpenAI-compatible adapters intentionally retain their
    // established built-in-id replacement escape hatch.
    if (type === 'custom') return undefined;
    if (type === 'openai-compatible' && !byId.compatibleTypes?.includes(type)) {
      return undefined;
    }
    const compatible = byId.type === type || byId.compatibleTypes?.includes(type);
    if (!compatible) {
      throw new AIError(
        `AI provider id "${id}" is reserved for adapter type "${byId.type}", not "${type}".`,
        'AI_PROVIDER_CONFIG_INVALID',
        500
      );
    }
    return byId;
  }
  if (type === 'openai-compatible' || type === 'custom') return undefined;
  return findAIProviderCatalogEntry(type);
}

function environmentSettingsExcludedByApiKey(
  activation: AIProviderActivationKind,
  apiKey: string | undefined
): ReadonlySet<keyof AIProviderInstanceSettings> | undefined {
  if (!apiKey) return undefined;
  switch (activation) {
    case 'anthropic':
      return new Set(['authToken']);
    case 'anthropic-aws':
      return new Set(['accessKeyId', 'secretAccessKey', 'sessionToken']);
    case 'klingai':
      return new Set(['accessKey', 'secretKey']);
    case 'amazon-bedrock':
      return new Set(['accessKeyId', 'secretAccessKey', 'sessionToken']);
    case 'google-vertex':
      return new Set(['project', 'location']);
    default:
      return undefined;
  }
}

function mergeEnvironmentSettingExclusions(
  ...sets: Array<ReadonlySet<keyof AIProviderInstanceSettings> | undefined>
): ReadonlySet<keyof AIProviderInstanceSettings> | undefined {
  const merged = new Set<keyof AIProviderInstanceSettings>();
  for (const settingSet of sets) {
    for (const setting of settingSet ?? []) merged.add(setting);
  }
  return merged.size > 0 ? merged : undefined;
}

function resolvedProviderConfiguredBy(
  type: AIProviderConfig['type'],
  credentialEnvKey: string | null,
  genericBaseURLEnvKey: string | null,
  providerSettings: {
    settings: AIProviderInstanceSettings | undefined;
    configuredBy: string[];
  }
): string[] {
  const genericEndpointIsUsed = type !== 'amazon-bedrock'
    || !providerSettings.settings?.runtimeBaseURL
    || !providerSettings.settings.agentRuntimeBaseURL;
  return [
    credentialEnvKey,
    ...(genericEndpointIsUsed ? [genericBaseURLEnvKey] : []),
    ...providerSettings.configuredBy,
  ].filter((key): key is string => Boolean(key));
}

function disabledProvider(id: string): ResolvedAIProviderConfig {
  const catalog = AI_PROVIDER_CATALOG.find((entry) => entry.id === id);
  return {
    id,
    type: catalog?.type ?? 'custom',
    source: 'config',
    enabled: false,
    active: false,
    configuredBy: [],
    capabilities: mergeCapabilities(
      catalog?.capabilities ?? defaultCustomCapabilities(),
      undefined
    ),
    reason: 'config_disabled',
  };
}

function fallbackActivation(type: AIProviderConfig['type']): AIProviderActivationKind {
  if (type === 'custom') return 'custom';
  if (type === 'openai-compatible') return 'base-url';
  return 'api-key';
}

function defaultCustomCapabilities() {
  return {
    text: true,
    streaming: true,
    tools: true,
    vision: false,
    embeddings: false,
    images: false,
    transcription: false,
    speech: false,
    reranking: false,
    video: false,
    files: false,
    fileMetadata: false,
    fileDownload: false,
    fileDelete: false,
    skills: false,
    realtime: false,
    evaluation: false,
    batch: false,
  };
}

function providerEnvKeys(
  id: string,
  type: AIProviderConfig['type'],
  catalog: AIProviderCatalogEntry | undefined
): string[] {
  const idKey = `${envKeyPrefix(id)}_API_KEY`;
  if (catalog) return [idKey, ...catalog.envKeys].filter(unique);
  return [idKey, `${envKeyPrefix(type)}_API_KEY`].filter(unique);
}

function envKeyPrefix(idOrType: string): string {
  return idOrType.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
}

function unique(value: string, index: number, list: readonly string[]): boolean {
  return list.indexOf(value) === index;
}
