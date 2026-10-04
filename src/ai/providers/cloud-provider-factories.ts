/** Factories for cloud-hosted AI providers with non-trivial credentials. */

import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createAnthropicAws } from '@ai-sdk/anthropic-aws';
import { createAzure } from '@ai-sdk/azure';
import { createGateway } from '@ai-sdk/gateway';
import { createVertex } from '@ai-sdk/google-vertex';

import type { ResolvedAIProviderConfig } from '../ai-types';
import {
  defaultBedrockAgentRuntimeBaseURL,
  defaultBedrockRuntimeBaseURL,
} from './bedrock-endpoint';
import {
  commonProviderOptions,
  normalizeProviderAdapter,
  resolvedProviderBaseURL,
} from './provider-factory-types';
import { preserveBedrockInactiveToolHistory } from './bedrock-tool-history';

/** Create the Vercel AI Gateway adapter. */
export function createGatewayAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createGateway({
    ...resolvedCloudProviderOptions(provider),
    teamIdOrSlug: provider.settings?.teamIdOrSlug,
    metadataCacheRefreshMillis: provider.settings?.metadataCacheRefreshMillis,
  }));
}

/** Create Claude Platform on AWS with API-key or SigV4 authentication. */
export function createAnthropicAwsAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createAnthropicAws({
    ...resolvedCloudProviderOptions(provider),
    workspaceId: provider.settings?.workspaceId,
    region: provider.settings?.region,
    accessKeyId: provider.settings?.accessKeyId,
    secretAccessKey: provider.settings?.secretAccessKey,
    sessionToken: provider.settings?.sessionToken,
    credentialProvider: provider.settings?.credentialProvider,
    generateId: provider.settings?.generateId,
  }));
}

/** Create the Azure OpenAI adapter with API-key or Entra authentication. */
export function createAzureAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createAzure({
    ...resolvedCloudProviderOptions(provider),
    resourceName: provider.settings?.resourceName,
    tokenProvider: provider.settings?.tokenProvider,
    apiVersion: provider.settings?.apiVersion,
    speechBaseURL: provider.settings?.speechBaseURL,
    useDeploymentBasedUrls: provider.settings?.useDeploymentBasedUrls,
  }));
}

/** Create the Amazon Bedrock adapter with bearer, static, or dynamic credentials. */
export function createBedrockAdapter(provider: ResolvedAIProviderConfig) {
  const suppressedRuntimeBaseURL = provider.baseURLSuppressed && provider.settings?.region
    ? defaultBedrockRuntimeBaseURL(provider.settings.region)
    : undefined;
  const suppressedAgentRuntimeBaseURL = provider.baseURLSuppressed && provider.settings?.region
    ? defaultBedrockAgentRuntimeBaseURL(provider.settings.region)
    : undefined;
  const runtimeBaseURL = provider.settings?.runtimeBaseURL
    ?? resolvedProviderBaseURL(provider, suppressedRuntimeBaseURL);
  const agentRuntimeBaseURL = provider.settings?.agentRuntimeBaseURL
    ?? resolvedProviderBaseURL(provider, suppressedAgentRuntimeBaseURL);
  const commonOptions = {
    ...resolvedCloudProviderOptions(provider),
    region: provider.settings?.region,
    accessKeyId: provider.settings?.accessKeyId,
    secretAccessKey: provider.settings?.secretAccessKey,
    sessionToken: provider.settings?.sessionToken,
    credentialProvider: provider.settings?.credentialProvider,
    generateId: provider.settings?.generateId,
  };
  const runtimeProvider = createAmazonBedrock({
    ...commonOptions,
    baseURL: runtimeBaseURL,
  });

  if (agentRuntimeBaseURL && agentRuntimeBaseURL !== runtimeBaseURL) {
    const agentRuntimeProvider = createAmazonBedrock({
      ...commonOptions,
      baseURL: agentRuntimeBaseURL,
    });
    runtimeProvider.reranking = agentRuntimeProvider.reranking;
    runtimeProvider.rerankingModel = agentRuntimeProvider.rerankingModel;
  }

  return normalizeProviderAdapter(preserveBedrockInactiveToolHistory(runtimeProvider));
}

/** Create the Google Vertex adapter with express API-key or ADC configuration. */
export function createVertexAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createVertex({
    ...resolvedCloudProviderOptions(provider),
    project: provider.settings?.project,
    location: provider.settings?.location,
    googleAuthOptions: provider.settings?.googleAuthOptions,
    generateId: provider.settings?.generateId,
  }));
}

/** Keep Zero's resolved credential mode authoritative over ambient SDK env fallbacks. */
function resolvedCloudProviderOptions(provider: ResolvedAIProviderConfig) {
  return {
    ...commonProviderOptions(provider),
    // Official cloud adapters re-read their API-key env variable when this is
    // undefined. An empty value suppresses that fallback while still selecting
    // SigV4, ADC, Entra, or Gateway OIDC when Zero resolved one of those modes.
    apiKey: provider.apiKey ?? '',
  };
}
