/** Factories for native language, embedding, and multi-modal API providers. */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createCerebras } from '@ai-sdk/cerebras';
import { createCohere } from '@ai-sdk/cohere';
import { createDeepInfra } from '@ai-sdk/deepinfra';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createFireworks } from '@ai-sdk/fireworks';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGmicloud } from '@ai-sdk/gmicloud';
import { createGroq } from '@ai-sdk/groq';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { createPerplexity } from '@ai-sdk/perplexity';
import { createTogetherAI } from '@ai-sdk/togetherai';
import { createVoyage } from '@ai-sdk/voyage';
import { createXai } from '@ai-sdk/xai';

import type { ResolvedAIProviderConfig } from '../ai-types';
import { commonProviderOptions, normalizeProviderAdapter } from './provider-factory-types';

const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';

export function createOpenAIAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createOpenAI(
    commonProviderOptions(provider, OPENAI_DEFAULT_BASE_URL)
  ));
}

export function createAnthropicAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createAnthropic({
    ...commonProviderOptions(provider, ANTHROPIC_DEFAULT_BASE_URL),
    authToken: provider.settings?.authToken,
    generateId: provider.settings?.generateId,
  }));
}

export function createGoogleAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createGoogleGenerativeAI({
    ...commonProviderOptions(provider),
    generateId: provider.settings?.generateId,
  }));
}

export function createGroqAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createGroq(commonProviderOptions(provider)));
}

export function createGmiCloudAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createGmicloud(commonProviderOptions(provider)));
}

export function createXaiAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createXai(commonProviderOptions(provider)));
}

export function createCohereAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createCohere({
    ...commonProviderOptions(provider),
    generateId: provider.settings?.generateId,
  }));
}

export function createMistralAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createMistral({
    ...commonProviderOptions(provider),
    generateId: provider.settings?.generateId,
  }));
}

export function createTogetherAIAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createTogetherAI(commonProviderOptions(provider)));
}

export function createDeepInfraAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createDeepInfra(commonProviderOptions(provider)));
}

export function createDeepSeekAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createDeepSeek(commonProviderOptions(provider)));
}

export function createCerebrasAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createCerebras(commonProviderOptions(provider)));
}

export function createPerplexityAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createPerplexity(commonProviderOptions(provider)));
}

export function createFireworksAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createFireworks(commonProviderOptions(provider)));
}

export function createVoyageAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createVoyage(commonProviderOptions(provider)));
}
