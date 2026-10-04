import { describe, expect, test } from 'bun:test';
import type { FilesV4, ProviderV4 } from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';

import { resolveAIConfig } from './ai-env';
import { AIService } from './ai-service';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

describe('AIService provider-hosted file integration', () => {
  test('uploads and reuses a provider-bound file reference in a model request', async () => {
    let prompt: unknown;
    let modelCalls = 0;
    const model = new MockLanguageModelV4({
      async doGenerate(options) {
        modelCalls += 1;
        prompt = options.prompt;
        return {
          content: [{ type: 'text', text: 'read' }],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage,
          warnings: [],
        };
      },
    });
    const files: FilesV4 = {
      specificationVersion: 'v4',
      provider: 'openai.files',
      async uploadFile() {
        return {
          providerReference: { 'openai.files': 'file_123' },
          mediaType: 'application/pdf',
          warnings: [],
        };
      },
    };
    const adapter: ProviderV4 = {
      specificationVersion: 'v4',
      languageModel: () => model,
      embeddingModel: () => { throw new Error('not used'); },
      imageModel: () => { throw new Error('not used'); },
      files: () => files,
    };
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        'primary-openai': {
          type: 'custom',
          adapter,
          capabilities: { text: true, files: true },
        },
      },
      filesProvider: 'primary-openai',
      aliases: { smart: 'primary-openai/test-model' },
    }, {});
    if (config === false) throw new Error('AI unexpectedly resolved as disabled.');
    const service = new AIService(config);

    const uploaded = await service.files.upload({
      data: { type: 'data', data: new Uint8Array([1, 2, 3]) },
      mediaType: 'application/pdf',
      filename: 'record.pdf',
    });
    await service.generateConversation({
      messages: [{
        role: 'user',
        content: [{
          type: 'file',
          hostedFile: uploaded.file,
          mediaType: uploaded.mediaType ?? 'application/pdf',
          filename: uploaded.filename,
        }],
      }],
    });

    expect(JSON.stringify(prompt)).toContain('"type":"reference"');
    expect(JSON.stringify(prompt)).toContain('file_123');
    expect(modelCalls).toBe(1);

    await expect(service.generateConversation({
      messages: [{
        role: 'user',
        content: [{
          type: 'file',
          hostedFile: { ...uploaded.file, providerId: 'other-openai' },
          mediaType: 'application/pdf',
        }],
      }],
    })).rejects.toMatchObject({ code: 'AI_REQUEST_INVALID', status: 400 });
    expect(modelCalls).toBe(1);
  });
});
