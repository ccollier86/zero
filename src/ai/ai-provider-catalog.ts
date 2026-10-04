/**
 * ai-provider-catalog.ts
 *
 * Static metadata for Zero's built-in AI provider adapters. Runtime config
 * resolution and provider construction intentionally live in separate files.
 */

import type {
  AICapability,
  AIProviderCapabilities,
  AIProviderType,
  ResolvedAIProviderCapabilities,
} from './ai-types';

/** Credential/configuration shape required before a provider can be activated. */
export type AIProviderActivationKind =
  | 'api-key'
  | 'anthropic'
  | 'anthropic-aws'
  | 'klingai'
  | 'gateway'
  | 'amazon-bedrock'
  | 'azure'
  | 'google-vertex'
  | 'base-url'
  | 'custom';

/** Environment bindings for provider-specific construction settings. */
export interface AIProviderSettingEnvKeys {
  runtimeBaseURL?: readonly string[];
  agentRuntimeBaseURL?: readonly string[];
  authToken?: readonly string[];
  workspaceId?: readonly string[];
  region?: readonly string[];
  accessKeyId?: readonly string[];
  secretAccessKey?: readonly string[];
  sessionToken?: readonly string[];
  accessKey?: readonly string[];
  secretKey?: readonly string[];
  resourceName?: readonly string[];
  project?: readonly string[];
  location?: readonly string[];
}

/** Static provider metadata used by env detection and status reporting. */
export interface AIProviderCatalogEntry {
  id: string;
  type: AIProviderType;
  displayName: string;
  envKeys: readonly string[];
  baseURL?: string;
  activation: AIProviderActivationKind;
  settingsEnvKeys?: AIProviderSettingEnvKeys;
  /** Older adapter types accepted for an established provider id. */
  compatibleTypes?: readonly AIProviderType[];
  capabilities: ResolvedAIProviderCapabilities;
}

const textCapabilities = capabilities({ text: true, streaming: true, tools: true });
const visionTextCapabilities = capabilities({ ...textCapabilities, vision: true });
const openAIModelCapabilities = capabilities({
  ...visionTextCapabilities,
  embeddings: true,
  images: true,
  transcription: true,
  speech: true,
});
const gatewayCapabilities = capabilities({
  ...openAIModelCapabilities,
  reranking: true,
  video: true,
  realtime: true,
  evaluation: true,
  batch: true,
});
const openAICapabilities = capabilities({
  ...openAIModelCapabilities,
  files: true,
  fileMetadata: true,
  fileDownload: true,
  fileDelete: true,
  skills: true,
  realtime: true,
  evaluation: true,
  batch: true,
});

/** Built-in providers available through env detection or explicit config. */
const providerCatalog: readonly AIProviderCatalogEntry[] = [
  entry('gateway', 'gateway', 'Vercel AI Gateway', ['AI_GATEWAY_API_KEY'], 'gateway', gatewayCapabilities),
  entry('openai', 'openai', 'OpenAI', ['OPENAI_API_KEY'], 'api-key', openAICapabilities),
  {
    ...entry('azure', 'azure', 'Azure OpenAI', ['AZURE_API_KEY'], 'azure', openAIModelCapabilities),
    settingsEnvKeys: { resourceName: ['AZURE_RESOURCE_NAME'] },
  },
  {
    ...entry(
      'anthropic',
      'anthropic',
      'Anthropic',
      ['ANTHROPIC_API_KEY'],
      'anthropic',
      capabilities({
        ...visionTextCapabilities,
        files: true,
        skills: true,
        evaluation: true,
        batch: true,
      })
    ),
    settingsEnvKeys: { authToken: ['ANTHROPIC_AUTH_TOKEN'] },
  },
  {
    ...entry(
      'anthropic-aws',
      'anthropic-aws',
      'Claude Platform on AWS',
      ['ANTHROPIC_AWS_API_KEY'],
      'anthropic-aws',
      capabilities({
        ...visionTextCapabilities,
        files: true,
        skills: true,
      })
    ),
    settingsEnvKeys: {
      workspaceId: ['ANTHROPIC_AWS_WORKSPACE_ID'],
      region: ['AWS_REGION'],
      accessKeyId: ['AWS_ACCESS_KEY_ID'],
      secretAccessKey: ['AWS_SECRET_ACCESS_KEY'],
      sessionToken: ['AWS_SESSION_TOKEN'],
    },
  },
  {
    ...entry(
      'bedrock',
      'amazon-bedrock',
      'Amazon Bedrock',
      ['AWS_BEARER_TOKEN_BEDROCK'],
      'amazon-bedrock',
      capabilities({
        ...visionTextCapabilities,
        embeddings: true,
        images: true,
        reranking: true,
      })
    ),
    settingsEnvKeys: {
      runtimeBaseURL: ['AWS_ENDPOINT_URL_BEDROCK_RUNTIME'],
      agentRuntimeBaseURL: ['AWS_ENDPOINT_URL_BEDROCK_AGENT_RUNTIME'],
      region: ['AWS_REGION', 'AWS_DEFAULT_REGION'],
      accessKeyId: ['AWS_ACCESS_KEY_ID'],
      secretAccessKey: ['AWS_SECRET_ACCESS_KEY'],
      sessionToken: ['AWS_SESSION_TOKEN'],
    },
  },
  entry(
    'google',
    'google',
    'Google Generative AI',
    ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
    'api-key',
    capabilities({
      ...visionTextCapabilities,
      embeddings: true,
      images: true,
      transcription: true,
      speech: true,
      video: true,
      files: true,
      realtime: true,
      evaluation: true,
      batch: true,
    })
  ),
  {
    ...entry(
      'google-vertex',
      'google-vertex',
      'Google Vertex AI',
      ['GOOGLE_VERTEX_API_KEY'],
      'google-vertex',
      capabilities({
        ...visionTextCapabilities,
        embeddings: true,
        images: true,
        transcription: true,
        speech: true,
        video: true,
      })
    ),
    settingsEnvKeys: {
      project: ['GOOGLE_VERTEX_PROJECT'],
      location: ['GOOGLE_VERTEX_LOCATION'],
    },
  },
  entry('groq', 'groq', 'Groq', ['GROQ_API_KEY'], 'api-key', capabilities({ ...visionTextCapabilities, transcription: true })),
  entry(
    'xai',
    'xai',
    'xAI',
    ['XAI_API_KEY'],
    'api-key',
    capabilities({
      ...visionTextCapabilities,
      images: true,
      transcription: true,
      speech: true,
      video: true,
      files: true,
      fileMetadata: true,
      fileDownload: true,
      fileDelete: true,
      realtime: true,
      batch: true,
    })
  ),
  entry(
    'cohere',
    'cohere',
    'Cohere',
    ['COHERE_API_KEY'],
    'api-key',
    capabilities({ ...visionTextCapabilities, embeddings: true, reranking: true })
  ),
  entry(
    'mistral',
    'mistral',
    'Mistral AI',
    ['MISTRAL_API_KEY'],
    'api-key',
    capabilities({
      ...visionTextCapabilities,
      embeddings: true,
      transcription: true,
      speech: true,
    })
  ),
  entry(
    'togetherai',
    'togetherai',
    'Together AI',
    ['TOGETHER_API_KEY', 'TOGETHER_AI_API_KEY'],
    'api-key',
    capabilities({
      ...visionTextCapabilities,
      embeddings: true,
      images: true,
      reranking: true,
    })
  ),
  entry(
    'deepinfra',
    'deepinfra',
    'DeepInfra',
    ['DEEPINFRA_API_KEY'],
    'api-key',
    capabilities({ ...visionTextCapabilities, embeddings: true, images: true })
  ),
  {
    ...entry(
      'deepseek',
      'deepseek',
      'DeepSeek',
      ['DEEPSEEK_API_KEY'],
      'api-key',
      capabilities({ ...visionTextCapabilities, files: true })
    ),
    compatibleTypes: ['openai-compatible'],
    baseURL: 'https://api.deepseek.com',
  },
  entry('cerebras', 'cerebras', 'Cerebras', ['CEREBRAS_API_KEY'], 'api-key', textCapabilities),
  {
    ...entry(
      'perplexity',
      'perplexity',
      'Perplexity',
      ['PERPLEXITY_API_KEY', 'PERPLEXITYAI_API_KEY'],
      'api-key',
      capabilities({ ...visionTextCapabilities, embeddings: true })
    ),
    compatibleTypes: ['openai-compatible'],
    baseURL: 'https://api.perplexity.ai',
  },
  entry(
    'fireworks',
    'fireworks',
    'Fireworks AI',
    ['FIREWORKS_API_KEY'],
    'api-key',
    capabilities({ ...visionTextCapabilities, embeddings: true, images: true })
  ),
  {
    ...entry(
      'voyage',
      'voyage',
      'Voyage AI',
      ['VOYAGE_API_KEY'],
      'api-key',
      capabilities({ embeddings: true, reranking: true })
    ),
    compatibleTypes: ['openai-compatible'],
    baseURL: 'https://api.voyageai.com/v1',
  },
  entry(
    'fal',
    'fal',
    'fal.ai',
    ['FAL_API_KEY', 'FAL_KEY'],
    'api-key',
    capabilities({ images: true, transcription: true, speech: true, video: true })
  ),
  entry('luma', 'luma', 'Luma AI', ['LUMA_API_KEY'], 'api-key', capabilities({ images: true })),
  entry('deepgram', 'deepgram', 'Deepgram', ['DEEPGRAM_API_KEY'], 'api-key', capabilities({ transcription: true, speech: true })),
  entry('elevenlabs', 'elevenlabs', 'ElevenLabs', ['ELEVENLABS_API_KEY'], 'api-key', capabilities({ transcription: true, speech: true })),
  entry('hume', 'hume', 'Hume', ['HUME_API_KEY'], 'api-key', capabilities({ speech: true })),
  entry('revai', 'revai', 'Rev.ai', ['REVAI_API_KEY'], 'api-key', capabilities({ transcription: true })),
  entry('assemblyai', 'assemblyai', 'AssemblyAI', ['ASSEMBLYAI_API_KEY'], 'api-key', capabilities({ transcription: true })),
  entry('gladia', 'gladia', 'Gladia', ['GLADIA_API_KEY'], 'api-key', capabilities({ transcription: true })),
  entry('fish-audio', 'fish-audio', 'Fish Audio', ['FISH_AUDIO_API_KEY'], 'api-key', capabilities({ transcription: true, speech: true })),
  entry(
    'replicate',
    'replicate',
    'Replicate',
    ['REPLICATE_API_TOKEN'],
    'api-key',
    capabilities({ images: true, video: true })
  ),
  entry(
    'prodia',
    'prodia',
    'Prodia',
    ['PRODIA_TOKEN'],
    'api-key',
    capabilities({
      text: true,
      streaming: true,
      vision: true,
      images: true,
      video: true,
    })
  ),
  entry(
    'black-forest-labs',
    'black-forest-labs',
    'Black Forest Labs',
    ['BFL_API_KEY'],
    'api-key',
    capabilities({ images: true, video: true })
  ),
  entry(
    'bytedance',
    'bytedance',
    'ByteDance',
    ['ARK_API_KEY'],
    'api-key',
    capabilities({ images: true, video: true })
  ),
  {
    ...entry(
      'klingai',
      'klingai',
      'Kling AI',
      ['KLINGAI_API_KEY'],
      'klingai',
      capabilities({ video: true })
    ),
    settingsEnvKeys: {
      accessKey: ['KLINGAI_ACCESS_KEY'],
      secretKey: ['KLINGAI_SECRET_KEY'],
    },
  },
  entry(
    'cartesia',
    'cartesia',
    'Cartesia',
    ['CARTESIA_API_KEY'],
    'api-key',
    capabilities({ transcription: true, speech: true, realtime: true })
  ),
  entry(
    'gmicloud',
    'gmicloud',
    'GMI Cloud',
    ['GMI_CLOUD_APIKEY'],
    'api-key',
    textCapabilities
  ),
  entry('quiverai', 'quiverai', 'QuiverAI', ['QUIVERAI_API_KEY'], 'api-key', capabilities({ images: true })),
  entry('baseten', 'baseten', 'Baseten', ['BASETEN_API_KEY'], 'api-key', capabilities({ ...textCapabilities, embeddings: true })),
  entry('huggingface', 'huggingface', 'Hugging Face', ['HUGGINGFACE_API_KEY'], 'api-key', visionTextCapabilities),
  entry('open-responses', 'open-responses', 'Open Responses', [], 'base-url', visionTextCapabilities),
  entry('moonshotai', 'moonshotai', 'Moonshot AI', ['MOONSHOT_API_KEY'], 'api-key', visionTextCapabilities),
  entry(
    'alibaba',
    'alibaba',
    'Alibaba',
    ['ALIBABA_API_KEY'],
    'api-key',
    capabilities({ ...visionTextCapabilities, embeddings: true, video: true })
  ),
  entry(
    'minimax',
    'minimax',
    'MiniMax',
    ['MINIMAX_API_KEY'],
    'api-key',
    capabilities({ ...textCapabilities, video: true })
  ),
  entry('zai', 'zai', 'Z.AI', ['ZAI_API_KEY'], 'api-key', visionTextCapabilities),
  entry(
    'topaz',
    'topaz',
    'Topaz Labs',
    ['TOPAZ_API_KEY'],
    'api-key',
    capabilities({ images: true })
  ),
] as const;

/** Frozen so application code cannot alter future provider resolution globally. */
export const AI_PROVIDER_CATALOG: readonly AIProviderCatalogEntry[] = Object.freeze(
  providerCatalog.map(freezeCatalogEntry)
);

/** Unique built-in provider adapter types exposed for validation. */
export const AI_PROVIDER_TYPES: readonly AIProviderType[] = Object.freeze([
  ...new Set(AI_PROVIDER_CATALOG.map((catalogEntry) => catalogEntry.type)),
  // Retained so explicit legacy config reaches the actionable retirement error.
  'meta-llama',
  'openai-compatible',
  'custom',
]);

/** Env variable names that override the built-in friendly model aliases. */
export const AI_DEFAULT_ALIAS_ENV_KEYS = {
  fast: 'ZERO_AI_FAST_MODEL',
  smart: 'ZERO_AI_SMART_MODEL',
  embedding: 'ZERO_AI_EMBEDDING_MODEL',
  image: 'ZERO_AI_IMAGE_MODEL',
  transcription: 'ZERO_AI_TRANSCRIPTION_MODEL',
  speech: 'ZERO_AI_SPEECH_MODEL',
  reranking: 'ZERO_AI_RERANKING_MODEL',
  video: 'ZERO_AI_VIDEO_MODEL',
} as const;

/** Ordered fallback model candidates used when matching active providers. */
export const AI_DEFAULT_ALIAS_CANDIDATES: Record<keyof typeof AI_DEFAULT_ALIAS_ENV_KEYS, readonly string[]> = {
  fast: [
    'gateway/openai/gpt-4o-mini',
    'groq/llama-3.3-70b-versatile',
    'openai/gpt-4o-mini',
    'google/gemini-2.5-flash',
    'anthropic/claude-haiku-4-5',
  ],
  smart: [
    'gateway/anthropic/claude-opus-4.5',
    'anthropic/claude-opus-4-5',
    'openai/gpt-4o',
    'google/gemini-2.5-pro',
    'groq/llama-3.3-70b-versatile',
  ],
  embedding: [
    'gateway/openai/text-embedding-3-small',
    'openai/text-embedding-3-small',
    'voyage/voyage-3',
    'google/gemini-embedding-001',
  ],
  image: ['gateway/openai/gpt-image-1', 'openai/gpt-image-1', 'google/imagen-4.0-generate-001'],
  transcription: [
    'gateway/openai/gpt-4o-mini-transcribe',
    'openai/gpt-4o-mini-transcribe',
    'deepgram/nova-3',
    'groq/whisper-large-v3-turbo',
  ],
  speech: [
    'gateway/openai/tts-1',
    'deepgram/aura-2-helena-en',
    'openai/gpt-4o-mini-tts',
    'openai/tts-1',
  ],
  reranking: [
    'gateway/cohere/rerank-v3.5',
    'cohere/rerank-v3.5',
    'voyage/rerank-2.5',
    'bedrock/amazon.rerank-v1:0',
    'togetherai/Salesforce/Llama-Rank-v1',
  ],
  video: [
    'gateway/google/veo-3.1-fast-generate-001',
    'google/veo-3.1-fast-generate-preview',
    'google-vertex/veo-3.1-fast-generate-001',
    'xai/grok-imagine-video',
    'minimax/MiniMax-H3',
  ],
};

/** Return the first catalog entry matching a provider id or type. */
export function findAIProviderCatalogEntry(idOrType: string): AIProviderCatalogEntry | undefined {
  return AI_PROVIDER_CATALOG.find((catalogEntry) => catalogEntry.id === idOrType || catalogEntry.type === idOrType);
}

/** Merge default and custom capabilities without dropping required flags. */
export function mergeCapabilities(
  base: ResolvedAIProviderCapabilities,
  overrides: Partial<AIProviderCapabilities> | undefined
): ResolvedAIProviderCapabilities {
  return capabilities({ ...base, ...overrides });
}

/** Return whether a provider status claims support for a capability. */
export function hasAICapability(capabilitySet: AIProviderCapabilities, capability: AICapability): boolean {
  return capabilitySet[capability] === true;
}

function entry(
  id: string,
  type: AIProviderType,
  displayName: string,
  envKeys: readonly string[],
  activation: AIProviderActivationKind,
  providerCapabilities: ResolvedAIProviderCapabilities
): AIProviderCatalogEntry {
  return { id, type, displayName, envKeys, activation, capabilities: providerCapabilities };
}

function capabilities(overrides: Partial<AIProviderCapabilities> = {}): ResolvedAIProviderCapabilities {
  return {
    text: overrides.text ?? false,
    streaming: overrides.streaming ?? false,
    tools: overrides.tools ?? false,
    vision: overrides.vision ?? false,
    embeddings: overrides.embeddings ?? false,
    images: overrides.images ?? false,
    transcription: overrides.transcription ?? false,
    speech: overrides.speech ?? false,
    reranking: overrides.reranking ?? false,
    video: overrides.video ?? false,
    files: overrides.files ?? false,
    fileMetadata: overrides.fileMetadata ?? false,
    fileDownload: overrides.fileDownload ?? false,
    fileDelete: overrides.fileDelete ?? false,
    skills: overrides.skills ?? false,
    realtime: overrides.realtime ?? false,
    evaluation: overrides.evaluation ?? false,
    batch: overrides.batch ?? false,
  };
}

function freezeCatalogEntry(catalogEntry: AIProviderCatalogEntry): AIProviderCatalogEntry {
  const settingsEnvKeys = catalogEntry.settingsEnvKeys
    ? Object.freeze(Object.fromEntries(
        Object.entries(catalogEntry.settingsEnvKeys).map(([setting, keys]) => [setting, Object.freeze([...keys])])
      ))
    : undefined;
  return Object.freeze({
    ...catalogEntry,
    envKeys: Object.freeze([...catalogEntry.envKeys]),
    compatibleTypes: catalogEntry.compatibleTypes
      ? Object.freeze([...catalogEntry.compatibleTypes])
      : undefined,
    settingsEnvKeys,
    capabilities: Object.freeze({ ...catalogEntry.capabilities }),
  });
}
