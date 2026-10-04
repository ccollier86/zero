import { describe, expect, test } from 'bun:test';
import type { ProviderV4 } from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';
import {
  createAIModelExecutionPreparer as createPublicAIModelExecutionPreparer,
  type AIPrepareModelExecution,
} from '@zero/framework/ai';

import { resolveAIConfig } from './ai-env';
import { createAIModelExecutionPreparer } from './ai-model-execution';
import type { AIEmitCode } from './ai-observability';
import { createAIRegistry, resolveLanguageModel } from './ai-registry';
import type { AIProviderCapabilities, ResolvedAIConfig } from './ai-types';

describe('AI model execution preparation', () => {
  test('is exported through the public AI package boundary', () => {
    const publicFactory: typeof createAIModelExecutionPreparer =
      createPublicAIModelExecutionPreparer;
    const prepare: AIPrepareModelExecution = async () => {
      throw new Error('compile-only public contract');
    };

    expect(publicFactory).toBe(createAIModelExecutionPreparer);
    expect(typeof prepare).toBe('function');
  });

  test('denies tools before provider work when the selected provider lacks tools', async () => {
    const { model, prepare } = createPreparer({ tools: false });

    await expect(prepare({
      reference: 'smart',
      messages: [{ role: 'user', content: 'private tool prompt' }],
      toolNames: ['lookup'],
    })).rejects.toMatchObject({
      code: 'AI_CAPABILITY_NOT_SUPPORTED',
      status: 400,
    });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  test('denies normalized vision input when the provider lacks vision', async () => {
    const { model, prepare } = createPreparer({ vision: false });

    await expect(prepare({
      reference: 'smart',
      messages: [{
        role: 'user',
        content: [{
          type: 'file',
          data: new URL('https://media.example.test/private-image.png'),
          mediaType: 'image/png',
        }],
      }],
      toolNames: [],
    })).rejects.toMatchObject({
      code: 'AI_CAPABILITY_NOT_SUPPORTED',
      status: 400,
    });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  test('binds telemetry and Zero safe downloads without projecting prompt content', async () => {
    const events: Array<{ code: string; options: unknown }> = [];
    const emitCode: AIEmitCode = (definition, options) => {
      events.push({ code: definition.code, options });
    };
    const { prepare } = createPreparer({ vision: true }, emitCode);
    const prepared = await prepare({
      reference: 'smart',
      messages: [{ role: 'user', content: 'private-execution-prompt' }],
      toolNames: [],
      metadata: { durableRunId: 'run-safe-1' },
    });

    await expect(prepared.download([{
      url: new URL('http://127.0.0.1/private-provider-asset'),
      isUrlSupportedByModel: false,
    }])).rejects.toMatchObject({ code: 'AI_REQUEST_INVALID', status: 400 });

    prepared.complete({ toolNames: [] });
    prepared.complete({ toolNames: ['ignored-after-settlement'] });
    prepared.fail(new Error('ignored-after-settlement'));

    const requestCodes = events
      .map((event) => event.code)
      .filter((code) => code.startsWith('ai.request.'));
    expect(requestCodes).toEqual(['ai.request.started', 'ai.request.completed']);
    expect(JSON.stringify(events)).toContain('run-safe-1');
    expect(JSON.stringify(events)).not.toContain('private-execution-prompt');
    expect(JSON.stringify(events)).not.toContain('private-provider-asset');
  });
});

function createPreparer(
  capabilities: Partial<AIProviderCapabilities>,
  emitCode?: AIEmitCode,
) {
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
        capabilities: { text: true, ...capabilities },
      },
    },
    aliases: { smart: 'test/model' },
  }, {}));
  const registry = createAIRegistry(config, emitCode);
  return {
    model,
    prepare: createAIModelExecutionPreparer({
      ...(emitCode === undefined ? {} : { emitCode }),
      resolveModel: (reference) => resolveLanguageModel(
        registry,
        config.aliases,
        reference,
        'smart',
      ),
    }),
  };
}

function requireAIConfig(config: ResolvedAIConfig | false): ResolvedAIConfig {
  if (config === false) throw new Error('AI unexpectedly resolved as disabled.');
  return config;
}
