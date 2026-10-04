/**
 * ai-env-provider-endpoints.ts
 *
 * Owns provider base-URL environment precedence, validation, and Bedrock's
 * split runtime endpoint materialization. It does not decide authentication.
 */

import { AIError } from './ai-errors';
import type {
  AIProviderConfig,
  AIProviderInstanceSettings,
} from './ai-types';
import { resolveBedrockServiceBaseURLs } from './providers/bedrock-endpoint';

/** Return base-URL env keys from provider-specific to adapter-wide fallback. */
export function providerBaseURLEnvKeys(
  id: string,
  type: AIProviderConfig['type']
): string[] {
  const keys = [
    `${envKeyPrefix(id)}_BASE_URL`,
    `${envKeyPrefix(type)}_BASE_URL`,
  ];
  if (type === 'amazon-bedrock') keys.push('AWS_ENDPOINT_URL');
  return keys.filter(unique);
}

/** Suppress Bedrock endpoint env settings when a higher-priority URL won. */
export function bedrockEndpointEnvironmentExclusions(
  type: AIProviderConfig['type'],
  hasExplicitGenericEndpoint: boolean,
  genericEndpointEnvKey: string | null
): ReadonlySet<keyof AIProviderInstanceSettings> | undefined {
  if (type !== 'amazon-bedrock') return undefined;
  const zeroGenericEndpointSelected = Boolean(
    genericEndpointEnvKey && genericEndpointEnvKey !== 'AWS_ENDPOINT_URL'
  );
  return hasExplicitGenericEndpoint || zeroGenericEndpointSelected
    ? new Set(['runtimeBaseURL', 'agentRuntimeBaseURL'])
    : undefined;
}

/** Materialize Bedrock runtime endpoints while leaving other providers alone. */
export function materializeProviderEndpointSettings(
  type: AIProviderConfig['type'],
  genericBaseURL: string | undefined,
  settings: AIProviderInstanceSettings | undefined
): AIProviderInstanceSettings | undefined {
  if (type !== 'amazon-bedrock') return settings;
  const endpoints = resolveBedrockServiceBaseURLs({
    genericBaseURL,
    runtimeBaseURL: settings?.runtimeBaseURL,
    agentRuntimeBaseURL: settings?.agentRuntimeBaseURL,
    region: settings?.region,
  });
  const materialized: AIProviderInstanceSettings = { ...settings };
  if (endpoints.runtimeBaseURL) materialized.runtimeBaseURL = endpoints.runtimeBaseURL;
  if (endpoints.agentRuntimeBaseURL) {
    materialized.agentRuntimeBaseURL = endpoints.agentRuntimeBaseURL;
  }
  return Object.keys(materialized).length > 0 ? materialized : undefined;
}

/** Validate every resolved generic or service-specific provider URL. */
export function validateResolvedProviderBaseURLs(
  id: string,
  type: AIProviderConfig['type'],
  genericBaseURL: string | undefined,
  settings: AIProviderInstanceSettings | undefined
): void {
  validateProviderBaseURL(id, genericBaseURL);
  if (type !== 'amazon-bedrock') return;
  validateProviderBaseURL(id, settings?.runtimeBaseURL);
  validateProviderBaseURL(id, settings?.agentRuntimeBaseURL);
}

function validateProviderBaseURL(id: string, baseURL: string | undefined): void {
  if (!baseURL) return;
  try {
    const parsed = new URL(baseURL);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('unsupported protocol');
    }
  } catch {
    throw new AIError(
      `AI provider "${id}" baseURL must be an absolute HTTP(S) URL.`,
      'AI_PROVIDER_CONFIG_INVALID',
      500
    );
  }
}

function envKeyPrefix(idOrType: string): string {
  return idOrType.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
}

function unique(value: string, index: number, list: readonly string[]): boolean {
  return list.indexOf(value) === index;
}
