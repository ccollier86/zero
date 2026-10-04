/** Credential readiness and provider-specific config projection for Zero AI. */

import { mergeCapabilities, type AIProviderActivationKind, type AIProviderCatalogEntry } from './ai-provider-catalog';
import { AIError } from './ai-errors';
import {
  normalizeAIProviderSettings,
  validateAIProviderSettingValues,
} from './ai-provider-settings';
import type {
  AIProviderCapabilities,
  AIProviderConfig,
  AIProviderInstanceSettings,
  ResolvedAIProviderCapabilities,
} from './ai-types';

export { validateAIProviderSettings } from './ai-provider-settings';

/** Inputs required to decide whether a provider is safe to construct. */
export interface AIProviderReadinessInput {
  provider: AIProviderConfig;
  activation: AIProviderActivationKind;
  apiKey?: string;
  baseURL?: string | null;
  settings?: AIProviderInstanceSettings;
  explicit: boolean;
}

/** Validate the credential alternatives required by one provider family. */
export function resolveAIProviderReadiness(
  input: AIProviderReadinessInput
): { active: boolean; reason: string | null } {
  if (input.provider.enabled === false) return { active: false, reason: 'config_disabled' };

  switch (input.activation) {
    case 'custom':
      return input.provider.adapter
        ? { active: true, reason: null }
        : { active: false, reason: 'missing_custom_provider_adapter' };
    case 'base-url':
      return input.baseURL
        ? { active: true, reason: null }
        : { active: false, reason: 'missing_base_url' };
    case 'gateway':
      return input.apiKey || input.explicit
        ? { active: true, reason: null }
        : { active: false, reason: 'missing_api_key_or_oidc_opt_in' };
    case 'anthropic':
      return input.apiKey || input.settings?.authToken
        ? { active: true, reason: null }
        : { active: false, reason: 'missing_credentials' };
    case 'anthropic-aws':
      return anthropicAwsReadiness(input.apiKey, input.baseURL, input.settings);
    case 'klingai':
      return klingAiReadiness(input.apiKey, input.settings);
    case 'amazon-bedrock':
      return bedrockReadiness(input.apiKey, input.baseURL, input.settings);
    case 'azure':
      return azureReadiness(input.apiKey, input.baseURL, input.settings);
    case 'google-vertex':
      return vertexReadiness(input.apiKey, input.baseURL, input.settings);
    case 'api-key':
      return input.apiKey
        ? { active: true, reason: null }
        : { active: false, reason: 'missing_api_key' };
  }
}

/** Resolve provider-specific settings from explicit config and catalog env bindings. */
export function resolveAIProviderSettings(
  explicit: AIProviderInstanceSettings | undefined,
  catalog: AIProviderCatalogEntry | undefined,
  env: Record<string, string | undefined>,
  options: { excludeEnvironmentSettings?: ReadonlySet<keyof AIProviderInstanceSettings> } = {}
): { settings: AIProviderInstanceSettings | undefined; configuredBy: string[] } {
  const settings = normalizeAIProviderSettings({ ...explicit });
  const configuredBy: string[] = [];

  for (const [setting, keys] of Object.entries(catalog?.settingsEnvKeys ?? {})) {
    const settingKey = setting as keyof AIProviderInstanceSettings;
    if (options.excludeEnvironmentSettings?.has(settingKey)) continue;
    if (settings[settingKey] !== undefined) continue;
    const detected = firstSettingEnvValue(keys, env);
    if (!detected.value) continue;
    (settings as Record<string, unknown>)[settingKey] = detected.value;
    if (detected.key) configuredBy.push(detected.key);
  }

  const normalized = normalizeAIProviderSettings(settings);
  if (catalog) validateAIProviderSettingValues(catalog.type, normalized);

  return {
    settings: Object.keys(normalized).length > 0 ? normalized : undefined,
    configuredBy,
  };
}

/**
 * Decide whether an explicitly declared provider should inherit its API key
 * from the environment. An explicit alternate credential mode is
 * authoritative, so an unrelated ambient key cannot silently switch modes.
 */
export function shouldInheritAIProviderApiKey(
  provider: AIProviderConfig,
  activation: AIProviderActivationKind
): boolean {
  if (provider.apiKey === null || normalizeSetting(provider.apiKey)) return false;

  const settings = provider.settings;
  switch (activation) {
    case 'gateway':
      return true;
    case 'anthropic':
      return !normalizeSetting(settings?.authToken);
    case 'anthropic-aws':
      return !Boolean(
        settings?.credentialProvider
        || normalizeSetting(settings?.accessKeyId)
        || normalizeSetting(settings?.secretAccessKey)
        || normalizeSetting(settings?.sessionToken)
      );
    case 'klingai':
      return !Boolean(
        normalizeSetting(settings?.accessKey)
        || normalizeSetting(settings?.secretKey)
      );
    case 'amazon-bedrock':
      return !Boolean(
        settings?.credentialProvider
        || normalizeSetting(settings?.accessKeyId)
        || normalizeSetting(settings?.secretAccessKey)
        || normalizeSetting(settings?.sessionToken)
      );
    case 'azure':
      return !settings?.tokenProvider;
    case 'google-vertex':
      return !Boolean(
        normalizeSetting(settings?.project)
        || normalizeSetting(settings?.location)
        || settings?.googleAuthOptions
      );
    default:
      return true;
  }
}

/** Reject ambiguous explicit credential modes before constructing an SDK client. */
export function validateExplicitAIProviderCredentials(
  provider: AIProviderConfig,
  activation: AIProviderActivationKind
): void {
  const apiKey = normalizeSetting(provider.apiKey ?? undefined);
  if (!apiKey) return;

  const settings = provider.settings;
  const conflict = (() => {
    switch (activation) {
      case 'anthropic':
        return normalizeSetting(settings?.authToken) ? 'authToken' : null;
      case 'anthropic-aws':
        return settings?.credentialProvider
          || normalizeSetting(settings?.accessKeyId)
          || normalizeSetting(settings?.secretAccessKey)
          || normalizeSetting(settings?.sessionToken)
          ? 'SigV4 credentials'
          : null;
      case 'klingai':
        return normalizeSetting(settings?.accessKey)
          || normalizeSetting(settings?.secretKey)
          ? 'legacy access-key credentials'
          : null;
      case 'amazon-bedrock':
        return settings?.credentialProvider
          || normalizeSetting(settings?.accessKeyId)
          || normalizeSetting(settings?.secretAccessKey)
          || normalizeSetting(settings?.sessionToken)
          ? 'SigV4 credentials'
          : null;
      case 'azure':
        return settings?.tokenProvider ? 'tokenProvider' : null;
      case 'google-vertex':
        return normalizeSetting(settings?.project)
          || normalizeSetting(settings?.location)
          || settings?.googleAuthOptions
          ? 'ADC settings'
          : null;
      default:
        return null;
    }
  })();

  if (conflict) {
    throw new AIError(
      `AI provider type "${provider.type}" cannot configure both apiKey and ${conflict}. Choose one credential mode.`,
      'AI_PROVIDER_CONFIG_INVALID',
      500
    );
  }
}

/** Apply config overrides plus auth-mode-specific capability constraints. */
export function resolveAIProviderCapabilities(
  defaults: ResolvedAIProviderCapabilities,
  provider: AIProviderConfig,
  apiKey: string | undefined,
  settings: AIProviderInstanceSettings | undefined
): ResolvedAIProviderCapabilities {
  const maximum: ResolvedAIProviderCapabilities | null = provider.type === 'custom'
    ? null
    : provider.type === 'openai-compatible'
      ? {
          text: true,
          streaming: true,
          tools: true,
          vision: true,
          embeddings: true,
          images: true,
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
        }
      : defaults;
  if (maximum) {
    for (const [capability, enabled] of Object.entries(provider.capabilities ?? {})) {
      const name = capability as keyof AIProviderCapabilities;
      if (enabled === true && maximum[name] !== true) {
        throw new AIError(
          `AI provider type "${provider.type}" cannot enable unsupported capability "${name}".`,
          'AI_PROVIDER_CONFIG_INVALID',
          500
        );
      }
    }
  }

  const capabilities = mergeCapabilities(defaults, provider.capabilities);
  if (maximum) {
    for (const capability of Object.keys(capabilities) as Array<keyof ResolvedAIProviderCapabilities>) {
      capabilities[capability] = capabilities[capability] && maximum[capability];
    }
  }
  if (!capabilities.files) {
    for (const operation of ['fileMetadata', 'fileDownload', 'fileDelete'] as const) {
      if (provider.capabilities?.[operation] === true) {
        throw new AIError(
          `AI provider type "${provider.type}" cannot enable "${operation}" without hosted file uploads.`,
          'AI_PROVIDER_CONFIG_INVALID',
          500
        );
      }
      capabilities[operation] = false;
    }
  }
  if (
    provider.type === 'google-vertex'
    && (apiKey || !settings?.project || !settings.location)
  ) capabilities.transcription = false;
  if (provider.type === 'amazon-bedrock' && !settings?.region) {
    capabilities.reranking = false;
  }
  if (provider.type === 'baseten' && !settings?.modelURL) capabilities.embeddings = false;
  return capabilities;
}

function bedrockReadiness(
  bearerToken: string | undefined,
  baseURL: string | null | undefined,
  settings: AIProviderInstanceSettings | undefined
): { active: boolean; reason: string | null } {
  if (bearerToken) {
    return settings?.region || baseURL
      ? { active: true, reason: null }
      : { active: false, reason: 'missing_region' };
  }
  if (!settings?.region) return { active: false, reason: 'missing_region' };
  if (settings.credentialProvider) return { active: true, reason: null };
  if (Boolean(settings.accessKeyId) !== Boolean(settings.secretAccessKey)) {
    return { active: false, reason: 'partial_aws_credentials' };
  }
  return settings.accessKeyId && settings.secretAccessKey
    ? { active: true, reason: null }
    : { active: false, reason: 'missing_credentials' };
}

function anthropicAwsReadiness(
  apiKey: string | undefined,
  baseURL: string | null | undefined,
  settings: AIProviderInstanceSettings | undefined
): { active: boolean; reason: string | null } {
  if (!settings?.workspaceId) return { active: false, reason: 'missing_workspace_id' };
  if (apiKey) {
    return settings.region || baseURL
      ? { active: true, reason: null }
      : { active: false, reason: 'missing_region' };
  }
  if (!settings.region) return { active: false, reason: 'missing_region' };
  if (settings.credentialProvider) return { active: true, reason: null };
  if (Boolean(settings.accessKeyId) !== Boolean(settings.secretAccessKey)) {
    return { active: false, reason: 'partial_aws_credentials' };
  }
  return settings.accessKeyId && settings.secretAccessKey
    ? { active: true, reason: null }
    : { active: false, reason: 'missing_credentials' };
}

function klingAiReadiness(
  apiKey: string | undefined,
  settings: AIProviderInstanceSettings | undefined
): { active: boolean; reason: string | null } {
  if (apiKey) return { active: true, reason: null };
  if (Boolean(settings?.accessKey) !== Boolean(settings?.secretKey)) {
    return { active: false, reason: 'partial_klingai_credentials' };
  }
  return settings?.accessKey && settings.secretKey
    ? { active: true, reason: null }
    : { active: false, reason: 'missing_credentials' };
}

function azureReadiness(
  apiKey: string | undefined,
  baseURL: string | null | undefined,
  settings: AIProviderInstanceSettings | undefined
): { active: boolean; reason: string | null } {
  if (!baseURL && !settings?.resourceName) return { active: false, reason: 'missing_azure_endpoint' };
  if (!apiKey && !settings?.tokenProvider) return { active: false, reason: 'missing_credentials' };
  return { active: true, reason: null };
}

function vertexReadiness(
  apiKey: string | undefined,
  baseURL: string | null | undefined,
  settings: AIProviderInstanceSettings | undefined
): { active: boolean; reason: string | null } {
  if (apiKey) return { active: true, reason: null };
  if (baseURL) return { active: true, reason: null };
  if (!settings?.project) return { active: false, reason: 'missing_project' };
  if (!settings.location) return { active: false, reason: 'missing_location' };
  return { active: true, reason: null };
}

function firstSettingEnvValue(
  keys: readonly string[],
  env: Record<string, string | undefined>
): { key: string | null; value: string | undefined } {
  for (const key of keys) {
    const value = normalizeSetting(env[key]);
    if (value) return { key, value };
  }
  return { key: null, value: undefined };
}

function normalizeSetting(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
