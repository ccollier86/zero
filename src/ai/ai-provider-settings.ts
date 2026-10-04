/** Runtime validation and normalization for built-in AI provider settings. */

import { AIError } from './ai-errors';
import type {
  AIProviderConfig,
  AIProviderInstanceSettings,
  AIProviderType,
} from './ai-types';

type SettingName = keyof AIProviderInstanceSettings;
type SettingValidator = (value: unknown) => string | null;

/**
 * Reject settings that the selected adapter cannot consume and validate every
 * supported value before an SDK client can observe it.
 */
export function validateAIProviderSettings(provider: AIProviderConfig): void {
  if (provider.settings === undefined || provider.type === 'custom') return;
  if (!isObjectValue(provider.settings)) {
    throw invalidSettingsError(provider.type, null, 'must be an object');
  }

  const configured = Object.entries(provider.settings)
    .filter(([, value]) => value !== undefined);
  if (configured.length === 0) return;

  const allowed = PROVIDER_SETTING_KEYS[provider.type] ?? EMPTY_PROVIDER_SETTING_KEYS;
  const unsupported = configured.find(([setting]) => !allowed.has(setting));
  if (unsupported) {
    throw new AIError(
      `AI provider type "${provider.type}" does not support settings.${unsupported[0]}.`,
      'AI_PROVIDER_CONFIG_INVALID',
      500
    );
  }

  validateAIProviderSettingValues(provider.type, provider.settings);
}

/** Validate values after catalog environment settings have been projected. */
export function validateAIProviderSettingValues(
  providerType: AIProviderType,
  settings: AIProviderInstanceSettings
): void {
  for (const [setting, value] of Object.entries(settings)) {
    if (value === undefined) continue;
    const validator = SETTING_VALIDATORS[setting as SettingName];
    if (!validator) continue;
    const requirement = validator(value);
    if (requirement) {
      throw invalidSettingsError(providerType, setting, requirement);
    }
  }

  if (providerType === 'baseten' && settings.performanceClient && !settings.modelURL) {
    throw invalidSettingsError(
      providerType,
      'performanceClient',
      'requires settings.modelURL'
    );
  }
}

/**
 * Clone provider settings and trim known string options. A whitespace-only
 * optional value has the same meaning as omission and is removed from the
 * resolved settings rather than leaking a truthy-but-unusable SDK option.
 */
export function normalizeAIProviderSettings(
  input: AIProviderInstanceSettings
): AIProviderInstanceSettings {
  const normalized: AIProviderInstanceSettings = { ...input };
  const values = normalized as Record<string, unknown>;

  for (const setting of STRING_SETTING_KEYS) {
    const value = values[setting];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) {
      values[setting] = setting === 'modelURL'
        ? normalizeBasetenModelURL(trimmed)
        : trimmed;
    }
    else delete values[setting];
  }

  return normalized;
}

function invalidSettingsError(
  providerType: AIProviderType,
  setting: string | null,
  requirement: string
): AIError {
  const subject = setting ? `settings.${setting}` : 'settings';
  return new AIError(
    `AI provider type "${providerType}" ${subject} ${requirement}.`,
    'AI_PROVIDER_CONFIG_INVALID',
    500
  );
}

function validateString(value: unknown): string | null {
  return typeof value === 'string' ? null : 'must be a string when provided';
}

function parseAbsoluteHttpURL(value: unknown): URL | string | null {
  const stringError = validateString(value);
  if (stringError) return stringError;
  const normalized = (value as string).trim();
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed;
  } catch {
    // The stable configuration error below intentionally omits the URL value.
  }
  return 'must be an absolute HTTP(S) URL when provided';
}

function validateAbsoluteHttpURL(value: unknown): string | null {
  const parsed = parseAbsoluteHttpURL(value);
  return typeof parsed === 'string' ? parsed : null;
}

function validateBasetenModelURL(value: unknown): string | null {
  const parsed = parseAbsoluteHttpURL(value);
  if (typeof parsed === 'string' || parsed === null) return parsed;
  const pathname = parsed.pathname.replace(/\/+$/, '');
  if (
    !parsed.search
    && !parsed.hash
    && (pathname.endsWith('/sync') || pathname.endsWith('/sync/v1'))
  ) return null;
  return 'must target a Baseten /sync or /sync/v1 endpoint without query or fragment data';
}

function validatePositiveSafeInteger(value: unknown): string | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? null
    : 'must be a finite positive integer';
}

function validateBoolean(value: unknown): string | null {
  return typeof value === 'boolean' ? null : 'must be a boolean';
}

function validateFunction(value: unknown): string | null {
  return typeof value === 'function' ? null : 'must be a function';
}

function validateConstructor(value: unknown): string | null {
  const functionError = validateFunction(value);
  if (functionError) return functionError;
  try {
    Reflect.construct(String, [], value as Function);
    return null;
  } catch {
    return 'must be a constructable function';
  }
}

function validateObject(value: unknown): string | null {
  return isObjectValue(value) ? null : 'must be a non-array object';
}

function validateAzureResourceName(value: unknown): string | null {
  const stringError = validateString(value);
  if (stringError) return stringError;
  const normalized = (value as string).trim();
  if (!normalized) return null;
  return normalized.length <= 63
    && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(normalized)
    ? null
    : 'must be a single DNS label containing only letters, digits, and interior hyphens';
}

function validateAwsRegion(value: unknown): string | null {
  const stringError = validateString(value);
  if (stringError) return stringError;
  const normalized = (value as string).trim();
  if (!normalized) return null;
  return normalized.length <= 63
    && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(normalized)
    ? null
    : 'must be a single DNS label containing only letters, digits, and interior hyphens';
}

function isObjectValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeBasetenModelURL(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString();
  } catch {
    return value;
  }
}

const STRING_SETTING_KEYS = Object.freeze([
  'teamIdOrSlug',
  'authToken',
  'workspaceId',
  'region',
  'runtimeBaseURL',
  'agentRuntimeBaseURL',
  'accessKeyId',
  'secretAccessKey',
  'sessionToken',
  'accessKey',
  'secretKey',
  'resourceName',
  'apiVersion',
  'speechBaseURL',
  'project',
  'location',
  'modelURL',
  'embeddingBaseURL',
  'videoBaseURL',
  'version',
] as const satisfies readonly SettingName[]);

const SETTING_VALIDATORS: Partial<Record<SettingName, SettingValidator>> = {
  teamIdOrSlug: validateString,
  authToken: validateString,
  workspaceId: validateString,
  region: validateAwsRegion,
  runtimeBaseURL: validateAbsoluteHttpURL,
  agentRuntimeBaseURL: validateAbsoluteHttpURL,
  accessKeyId: validateString,
  secretAccessKey: validateString,
  sessionToken: validateString,
  accessKey: validateString,
  secretKey: validateString,
  resourceName: validateAzureResourceName,
  tokenProvider: validateFunction,
  apiVersion: validateString,
  speechBaseURL: validateAbsoluteHttpURL,
  useDeploymentBasedUrls: validateBoolean,
  project: validateString,
  location: validateString,
  googleAuthOptions: validateObject,
  metadataCacheRefreshMillis: validatePositiveSafeInteger,
  strictResponseInput: validateBoolean,
  modelURL: validateBasetenModelURL,
  performanceClient: validateConstructor,
  embeddingBaseURL: validateAbsoluteHttpURL,
  videoBaseURL: validateAbsoluteHttpURL,
  includeUsage: validateBoolean,
  pollIntervalMillis: validatePositiveSafeInteger,
  pollTimeoutMillis: validatePositiveSafeInteger,
  generateId: validateFunction,
  credentialProvider: validateFunction,
  version: validateString,
  webSocket: validateConstructor,
};

const EMPTY_PROVIDER_SETTING_KEYS: ReadonlySet<string> = new Set();
const PROVIDER_SETTING_KEYS: Partial<Record<AIProviderType, ReadonlySet<string>>> = {
  gateway: new Set(['teamIdOrSlug', 'metadataCacheRefreshMillis']),
  azure: new Set(['resourceName', 'tokenProvider', 'apiVersion', 'speechBaseURL', 'useDeploymentBasedUrls']),
  anthropic: new Set(['authToken', 'generateId']),
  'anthropic-aws': new Set([
    'workspaceId',
    'region',
    'accessKeyId',
    'secretAccessKey',
    'sessionToken',
    'credentialProvider',
    'generateId',
  ]),
  'amazon-bedrock': new Set([
    'region',
    'runtimeBaseURL',
    'agentRuntimeBaseURL',
    'accessKeyId',
    'secretAccessKey',
    'sessionToken',
    'credentialProvider',
    'generateId',
  ]),
  google: new Set(['generateId']),
  'google-vertex': new Set(['project', 'location', 'googleAuthOptions', 'generateId']),
  cohere: new Set(['generateId']),
  mistral: new Set(['generateId']),
  baseten: new Set(['modelURL', 'performanceClient']),
  huggingface: new Set(['generateId']),
  'open-responses': new Set(['strictResponseInput']),
  alibaba: new Set(['embeddingBaseURL', 'videoBaseURL', 'includeUsage']),
  minimax: new Set(['videoBaseURL']),
  klingai: new Set(['accessKey', 'secretKey']),
  cartesia: new Set(['version', 'webSocket']),
  'black-forest-labs': new Set(['pollIntervalMillis', 'pollTimeoutMillis']),
  'openai-compatible': new Set(['includeUsage']),
  'meta-llama': EMPTY_PROVIDER_SETTING_KEYS,
};
