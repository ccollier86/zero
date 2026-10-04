import { describe, expect, test } from 'bun:test';
import { createProviderRegistry } from 'ai';
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { z } from 'zod';

import { resolveAIConfig } from './ai-env';
import { AIOutput } from './ai-output';
import { AIService } from './ai-service';
import type { AIProviderCapabilities } from './ai-types';
import { normalizeProviderAdapter } from './providers/provider-factory-types';

const legacyProviderCapabilities = {
  text: true,
  streaming: true,
  tools: true,
  vision: false,
  embeddings: false,
  images: false,
  transcription: false,
  speech: false,
} satisfies AIProviderCapabilities;

describe('AI SDK 7 compatibility boundary', () => {
  test('keeps the pre-SDK-7 provider capability contract source-compatible', () => {
    expect(legacyProviderCapabilities.text).toBe(true);
  });

  test('preserves V4 provider extensions and canonical modality aliases', () => {
    const transcription = { specificationVersion: 'v4', provider: 'test', modelId: 'audio' };
    const speech = { specificationVersion: 'v4', provider: 'test', modelId: 'speech' };
    const video = { specificationVersion: 'v4', provider: 'test', modelId: 'video' };
    const files = { specificationVersion: 'v4', provider: 'test.files' };

    const normalized = normalizeProviderAdapter({
      specificationVersion: 'v4',
      languageModel: () => notUsed(),
      embeddingModel: () => notUsed(),
      imageModel: () => notUsed(),
      transcription: () => transcription,
      speech: () => speech,
      videoModel: () => video,
      files: () => files,
    });

    expect(normalized.specificationVersion).toBe('v4');
    expect((normalized as any).transcriptionModel('audio')).toBe(transcription);
    expect((normalized as any).speechModel('speech')).toBe(speech);
    expect((normalized as any).videoModel('video')).toBe(video);
    expect((normalized as any).files()).toBe(files);

    // The SDK registry spreads providers that expose video. Canonical aliases
    // therefore need to be enumerable as well as readable through the wrapper.
    const registry = createProviderRegistry({ test: normalized }, { separator: '/' });
    expect((registry as any).transcriptionModel('test/audio')).toBe(transcription);
    expect((registry as any).speechModel('test/speech')).toBe(speech);
    expect((registry as any).videoModel('test/video')).toBe(video);
    expect((registry as any).files('test')).toBe(files);
  });

  test('maps Zero system input to V7 instructions and emits tagged V4 file data', async () => {
    let call: LanguageModelV4CallOptions | undefined;
    const adapter = {
      specificationVersion: 'v4' as const,
      languageModel(modelId: string) {
        return {
          specificationVersion: 'v4' as const,
          provider: 'test',
          modelId,
          supportedUrls: {
            'image/*': [/^https:\/\/example\.test\//],
          },
          async doGenerate(options: LanguageModelV4CallOptions) {
            call = options;
            return {
              content: [{ type: 'text' as const, text: 'ok' }],
              finishReason: { unified: 'stop' as const, raw: 'stop' },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
              warnings: [],
            };
          },
          async doStream() {
            throw new Error('Streaming is not used by this test.');
          },
        };
      },
      embeddingModel: () => notUsed(),
      imageModel: () => notUsed(),
    };
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        test: {
          type: 'custom',
          adapter,
          capabilities: { vision: true },
        },
      },
      aliases: { smart: 'test/model' },
    }, {});
    if (config === false) throw new Error('AI unexpectedly resolved as disabled.');

    const result = await new AIService(config).generateConversation({
      system: 'Follow the trusted application policy.',
      messages: [{
        role: 'user',
        content: [
          { type: 'image', url: 'https://example.test/image.png' },
          {
            type: 'file',
            data: new Uint8Array([1, 2, 3]),
            mediaType: 'application/pdf',
            filename: 'record.pdf',
          },
        ],
      }],
    });

    expect(result.text).toBe('ok');
    expect(call?.prompt[0]).toEqual({
      role: 'system',
      content: 'Follow the trusted application policy.',
    });
    expect(call?.prompt[1]).toMatchObject({
      role: 'user',
      content: [
        {
          type: 'file',
          mediaType: 'image/png',
          data: { type: 'url', url: new URL('https://example.test/image.png') },
        },
        {
          type: 'file',
          mediaType: 'application/pdf',
          filename: 'record.pdf',
          data: { type: 'data', data: new Uint8Array([1, 2, 3]) },
        },
      ],
    });
  });

  test('infers and validates structured output through the existing generation API', async () => {
    const adapter = {
      specificationVersion: 'v4' as const,
      languageModel(modelId: string) {
        return {
          specificationVersion: 'v4' as const,
          provider: 'test',
          modelId,
          supportedUrls: {},
          async doGenerate() {
            return {
              content: [{ type: 'text' as const, text: '{"name":"Ada","age":36}' }],
              finishReason: { unified: 'stop' as const, raw: 'stop' },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 8, text: 8, reasoning: 0 },
              },
              warnings: [],
            };
          },
          async doStream() {
            throw new Error('Streaming is not used by this test.');
          },
        };
      },
      embeddingModel: () => notUsed(),
      imageModel: () => notUsed(),
    };
    const config = resolveAIConfig({
      autoDetect: false,
      providers: { test: { type: 'custom', adapter } },
      aliases: { smart: 'test/model' },
    }, {});
    if (config === false) throw new Error('AI unexpectedly resolved as disabled.');

    const result = await new AIService(config).generateText({
      prompt: 'Return the person.',
      output: AIOutput.object({
        schema: z.object({ name: z.string(), age: z.number().int() }),
      }),
    });
    const typed: { name: string; age: number } = result.output;

    expect(typed).toEqual({ name: 'Ada', age: 36 });
  });
});

function notUsed(): never {
  throw new Error('Model surface is not used by this test.');
}
