import { describe, expect, test } from 'bun:test';

import { resolveAIConfig } from './ai-env';
import { AI_PROVIDER_FACTORIES } from './ai-provider-factory';
import {
  AI_DEFAULT_ALIAS_CANDIDATES,
  AI_PROVIDER_CATALOG,
  AI_PROVIDER_TYPES,
  type AIProviderCatalogEntry,
} from './ai-provider-catalog';
import {
  createAIRegistry,
  resolveFilesProvider,
  resolveEmbeddingModel,
  resolveImageModel,
  resolveLanguageModel,
  resolveRerankingModel,
  resolveSpeechModel,
  resolveTranscriptionModel,
  resolveVideoModel,
  type AIRegistry,
} from './ai-registry';
import type { AICapability, AIProviderConfig, ResolvedAIConfig } from './ai-types';

const CAPABILITY_KEYS = [
  'text',
  'streaming',
  'tools',
  'vision',
  'embeddings',
  'images',
  'transcription',
  'speech',
  'reranking',
  'video',
  'files',
  'fileMetadata',
  'fileDownload',
  'fileDelete',
  'skills',
  'realtime',
  'evaluation',
  'batch',
] as const satisfies readonly AICapability[];

const MODEL_MODALITIES = [
  'text',
  'embeddings',
  'images',
  'transcription',
  'speech',
  'reranking',
  'video',
] as const satisfies readonly AICapability[];

describe('AI provider catalog invariants', () => {
  test('uses unique built-in ids, adapter types, and factories', () => {
    const ids = AI_PROVIDER_CATALOG.map((entry) => entry.id);
    const catalogTypes = AI_PROVIDER_CATALOG.map((entry) => entry.type);
    const factoryTypes = Object.keys(AI_PROVIDER_FACTORIES).sort();

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(catalogTypes).size).toBe(catalogTypes.length);
    expect(Object.isFrozen(AI_PROVIDER_TYPES)).toBe(true);
    expect(Object.isFrozen(AI_PROVIDER_FACTORIES)).toBe(true);
    expect(factoryTypes).toEqual([...AI_PROVIDER_TYPES].sort());
    expect(new Set(Object.values(AI_PROVIDER_FACTORIES)).size).toBe(factoryTypes.length);
  });

  test('defines every capability as an explicit boolean', () => {
    expect(Object.isFrozen(AI_PROVIDER_CATALOG)).toBe(true);
    for (const entry of AI_PROVIDER_CATALOG) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.envKeys)).toBe(true);
      expect(Object.isFrozen(entry.capabilities)).toBe(true);
      expect(Object.keys(entry.capabilities).sort()).toEqual([...CAPABILITY_KEYS].sort());
      for (const capability of CAPABILITY_KEYS) {
        expect(typeof entry.capabilities[capability]).toBe('boolean');
      }
    }
  });

  test('advertises audited vision support and current built-in model aliases', () => {
    for (const providerId of ['groq', 'cohere', 'deepseek', 'perplexity']) {
      expect(AI_PROVIDER_CATALOG.find((entry) => entry.id === providerId)?.capabilities.vision)
        .toBe(true);
    }

    expect(AI_DEFAULT_ALIAS_CANDIDATES.fast).toContain('anthropic/claude-haiku-4-5');
    expect(AI_DEFAULT_ALIAS_CANDIDATES.smart).toContain('anthropic/claude-opus-4-5');
    expect(AI_DEFAULT_ALIAS_CANDIDATES.speech[0]).toBe('gateway/openai/tts-1');
  });
});

describe('AI provider catalog construction and model surfaces', () => {
  for (const entry of AI_PROVIDER_CATALOG) {
    test(`${entry.id} constructs and resolves each advertised Zero modality without network access`, () => {
      let networkRequested = false;
      const config = resolveCatalogProvider(entry, () => {
        networkRequested = true;
        throw new Error(`Provider ${entry.id} attempted network access while resolving a model.`);
      });
      const provider = config.providers[entry.id];

      expect(provider.active).toBe(true);
      expect(provider.reason).toBeNull();

      const registry = createAIRegistry(config);
      expect(registry.providerInstances[entry.id]).toBeDefined();

      for (const capability of MODEL_MODALITIES) {
        if (!provider.capabilities[capability]) continue;
        const resolved = resolveAdvertisedModel(registry, entry, capability);
        expect(resolved.provider.id).toBe(entry.id);
        expect(resolved.model).toBeDefined();
      }

      if (provider.capabilities.files) {
        const resolved = resolveFilesProvider(registry, entry.id, null);
        expect(resolved.provider.id).toBe(entry.id);
        expect(resolved.operations).toEqual({
          upload: true,
          metadata: Boolean(provider.capabilities.fileMetadata),
          download: Boolean(provider.capabilities.fileDownload),
          delete: Boolean(provider.capabilities.fileDelete),
        });
      }

      const instance = registry.providerInstances[entry.id] as unknown as Record<string, unknown>;
      for (const [capability, method] of [
        ['skills', 'skills'],
        ['realtime', 'experimental_realtime'],
        ['evaluation', 'evaluationModel'],
        ['batch', 'experimental_batch'],
      ] as const) {
        if (!provider.capabilities[capability]) continue;
        expect(typeof instance[method], `${entry.id} ${capability} surface`).toBe('function');
      }

      expect(networkRequested).toBe(false);
    });
  }

  for (const [providerId, modelId] of Object.entries({
    groq: 'meta-llama/llama-4-scout-17b-16e-instruct',
    cohere: 'command-a-vision-07-2025',
    deepseek: 'deepseek-v4-flash-vision-exp',
    perplexity: 'sonar',
  })) {
    test(`${providerId} accepts image input through its native prompt converter`, async () => {
      const entry = AI_PROVIDER_CATALOG.find((candidate) => candidate.id === providerId);
      if (!entry) throw new Error(`Missing catalog entry for ${providerId}.`);

      let networkRequested = false;
      const config = resolveCatalogProvider(entry, () => {
        networkRequested = true;
        throw new Error('expected request boundary');
      });
      const registry = createAIRegistry(config);
      const { model } = resolveLanguageModel(registry, {}, `${providerId}/${modelId}`);

      try {
        await (model as Exclude<typeof model, string>).doGenerate({
          prompt: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this image.' },
              {
                type: 'file',
                mediaType: 'image/png',
                data: { type: 'data', data: new Uint8Array([137, 80, 78, 71]) },
              },
            ],
          }],
        } as any);
      } catch {
        // The injected request boundary deliberately rejects after conversion.
      }

      expect(networkRequested).toBe(true);
    });
  }
});

function resolveCatalogProvider(
  entry: AIProviderCatalogEntry,
  onNetworkRequest: () => never
): ResolvedAIConfig {
  const provider = dummyProviderConfig(entry, onNetworkRequest);
  const resolved = resolveAIConfig({
    autoDetect: false,
    providers: { [entry.id]: provider },
  }, {});

  if (resolved === false) throw new Error(`Provider ${entry.id} unexpectedly disabled AI.`);
  return resolved;
}

function dummyProviderConfig(
  entry: AIProviderCatalogEntry,
  onNetworkRequest: () => never
): AIProviderConfig {
  const config: AIProviderConfig = {
    type: entry.type,
    apiKey: 'zero-test-key-never-send',
    fetch: (() => onNetworkRequest()) as unknown as typeof fetch,
  };

  switch (entry.type) {
    case 'amazon-bedrock':
      config.apiKey = undefined;
      config.settings = {
        region: 'us-east-1',
        accessKeyId: 'AKIAZEROFAKE00000000',
        secretAccessKey: 'zero-test-secret-never-send',
      };
      break;
    case 'anthropic-aws':
      config.settings = {
        region: 'us-east-1',
        workspaceId: 'wrkspc_zero_test',
      };
      break;
    case 'azure':
      config.settings = { resourceName: 'zero-test-resource' };
      break;
    case 'google-vertex':
      // Express mode deliberately avoids ambient ADC during a unit test.
      config.apiKey = 'zero-test-vertex-express-key';
      break;
    case 'open-responses':
      config.apiKey = undefined;
      config.baseURL = 'https://open-responses.example.test/v1';
      break;
    case 'baseten':
      // Baseten exposes embeddings only when a model URL is configured.
      config.settings = { modelURL: 'https://model.baseten.example.test/sync/v1' };
      break;
  }

  return config;
}

function resolveAdvertisedModel(
  registry: AIRegistry,
  entry: AIProviderCatalogEntry,
  capability: typeof MODEL_MODALITIES[number]
) {
  const reference = `${entry.id}/${modelIdFor(entry.id, capability)}`;

  switch (capability) {
    case 'text':
      return resolveLanguageModel(registry, {}, reference);
    case 'embeddings':
      return resolveEmbeddingModel(registry, {}, reference);
    case 'images':
      return resolveImageModel(registry, {}, reference);
    case 'transcription':
      return resolveTranscriptionModel(registry, {}, reference);
    case 'speech':
      return resolveSpeechModel(registry, {}, reference);
    case 'reranking':
      return resolveRerankingModel(registry, {}, reference);
    case 'video':
      return resolveVideoModel(registry, {}, reference);
  }
}

function modelIdFor(
  providerId: string,
  capability: typeof MODEL_MODALITIES[number]
): string {
  if (providerId === 'gateway') {
    switch (capability) {
      case 'text':
        return 'openai/gpt-4o-mini';
      case 'embeddings':
        return 'openai/text-embedding-3-small';
      case 'images':
        return 'openai/gpt-image-1';
      case 'transcription':
        return 'openai/gpt-4o-mini-transcribe';
      case 'speech':
        return 'openai/tts-1';
      case 'reranking':
        return 'cohere/rerank-v3.5';
      case 'video':
        return 'google/veo-3.1-fast-generate-001';
    }
  }
  if (providerId === 'revai') return 'machine';

  switch (capability) {
    case 'text':
      return 'zero-test-language-model';
    case 'embeddings':
      return 'zero-test-embedding-model';
    case 'images':
      return 'zero-test-image-model';
    case 'transcription':
      return 'zero-test-transcription-model';
    case 'speech':
      return 'zero-test-speech-model';
    case 'reranking':
      return 'zero-test-reranking-model';
    case 'video':
      return 'zero-test-video-model';
  }
}
