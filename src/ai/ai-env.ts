/**
 * ai-env.ts
 *
 * Resolves AI configuration from explicit createApp config plus process
 * environment. This file owns detection and normalization only; it does not
 * instantiate provider clients or execute model calls.
 */

import type { AIConfig, AIProviderConfig, ResolvedAIConfig, ResolvedAIProviderConfig } from './ai-types';
import {
  AI_DEFAULT_ALIAS_CANDIDATES,
  AI_DEFAULT_ALIAS_ENV_KEYS,
  AI_PROVIDER_CATALOG,
  findAIProviderCatalogEntry,
  mergeCapabilities,
} from './ai-provider-catalog';

/** Minimal environment map used to keep config resolution testable. */
export type AIEnv = Record<string, string | undefined>;

const DEFAULT_STATUS_BASE_PATH = '/api/_zero/ai';

/**
 * Resolve AI config accepted by `createApp()`.
 *
 * Returns false when AI is omitted or disabled. `ai: true` enables env
 * auto-detection with defaults.
 */
export function resolveAIConfig(
  input: boolean | AIConfig | undefined,
  env: AIEnv = Bun.env
): ResolvedAIConfig | false {
  if (input === false || input === undefined) return false;

  const config: AIConfig = input === true ? {} : input;
  const autoDetect = config.autoDetect !== false;
  const explicitProviders = resolveExplicitProviders(config.providers ?? {}, env);
  const autoProviders = autoDetect ? detectEnvProviders(env, explicitProviders) : {};
  const providers = { ...autoProviders, ...explicitProviders };
  const aliases = resolveAliases(config.aliases ?? {}, providers, env);
  const statusEndpoint = config.statusEndpoint === false || config.statusEndpoint === undefined
    ? { enabled: false, basePath: DEFAULT_STATUS_BASE_PATH }
    : {
        enabled: config.statusEndpoint?.enabled !== false,
        basePath: config.statusEndpoint?.basePath ?? DEFAULT_STATUS_BASE_PATH,
        read: config.statusEndpoint?.read,
      };

  return {
    enabled: true,
    autoDetect,
    providers,
    aliases,
    statusEndpoint,
  };
}

function resolveExplicitProviders(
  providers: Record<string, AIProviderConfig | false>,
  env: AIEnv
): Record<string, ResolvedAIProviderConfig> {
  const resolved: Record<string, ResolvedAIProviderConfig> = {};

  for (const [id, provider] of Object.entries(providers)) {
    if (provider === false) {
      resolved[id] = disabledProvider(id, 'config_disabled');
      continue;
    }

    const catalog = findProviderCatalog(id, provider.type);
    const apiKeyEnv = provider.apiKey === undefined
      ? firstEnvValue(providerEnvKeys(id, provider.type, catalog), env)
      : { key: null, value: normalizeSecret(provider.apiKey ?? undefined) };
    const baseURLEnv = provider.baseURL === undefined
      ? firstEnvValue(baseUrlEnvKeys(id, provider.type), env)
      : { key: null, value: normalizeSecret(provider.baseURL ?? undefined) };
    const apiKey = apiKeyEnv.value;
    const baseURL = baseURLEnv.value ?? catalog?.baseURL;
    const configuredBy = [apiKeyEnv.key, baseURLEnv.key].filter((key): key is string => Boolean(key));
    const capabilities = mergeCapabilities(
      catalog?.capabilities ?? {
        text: true,
        streaming: true,
        tools: true,
        vision: false,
        embeddings: false,
        images: false,
        transcription: false,
        speech: false,
      },
      provider.capabilities
    );
    const requiresApiKey = catalog?.requiresApiKey ?? provider.type !== 'custom';
    const active = provider.enabled !== false && hasRequiredProviderSettings(
      provider,
      requiresApiKey,
      apiKey,
      baseURL
    );

    resolved[id] = {
      ...provider,
      id,
      source: 'config',
      active,
      apiKey,
      configuredBy,
      baseURL,
      capabilities,
      reason: active ? null : inactiveProviderReason(provider, requiresApiKey, apiKey, baseURL),
    };
  }

  return resolved;
}

/** Match explicit providers to a catalog entry without assigning random compatible defaults. */
function findProviderCatalog(id: string, type: AIProviderConfig['type']) {
  const byId = findAIProviderCatalogEntry(id);
  if (byId) return byId;
  if (type === 'openai-compatible' || type === 'custom') return undefined;
  return findAIProviderCatalogEntry(type);
}

function detectEnvProviders(
  env: AIEnv,
  explicitProviders: Record<string, ResolvedAIProviderConfig>
): Record<string, ResolvedAIProviderConfig> {
  const resolved: Record<string, ResolvedAIProviderConfig> = {};

  for (const entry of AI_PROVIDER_CATALOG) {
    if (entry.id in explicitProviders) continue;
    const detected = firstEnvValue(entry.envKeys, env);
    const baseURLEnv = firstEnvValue(baseUrlEnvKeys(entry.id, entry.type), env);
    const apiKey = detected.value;

    resolved[entry.id] = {
      id: entry.id,
      type: entry.type,
      source: 'env',
      enabled: true,
      active: Boolean(apiKey || !entry.requiresApiKey),
      apiKey,
      baseURL: baseURLEnv.value ?? entry.baseURL,
      configuredBy: [detected.key, baseURLEnv.key].filter((key): key is string => Boolean(key)),
      capabilities: entry.capabilities,
      reason: apiKey || !entry.requiresApiKey ? null : 'missing_env_key',
    };
  }

  return resolved;
}

function firstEnvValue(keys: readonly string[], env: AIEnv): { key: string | null; value: string | undefined } {
  for (const key of keys) {
    const value = normalizeSecret(env[key]);
    if (value) return { key, value };
  }
  return { key: null, value: undefined };
}

function normalizeSecret(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function disabledProvider(id: string, reason: string): ResolvedAIProviderConfig {
  return {
    id,
    type: 'custom',
    source: 'config',
    enabled: false,
    active: false,
    configuredBy: [],
    capabilities: {
      text: false,
      streaming: false,
      tools: false,
      vision: false,
      embeddings: false,
      images: false,
      transcription: false,
      speech: false,
    },
    reason,
  };
}

function hasRequiredProviderSettings(
  provider: AIProviderConfig,
  requiresApiKey: boolean,
  apiKey: string | undefined,
  baseURL?: string | null
): boolean {
  if (provider.enabled === false) return false;
  if (provider.type === 'custom') return Boolean(provider.adapter);
  if (provider.type === 'openai-compatible' && !baseURL) return false;
  return !requiresApiKey || Boolean(apiKey);
}

function inactiveProviderReason(
  provider: AIProviderConfig,
  requiresApiKey: boolean,
  apiKey: string | undefined,
  baseURL?: string | null
): string {
  if (provider.enabled === false) return 'config_disabled';
  if (provider.type === 'custom' && !provider.adapter) return 'missing_custom_provider_adapter';
  if (provider.type === 'openai-compatible' && !baseURL) return 'missing_required_settings';
  if (requiresApiKey && !apiKey) return 'missing_required_settings';
  return 'missing_required_settings';
}

function resolveAliases(
  explicitAliases: Record<string, string>,
  providers: Record<string, ResolvedAIProviderConfig>,
  env: AIEnv
): Record<string, string> {
  const aliases: Record<string, string> = {};

  for (const [alias, envKey] of Object.entries(AI_DEFAULT_ALIAS_ENV_KEYS)) {
    const envModel = normalizeSecret(env[envKey]);
    if (envModel) {
      aliases[alias] = envModel;
      continue;
    }

    const candidate = AI_DEFAULT_ALIAS_CANDIDATES[alias as keyof typeof AI_DEFAULT_ALIAS_CANDIDATES]
      .find((model) => {
        const parsed = parseProviderModel(model);
        return parsed ? providers[parsed.providerId]?.active : false;
      });
    if (candidate) aliases[alias] = candidate;
  }

  return { ...aliases, ...explicitAliases };
}

function parseProviderModel(model: string): { providerId: string; modelId: string } | null {
  const index = model.indexOf('/');
  if (index <= 0 || index === model.length - 1) return null;
  return {
    providerId: model.slice(0, index),
    modelId: model.slice(index + 1),
  };
}

function providerEnvKeys(
  id: string,
  type: AIProviderConfig['type'],
  catalog: ReturnType<typeof findProviderCatalog>
): string[] {
  if (catalog) return [...catalog.envKeys];
  return [`${envKeyPrefix(id)}_API_KEY`, `${envKeyPrefix(type)}_API_KEY`].filter(unique);
}

function baseUrlEnvKeys(id: string, type: AIProviderConfig['type']): string[] {
  return [`${envKeyPrefix(id)}_BASE_URL`, `${envKeyPrefix(type)}_BASE_URL`].filter(unique);
}

function envKeyPrefix(idOrType: string): string {
  return idOrType.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
}

function unique(value: string, index: number, list: readonly string[]): boolean {
  return list.indexOf(value) === index;
}
