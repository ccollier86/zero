import { describe, expect, test } from 'bun:test';
import type { ProviderV4 } from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';

import { defineAIAgent } from './agents';
import { resolveAIConfig } from './ai-env';
import { AIService } from './ai-service';
import type { ResolvedAIConfig } from './ai-types';

describe('AIService managed agents', () => {
  test('rejects private prompt assets before network or provider work', async () => {
    const model = new MockLanguageModelV4();
    const adapter: ProviderV4 = {
      specificationVersion: 'v4',
      languageModel: () => model,
      embeddingModel: () => { throw new Error('not used'); },
      imageModel: () => { throw new Error('not used'); },
    };
    const config = requireAIConfig(resolveAIConfig({
      autoDetect: false,
      providers: {
        test: {
          type: 'custom',
          adapter,
          capabilities: { text: true, vision: true },
        },
      },
      aliases: { smart: 'test/model' },
    }, {}));
    const service = new AIService(config).createAgentService();
    service.register(defineAIAgent({
      name: 'managed-private-asset',
      version: '1',
      model: 'smart',
      tools: {},
    }));

    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error('Network transport must not run for a private prompt asset.');
    }) as unknown as typeof fetch;
    try {
      await expect(service.generate({ name: 'managed-private-asset', version: '1' }, {
        messages: [{
          role: 'user',
          content: [{
            type: 'file',
            data: new URL('http://127.0.0.1/private-image.png'),
            mediaType: 'image/png',
          }],
        }],
        runtimeContext: {},
        toolsContext: {},
        executionContext: undefined,
      })).rejects.toMatchObject({
        code: 'AI_REQUEST_INVALID',
        status: 400,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchCalls).toBe(0);
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});

function requireAIConfig(config: ResolvedAIConfig | false): ResolvedAIConfig {
  if (config === false) throw new Error('AI unexpectedly resolved as disabled.');
  return config;
}
