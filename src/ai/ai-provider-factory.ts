/** Exhaustive, secret-safe construction boundary for Zero AI providers. */

import { AIError } from './ai-errors';
import { emitAIProviderInitializationFailed, type AIEmitCode } from './ai-observability';
import type { AIProviderAdapter, AIProviderType, ResolvedAIProviderConfig } from './ai-types';
import {
  createAzureAdapter,
  createAnthropicAwsAdapter,
  createBedrockAdapter,
  createGatewayAdapter,
  createVertexAdapter,
} from './providers/cloud-provider-factories';
import {
  createAlibabaAdapter,
  createBasetenAdapter,
  createHuggingFaceAdapter,
  createMetaLlamaAdapter,
  createMiniMaxAdapter,
  createMoonshotAIAdapter,
  createOpenAICompatibleAdapter,
  createOpenResponsesAdapter,
  createZaiAdapter,
} from './providers/extended-provider-factories';
import {
  createAnthropicAdapter,
  createCerebrasAdapter,
  createCohereAdapter,
  createDeepInfraAdapter,
  createDeepSeekAdapter,
  createFireworksAdapter,
  createGoogleAdapter,
  createGmiCloudAdapter,
  createGroqAdapter,
  createMistralAdapter,
  createOpenAIAdapter,
  createPerplexityAdapter,
  createTogetherAIAdapter,
  createVoyageAdapter,
  createXaiAdapter,
} from './providers/language-provider-factories';
import {
  createAssemblyAIAdapter,
  createBlackForestLabsAdapter,
  createByteDanceAdapter,
  createDeepgramAdapter,
  createElevenLabsAdapter,
  createFalAdapter,
  createFishAudioAdapter,
  createGladiaAdapter,
  createHumeAdapter,
  createLumaAdapter,
  createKlingAIAdapter,
  createCartesiaAdapter,
  createProdiaAdapter,
  createQuiverAIAdapter,
  createReplicateAdapter,
  createRevaiAdapter,
  createTopazAdapter,
} from './providers/media-provider-factories';
import { normalizeProviderAdapter, type AIProviderFactory } from './providers/provider-factory-types';

/** Exhaustive factory table; adding a provider type without a factory is a type error. */
export const AI_PROVIDER_FACTORIES: Readonly<Record<AIProviderType, AIProviderFactory>> = Object.freeze({
  gateway: createGatewayAdapter,
  openai: createOpenAIAdapter,
  azure: createAzureAdapter,
  anthropic: createAnthropicAdapter,
  'anthropic-aws': createAnthropicAwsAdapter,
  'amazon-bedrock': createBedrockAdapter,
  google: createGoogleAdapter,
  'google-vertex': createVertexAdapter,
  groq: createGroqAdapter,
  gmicloud: createGmiCloudAdapter,
  xai: createXaiAdapter,
  cohere: createCohereAdapter,
  mistral: createMistralAdapter,
  togetherai: createTogetherAIAdapter,
  deepinfra: createDeepInfraAdapter,
  deepseek: createDeepSeekAdapter,
  cerebras: createCerebrasAdapter,
  perplexity: createPerplexityAdapter,
  fireworks: createFireworksAdapter,
  voyage: createVoyageAdapter,
  fal: createFalAdapter,
  luma: createLumaAdapter,
  prodia: createProdiaAdapter,
  deepgram: createDeepgramAdapter,
  elevenlabs: createElevenLabsAdapter,
  hume: createHumeAdapter,
  revai: createRevaiAdapter,
  assemblyai: createAssemblyAIAdapter,
  gladia: createGladiaAdapter,
  'fish-audio': createFishAudioAdapter,
  replicate: createReplicateAdapter,
  'black-forest-labs': createBlackForestLabsAdapter,
  bytedance: createByteDanceAdapter,
  klingai: createKlingAIAdapter,
  cartesia: createCartesiaAdapter,
  quiverai: createQuiverAIAdapter,
  baseten: createBasetenAdapter,
  huggingface: createHuggingFaceAdapter,
  'open-responses': createOpenResponsesAdapter,
  moonshotai: createMoonshotAIAdapter,
  alibaba: createAlibabaAdapter,
  minimax: createMiniMaxAdapter,
  zai: createZaiAdapter,
  topaz: createTopazAdapter,
  'openai-compatible': createOpenAICompatibleAdapter,
  'meta-llama': createMetaLlamaAdapter,
  custom: createCustomProviderAdapter,
});

/** Construct one active provider or fail startup with a stable Zero error. */
export function createAIProviderInstance(
  provider: ResolvedAIProviderConfig,
  emitCode?: AIEmitCode,
): AIProviderAdapter {
  try {
    return normalizeProviderAdapter(AI_PROVIDER_FACTORIES[provider.type](provider));
  } catch (error) {
    emitAIProviderInitializationFailed({
      providerId: provider.id,
      providerType: provider.type,
      error,
    }, emitCode);
    if (error instanceof AIError) throw error;
    throw new AIError(
      `AI provider "${provider.id}" could not be initialized.`,
      'AI_PROVIDER_INITIALIZATION_FAILED',
      500
    );
  }
}

function createCustomProviderAdapter(provider: ResolvedAIProviderConfig): AIProviderAdapter {
  if (!provider.adapter) {
    throw new AIError(
      `AI provider "${provider.id}" is missing its custom adapter.`,
      'AI_PROVIDER_CONFIG_INVALID',
      500
    );
  }
  if (typeof provider.adapter !== 'function') return provider.adapter;

  return provider.adapter({
    id: provider.id,
    apiKey: provider.apiKey ?? undefined,
    baseURL: provider.baseURL ?? undefined,
    headers: provider.headers,
    fetch: provider.fetch,
    settings: provider.settings,
    capabilities: provider.capabilities,
  });
}
