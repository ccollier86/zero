import { describe, expect, test } from 'bun:test';

import { AIError } from '../ai-errors';
import { createAIRegistry } from '../ai-registry';
import { resolveAIConfig } from '../ai-env';
import { createMetaLlama, metaLlama } from './meta-llama';

describe('retired Meta Llama provider', () => {
  test('keeps the legacy factory importable but never contacts the retired API', () => {
    let requested = false;
    const provider = createMetaLlama({
      apiKey: 'retired-key',
      fetch: async () => {
        requested = true;
        return Response.json({});
      },
    });

    expect(() => provider('Llama-Test')).toThrow(AIError);
    expect(requested).toBe(false);

    try {
      provider.languageModel('Llama-Test');
    } catch (error) {
      expect(error).toBeInstanceOf(AIError);
      expect((error as AIError).code).toBe('AI_PROVIDER_RETIRED');
      expect((error as AIError).status).toBe(410);
      expect((error as Error).message).toContain('Amazon Bedrock');
      expect((error as Error).message).toContain('Groq');
    }
  });

  test('keeps the legacy singleton import safe until model selection', () => {
    expect(() => metaLlama('Llama-Test')).toThrow(
      'The direct Meta-hosted Llama provider has been retired'
    );
  });

  test('rejects enabled legacy config during resolution with or without credentials', () => {
    for (const provider of [
      { type: 'meta-llama' as const },
      { type: 'meta-llama' as const, apiKey: 'retired-key' },
    ]) {
      try {
        resolveAIConfig({
          autoDetect: false,
          providers: { meta: provider },
        }, {});
        throw new Error('Expected retired Meta Llama config to fail.');
      } catch (error) {
        expect(error).toBeInstanceOf(AIError);
        expect((error as AIError).code).toBe('AI_PROVIDER_RETIRED');
        expect((error as AIError).status).toBe(410);
      }
    }
  });

  test('allows explicitly disabled legacy config to remain visible without construction', () => {
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        meta: { type: 'meta-llama', enabled: false },
      },
    }, {});

    expect(config).not.toBe(false);
    if (config === false) return;
    expect(config.providers.meta).toMatchObject({
      type: 'meta-llama',
      active: false,
      reason: 'config_disabled',
    });
    expect(() => createAIRegistry(config)).not.toThrow();
  });

  test('does not auto-detect retired Meta credentials', () => {
    const config = resolveAIConfig(true, {
      META_LLAMA_API_KEY: 'retired-key',
      LLAMA_API_KEY: 'retired-key',
    });

    expect(config).not.toBe(false);
    if (config === false) return;
    expect(config.providers.meta).toBeUndefined();
  });
});
