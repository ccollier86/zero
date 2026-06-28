/**
 * ai-provider-catalog.ts
 *
 * Defines Zero's built-in AI provider catalog, env-key detection rules, and
 * default model alias candidates. This file owns static metadata only; it does
 * not read process env or instantiate provider SDK clients.
 */

import type { AICapability, AIProviderCapabilities, AIProviderType } from './ai-types';

/** Static provider metadata used by env detection and status reporting. */
export interface AIProviderCatalogEntry {
  id: string;
  type: AIProviderType;
  displayName: string;
  envKeys: readonly string[];
  baseURL?: string;
  requiresApiKey: boolean;
  capabilities: AIProviderCapabilities;
}

const textProviderCapabilities: AIProviderCapabilities = {
  text: true,
  streaming: true,
  tools: true,
  vision: false,
  embeddings: false,
  images: false,
  transcription: false,
  speech: false,
};

const openAICapabilities: AIProviderCapabilities = {
  text: true,
  streaming: true,
  tools: true,
  vision: true,
  embeddings: true,
  images: true,
  transcription: true,
  speech: true,
};

/** Built-in providers that can be auto-enabled by env keys. */
export const AI_PROVIDER_CATALOG: readonly AIProviderCatalogEntry[] = [
  {
    id: 'openai',
    type: 'openai',
    displayName: 'OpenAI',
    envKeys: ['OPENAI_API_KEY'],
    requiresApiKey: true,
    capabilities: openAICapabilities,
  },
  {
    id: 'anthropic',
    type: 'anthropic',
    displayName: 'Anthropic',
    envKeys: ['ANTHROPIC_API_KEY'],
    requiresApiKey: true,
    capabilities: { ...textProviderCapabilities, vision: true },
  },
  {
    id: 'google',
    type: 'google',
    displayName: 'Google Generative AI',
    envKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    requiresApiKey: true,
    capabilities: { ...textProviderCapabilities, vision: true },
  },
  {
    id: 'groq',
    type: 'groq',
    displayName: 'Groq',
    envKeys: ['GROQ_API_KEY'],
    requiresApiKey: true,
    capabilities: textProviderCapabilities,
  },
  {
    id: 'xai',
    type: 'xai',
    displayName: 'xAI',
    envKeys: ['XAI_API_KEY'],
    requiresApiKey: true,
    capabilities: { ...textProviderCapabilities, vision: true },
  },
  {
    id: 'cohere',
    type: 'cohere',
    displayName: 'Cohere',
    envKeys: ['COHERE_API_KEY'],
    requiresApiKey: true,
    capabilities: textProviderCapabilities,
  },
  {
    id: 'meta',
    type: 'meta-llama',
    displayName: 'Meta Llama',
    envKeys: ['LLAMA_API_KEY', 'META_LLAMA_API_KEY'],
    baseURL: 'https://api.llama.com/v1',
    requiresApiKey: true,
    capabilities: { ...textProviderCapabilities, vision: true },
  },
  {
    id: 'deepseek',
    type: 'openai-compatible',
    displayName: 'DeepSeek',
    envKeys: ['DEEPSEEK_API_KEY'],
    baseURL: 'https://api.deepseek.com',
    requiresApiKey: true,
    capabilities: textProviderCapabilities,
  },
  {
    id: 'perplexity',
    type: 'openai-compatible',
    displayName: 'Perplexity',
    envKeys: ['PERPLEXITY_API_KEY', 'PERPLEXITYAI_API_KEY'],
    baseURL: 'https://api.perplexity.ai',
    requiresApiKey: true,
    capabilities: textProviderCapabilities,
  },
  {
    id: 'voyage',
    type: 'openai-compatible',
    displayName: 'Voyage',
    envKeys: ['VOYAGE_API_KEY'],
    baseURL: 'https://api.voyageai.com/v1',
    requiresApiKey: true,
    capabilities: { ...textProviderCapabilities, embeddings: true },
  },
  {
    id: 'deepgram',
    type: 'deepgram',
    displayName: 'Deepgram',
    envKeys: ['DEEPGRAM_API_KEY'],
    requiresApiKey: true,
    capabilities: {
      text: false,
      streaming: false,
      tools: false,
      vision: false,
      embeddings: false,
      images: false,
      transcription: true,
      speech: true,
    },
  },
];

/** Built-in provider adapter types exposed for validation and documentation. */
export const AI_PROVIDER_TYPES = AI_PROVIDER_CATALOG.map((entry) => entry.type);

/** Env variable names that override the built-in friendly model aliases. */
export const AI_DEFAULT_ALIAS_ENV_KEYS = {
  fast: 'ZERO_AI_FAST_MODEL',
  smart: 'ZERO_AI_SMART_MODEL',
  embedding: 'ZERO_AI_EMBEDDING_MODEL',
  image: 'ZERO_AI_IMAGE_MODEL',
  transcription: 'ZERO_AI_TRANSCRIPTION_MODEL',
  speech: 'ZERO_AI_SPEECH_MODEL',
} as const;

/** Ordered fallback model candidates used when matching active providers. */
export const AI_DEFAULT_ALIAS_CANDIDATES: Record<keyof typeof AI_DEFAULT_ALIAS_ENV_KEYS, readonly string[]> = {
  fast: [
    'groq/llama-3.3-70b-versatile',
    'meta/Llama-4-Scout-17B-16E-Instruct-FP8',
    'openai/gpt-4o-mini',
    'google/gemini-2.5-flash',
    'anthropic/claude-3-5-haiku-latest',
  ],
  smart: [
    'anthropic/claude-opus-4.5',
    'meta/Llama-4-Maverick-17B-128E-Instruct-FP8',
    'openai/gpt-4o',
    'google/gemini-2.5-pro',
    'groq/llama-3.3-70b-versatile',
  ],
  embedding: [
    'openai/text-embedding-3-small',
    'voyage/voyage-3',
  ],
  image: [
    'openai/gpt-image-1',
  ],
  transcription: [
    'openai/gpt-4o-mini-transcribe',
    'deepgram/nova-3',
  ],
  speech: [
    'deepgram/aura-2-helena-en',
    'openai/gpt-4o-mini-tts',
    'openai/tts-1',
  ],
};

/** Return the first catalog entry matching a provider id or type. */
export function findAIProviderCatalogEntry(idOrType: string): AIProviderCatalogEntry | undefined {
  return AI_PROVIDER_CATALOG.find((entry) => entry.id === idOrType || entry.type === idOrType);
}

/** Merge default and custom capabilities without dropping required flags. */
export function mergeCapabilities(
  base: AIProviderCapabilities,
  overrides: Partial<AIProviderCapabilities> | undefined
): AIProviderCapabilities {
  return {
    text: overrides?.text ?? base.text,
    streaming: overrides?.streaming ?? base.streaming,
    tools: overrides?.tools ?? base.tools,
    vision: overrides?.vision ?? base.vision,
    embeddings: overrides?.embeddings ?? base.embeddings,
    images: overrides?.images ?? base.images,
    transcription: overrides?.transcription ?? base.transcription,
    speech: overrides?.speech ?? base.speech,
  };
}

/** Return whether a provider status claims support for a capability. */
export function hasAICapability(capabilities: AIProviderCapabilities, capability: AICapability): boolean {
  return capabilities[capability];
}
