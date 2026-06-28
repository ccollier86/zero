import { describe, expect, test } from 'bun:test';

import { OBS_CODES, MemoryEventStore, configureObservability } from '../observability';
import { resolveAIConfig } from './ai-env';
import { AIService } from './ai-service';
import { aiTool, defineAITools } from './ai-toolkit';

describe('resolveAIConfig', () => {
  test('auto-detects providers from env keys and chooses active aliases', () => {
    const config = resolveAIConfig(true, {
      OPENAI_API_KEY: 'openai-key',
      META_LLAMA_API_KEY: 'meta-key',
    });

    expect(config).not.toBe(false);
    if (config === false) return;

    expect(config.providers.openai.active).toBe(true);
    expect(config.providers.openai.configuredBy).toEqual(['OPENAI_API_KEY']);
    expect(config.providers.meta.active).toBe(true);
    expect(config.providers.meta.type).toBe('meta-llama');
    expect(config.providers.meta.configuredBy).toEqual(['META_LLAMA_API_KEY']);
    expect(config.providers.anthropic.active).toBe(false);
    expect(config.aliases.fast).toBe('meta/Llama-4-Scout-17B-16E-Instruct-FP8');
    expect(config.aliases.smart).toBe('meta/Llama-4-Maverick-17B-128E-Instruct-FP8');
    expect(config.aliases.embedding).toBe('openai/text-embedding-3-small');
    expect(config.aliases.speech).toBe('openai/gpt-4o-mini-tts');
  });

  test('uses Deepgram as the default speech alias when Deepgram is active', () => {
    const config = resolveAIConfig(true, {
      DEEPGRAM_API_KEY: 'deepgram-key',
    });

    expect(config).not.toBe(false);
    if (config === false) return;

    expect(config.providers.deepgram.active).toBe(true);
    expect(config.providers.deepgram.capabilities.speech).toBe(true);
    expect(config.aliases.speech).toBe('deepgram/aura-2-helena-en');
  });

  test('explicit provider config wins over env auto-detection', () => {
    const config = resolveAIConfig({
      providers: {
        meta: {
          type: 'meta-llama',
          apiKey: 'explicit-key',
          baseURL: 'https://llama.test/v1',
        },
      },
      aliases: {
        smart: 'meta/custom-model',
      },
    }, {
      META_LLAMA_API_KEY: 'env-key',
    });

    expect(config).not.toBe(false);
    if (config === false) return;

    expect(config.providers.meta.source).toBe('config');
    expect(config.providers.meta.apiKey).toBe('explicit-key');
    expect(config.providers.meta.baseURL).toBe('https://llama.test/v1');
    expect(config.aliases.smart).toBe('meta/custom-model');
  });

  test('explicit catalog providers inherit env secrets when omitted', () => {
    const config = resolveAIConfig({
      providers: {
        openai: {
          type: 'openai',
        },
      },
    }, {
      OPENAI_API_KEY: 'env-openai-key',
      OPENAI_BASE_URL: 'https://openai-proxy.test/v1',
    });

    expect(config).not.toBe(false);
    if (config === false) return;

    expect(config.providers.openai.source).toBe('config');
    expect(config.providers.openai.active).toBe(true);
    expect(config.providers.openai.apiKey).toBe('env-openai-key');
    expect(config.providers.openai.baseURL).toBe('https://openai-proxy.test/v1');
    expect(config.providers.openai.configuredBy).toEqual(['OPENAI_API_KEY', 'OPENAI_BASE_URL']);
  });

  test('custom providers require an AI SDK adapter before they become active', () => {
    const adapter = {
      specificationVersion: 'v3',
      languageModel() {
        throw new Error('not used');
      },
      embeddingModel() {
        throw new Error('not used');
      },
      imageModel() {
        throw new Error('not used');
      },
    } as any;
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        missing: {
          type: 'custom',
          apiKey: 'does-not-matter',
        },
        ready: {
          type: 'custom',
          adapter,
        },
      },
    }, {});

    expect(config).not.toBe(false);
    if (config === false) return;

    expect(config.providers.missing.active).toBe(false);
    expect(config.providers.missing.reason).toBe('missing_custom_provider_adapter');
    expect(config.providers.ready.active).toBe(true);
    expect(config.providers.ready.reason).toBeNull();
  });

  test('requires explicit base URLs for custom openai-compatible providers', () => {
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        local: {
          type: 'openai-compatible',
          apiKey: 'local-key',
        },
        deepseek: {
          type: 'openai-compatible',
          apiKey: 'deepseek-key',
        },
      },
    }, {});

    expect(config).not.toBe(false);
    if (config === false) return;

    expect(config.providers.local.active).toBe(false);
    expect(config.providers.local.baseURL).toBeUndefined();
    expect(config.providers.local.reason).toBe('missing_required_settings');
    expect(config.providers.deepseek.active).toBe(true);
    expect(config.providers.deepseek.baseURL).toBe('https://api.deepseek.com');
  });
});

describe('AIService.status', () => {
  test('reports active providers and alias health without secrets', () => {
    const config = resolveAIConfig(true, {
      OPENAI_API_KEY: 'openai-key',
      ZERO_AI_SMART_MODEL: 'openai/gpt-4o',
    });
    expect(config).not.toBe(false);
    if (config === false) return;

    const status = new AIService(config).status();

    const openai = status.providers.find((provider) => provider.id === 'openai');
    expect(openai?.active).toBe(true);
    expect(openai).not.toHaveProperty('apiKey');
    expect(status.aliases.smart).toEqual({
      model: 'openai/gpt-4o',
      active: true,
      reason: null,
    });
  });

  test('checks alias health against the alias capability', () => {
    const config = resolveAIConfig(true, {
      DEEPGRAM_API_KEY: 'deepgram-key',
    });
    expect(config).not.toBe(false);
    if (config === false) return;

    const status = new AIService(config).status();

    expect(status.aliases.speech).toEqual({
      model: 'deepgram/aura-2-helena-en',
      active: true,
      reason: null,
    });
  });
});

describe('AIService request capability checks', () => {
  test('rejects tools before provider calls when the selected provider does not support tools', async () => {
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        local: {
          type: 'openai-compatible',
          apiKey: 'local-key',
          baseURL: 'http://localhost:11434/v1',
          capabilities: { tools: false },
        },
      },
      aliases: {
        smart: 'local/test-model',
      },
    }, {});
    expect(config).not.toBe(false);
    if (config === false) return;

    const tools = defineAITools({
      lookup: aiTool({
        execute: () => ({ ok: true }),
      }),
    });

    await expect(new AIService(config).generateText({
      model: 'smart',
      prompt: 'Use a tool.',
      tools,
    })).rejects.toMatchObject({
      code: 'AI_CAPABILITY_NOT_SUPPORTED',
      message: 'AI provider "local" does not support tools.',
    });
  });

  test('rejects image messages before provider calls when the selected provider does not support vision', async () => {
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        local: {
          type: 'openai-compatible',
          apiKey: 'local-key',
          baseURL: 'http://localhost:11434/v1',
          capabilities: { vision: false },
        },
      },
      aliases: {
        smart: 'local/test-model',
      },
    }, {});
    expect(config).not.toBe(false);
    if (config === false) return;

    await expect(new AIService(config).generateConversation({
      model: 'smart',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this.' },
            { type: 'image', url: 'https://example.test/image.png' },
          ],
        },
      ],
    })).rejects.toMatchObject({
      code: 'AI_CAPABILITY_NOT_SUPPORTED',
      message: 'AI provider "local" does not support vision inputs.',
    });
  });

  test('rejects speech generation before provider calls when the selected provider does not support speech', async () => {
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        local: {
          type: 'openai-compatible',
          apiKey: 'local-key',
          baseURL: 'http://localhost:11434/v1',
          capabilities: { speech: false },
        },
      },
      aliases: {
        speech: 'local/test-speech-model',
      },
    }, {});
    expect(config).not.toBe(false);
    if (config === false) return;

    await expect(new AIService(config).generateSpeech({
      model: 'speech',
      text: 'Hello.',
    })).rejects.toMatchObject({
      code: 'AI_CAPABILITY_NOT_SUPPORTED',
      message: 'AI provider "local" does not support speech.',
    });
  });

  test('routes Deepgram speech through the configured base URL override', async () => {
    const config = resolveAIConfig(true, {
      DEEPGRAM_API_KEY: 'deepgram-key',
      DEEPGRAM_BASE_URL: 'https://deepgram-proxy.test/api',
    });
    expect(config).not.toBe(false);
    if (config === false) return;

    const originalFetch = globalThis.fetch;
    let requestedUrl: string | null = null;
    globalThis.fetch = (async (input) => {
      requestedUrl = input instanceof Request ? input.url : input.toString();
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-type': 'audio/mpeg' },
      });
    }) as typeof fetch;

    try {
      await new AIService(config).generateSpeech({
        model: 'speech',
        text: 'Hello.',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    const url = requestedUrl ?? '';
    expect(url).toStartWith('https://deepgram-proxy.test/api/v1/speak?');
    expect(url).toContain('model=aura-2-helena-en');
  });

  test('emits observability when model aliases cannot be resolved before a provider call', async () => {
    const store = new MemoryEventStore();
    configureObservability({ console: false, store });
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        openai: {
          type: 'openai',
          apiKey: 'openai-key',
        },
      },
    }, {});
    expect(config).not.toBe(false);
    if (config === false) return;

    try {
      await expect(new AIService(config).generateText({
        model: 'missingAlias',
        prompt: 'Hello.',
      })).rejects.toMatchObject({
        code: 'AI_MODEL_NOT_CONFIGURED',
      });

      const events = store.query({ code: OBS_CODES.AI_MODEL_ALIAS_UNRESOLVED.code }).events;
      expect(events).toHaveLength(1);
      expect(events[0].metadata).toMatchObject({
        requestedModel: 'missingAlias',
        capability: 'text',
        reason: 'AI_MODEL_NOT_CONFIGURED',
      });
    } finally {
      configureObservability({ console: false });
    }
  });
});
