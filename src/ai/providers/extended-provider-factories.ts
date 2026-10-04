/** Factories for additional official and compatibility language providers. */

import { createAlibaba } from '@ai-sdk/alibaba';
import { createBaseten } from '@ai-sdk/baseten';
import { createHuggingFace } from '@ai-sdk/huggingface';
import { createMiniMax } from '@ai-sdk/minimax';
import { createMoonshotAI } from '@ai-sdk/moonshotai';
import { createOpenResponses } from '@ai-sdk/open-responses';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createZai } from '@ai-sdk/zai';

import { createMetaLlamaRetiredError } from '../adapters/meta-llama';
import { AIError } from '../ai-errors';
import type { ResolvedAIProviderConfig } from '../ai-types';
import {
  commonProviderOptions,
  asAISDKFetch,
  normalizeProviderAdapter,
} from './provider-factory-types';

export function createBasetenAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createBaseten({
    ...commonProviderOptions(provider),
    modelURL: provider.settings?.modelURL,
    performanceClient: provider.settings?.performanceClient,
  }));
}

export function createHuggingFaceAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createHuggingFace({
    ...commonProviderOptions(provider),
    generateId: provider.settings?.generateId,
  }));
}

export function createOpenResponsesAdapter(provider: ResolvedAIProviderConfig) {
  if (!provider.baseURL) throw missingBaseURL(provider);
  return normalizeProviderAdapter(createOpenResponses({
    url: provider.baseURL,
    name: provider.id,
    apiKey: provider.apiKey ?? undefined,
    headers: provider.headers,
    fetch: asAISDKFetch(provider.fetch),
    strictResponseInput: provider.settings?.strictResponseInput,
  }));
}

export function createMoonshotAIAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createMoonshotAI(commonProviderOptions(provider)));
}

export function createAlibabaAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createAlibaba({
    ...commonProviderOptions(provider),
    embeddingBaseURL: provider.settings?.embeddingBaseURL,
    videoBaseURL: provider.settings?.videoBaseURL,
    includeUsage: provider.settings?.includeUsage,
  }));
}

export function createMiniMaxAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createMiniMax({
    ...commonProviderOptions(provider),
    videoBaseURL: provider.settings?.videoBaseURL,
  }));
}

export function createZaiAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createZai(commonProviderOptions(provider)));
}

export function createOpenAICompatibleAdapter(provider: ResolvedAIProviderConfig) {
  if (!provider.baseURL) throw missingBaseURL(provider);
  return normalizeProviderAdapter(createOpenAICompatible({
    name: provider.id,
    apiKey: provider.apiKey ?? undefined,
    baseURL: provider.baseURL,
    headers: provider.headers,
    fetch: asAISDKFetch(provider.fetch),
    includeUsage: provider.settings?.includeUsage,
  }));
}

export function createMetaLlamaAdapter(provider: ResolvedAIProviderConfig) {
  void provider;
  throw createMetaLlamaRetiredError();
}

function missingBaseURL(provider: ResolvedAIProviderConfig): AIError {
  return new AIError(
    `AI provider "${provider.id}" requires a base URL.`,
    'AI_PROVIDER_CONFIG_INVALID',
    500
  );
}
