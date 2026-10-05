import { describe, expect, test } from 'bun:test';
import type {
  Experimental_VideoModelV4,
  Experimental_VideoModelV4CallOptions,
  Experimental_VideoModelV4OperationStatusResult,
  ProviderV4,
} from '@ai-sdk/provider';

import { getPlatformSink, setPlatformSink } from '../observability/sink';
import type { PlatformEvent } from '../observability/types';
import type { AIRegistry } from './ai-registry';
import type {
  ResolvedAIProviderCapabilities,
  ResolvedAIProviderConfig,
} from './ai-types';
import {
  executeAIGenerateVideo,
  executeAIGetVideoStatus,
  executeAIStartVideo,
  type AIVideoServiceContext,
} from './ai-video-service';
import { AI_DEFAULT_VIDEO_DOWNLOAD_MAX_BYTES } from './ai-video-types';
import {
  validateAIVideoPollOptions,
  validateAIVideoWebhookURL,
} from './ai-video-validation';
import { validateAIVideoOperationEnvelope } from './ai-video-operation-envelope';

describe('preview AI video service', () => {
  test('pins asynchronous operations to the resolved model across alias drift', async () => {
    const statusModels: string[] = [];
    const modelA = videoModel('model-a', {
      async doStart() {
        return {
          operation: { jobId: 'job_123' },
          warnings: [],
          providerMetadata: { gateway: { webhookSigningSecret: 'return-only-secret' } },
          response: responseMetadata('model-a'),
        };
      },
      async doStatus({ operation }) {
        statusModels.push(`model-a:${(operation as { jobId: string }).jobId}`);
        return { status: 'pending', response: responseMetadata('model-a') };
      },
    });
    const modelB = videoModel('model-b', {
      async doStart() {
        throw new Error('model-b should not start');
      },
      async doStatus() {
        statusModels.push('model-b');
        return { status: 'pending', response: responseMetadata('model-b') };
      },
    });
    const context = videoContext({ 'model-a': modelA, 'model-b': modelB });

    const started = await executeAIStartVideo({ prompt: 'A small blue sphere.' }, context);
    expect(started.operation).toEqual({
      version: 1,
      resolvedModel: 'video-provider/model-a',
      operation: { jobId: 'job_123' },
    });
    expect(started.providerMetadata).toEqual({
      gateway: { webhookSigningSecret: 'return-only-secret' },
    });

    context.aliases.video = 'video-provider/model-b';
    const status = await executeAIGetVideoStatus({ operation: started.operation }, context);
    expect(status.status).toBe('pending');
    expect(statusModels).toEqual(['model-a:job_123']);
  });

  test('does not put operation or provider metadata into lifecycle telemetry', async () => {
    const events: PlatformEvent[] = [];
    const previous = getPlatformSink();
    setPlatformSink({ emit(event) { events.push(event); } });
    try {
      const context = videoContext({
        'model-a': videoModel('model-a', {
          async doStart() {
            return {
              operation: { jobId: 'private-job-id' },
              warnings: [],
              providerMetadata: { gateway: { webhookSigningSecret: 'private-signing-secret' } },
              response: responseMetadata('model-a'),
            };
          },
          async doStatus() {
            return { status: 'pending', response: responseMetadata('model-a') };
          },
        }),
      });
      await executeAIStartVideo({
        prompt: 'A safe prompt.',
        metadata: { correlationId: 'corr_1' },
      }, context);

      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain('private-job-id');
      expect(serialized).not.toContain('private-signing-secret');
      expect(serialized).toContain('corr_1');
    } finally {
      setPlatformSink(previous);
    }
  });

  test('forwards bounded generation controls and enforces materialized output size', async () => {
    let call: Experimental_VideoModelV4CallOptions | undefined;
    const model = videoModel('model-a', {
      async doGenerate(options) {
        call = options;
        return {
          videos: [{
            type: 'binary',
            data: new Uint8Array([1, 2, 3]),
            mediaType: 'video/mp4',
          }],
          warnings: [],
          response: responseMetadata('model-a'),
        };
      },
    });
    const context = videoContext({ 'model-a': model });
    const providerOptions = { test: { mode: 'enhance' } };
    const result = await executeAIGenerateVideo({
      prompt: 'A slowly rotating cube.',
      fps: 24,
      n: 1,
      maxRetries: 0,
      headers: { 'x-correlation': 'corr_2', omitted: undefined },
      providerOptions,
      downloadMaxBytes: 4,
    }, context);
    expect(result.video.uint8Array).toEqual(new Uint8Array([1, 2, 3]));
    expect(call?.fps).toBe(24);
    expect(call?.n).toBe(1);
    expect(call?.headers?.['x-correlation']).toBe('corr_2');
    expect(call?.headers?.omitted).toBeUndefined();
    expect(call?.providerOptions).toEqual({ test: { mode: 'enhance' } });
    expect(call?.providerOptions).not.toBe(providerOptions);
    expect(Object.isFrozen(call?.providerOptions)).toBe(true);
    expect(Object.isFrozen(call?.providerOptions?.test)).toBe(true);

    const oversized = videoContext({
      'model-a': videoModel('model-a', {
        async doGenerate() {
          return {
            videos: [{
              type: 'binary',
              data: new Uint8Array([1, 2, 3, 4, 5]),
              mediaType: 'video/mp4',
            }],
            warnings: [],
            response: responseMetadata('model-a'),
          };
        },
      }),
    });
    await expect(executeAIGenerateVideo({
      prompt: 'A large video.',
      downloadMaxBytes: 4,
    }, oversized)).rejects.toMatchObject({
      code: 'AI_REQUEST_LIMIT_EXCEEDED',
      status: 413,
    });
  });

  test('snapshots prompt and reference bytes before asynchronous provider work', async () => {
    const promptImage = new Uint8Array([1, 2]);
    const frameImage = new Uint8Array([3, 4]);
    const reference = new Uint8Array([5, 6]);
    const calls: Experimental_VideoModelV4CallOptions[] = [];
    const context = videoContext({
      'model-a': videoModel('model-a', {
        async doGenerate(options) {
          calls.push(options);
          return {
            videos: [{ type: 'binary', data: new Uint8Array([7]), mediaType: 'video/mp4' }],
            warnings: [],
            response: responseMetadata('model-a'),
          };
        },
      }),
    });

    const promptPending = executeAIGenerateVideo({
      prompt: { image: promptImage, text: 'Animate.' },
    }, context);
    promptImage[0] = 9;
    await promptPending;

    const framePending = executeAIGenerateVideo({
      prompt: 'Animate.',
      frameImages: [{ image: frameImage, frameType: 'first_frame' }],
    }, context);
    frameImage[0] = 9;
    await framePending;

    const referencePending = executeAIGenerateVideo({
      prompt: 'Animate.',
      inputReferences: [reference],
    }, context);
    reference[0] = 9;
    await referencePending;

    expect(calls[0]?.image).toMatchObject({ data: new Uint8Array([1, 2]) });
    expect(calls[1]?.frameImages?.[0]?.image).toMatchObject({
      data: new Uint8Array([3, 4]),
    });
    expect(calls[2]?.inputReferences?.[0]).toMatchObject({
      data: new Uint8Array([5, 6]),
    });
  });

  test('bounds counts, frame rates, retries, polling, and webhook URLs', async () => {
    const context = videoContext({ 'model-a': videoModel('model-a', {}) });
    for (const request of [
      { prompt: 'test', n: 5 },
      { prompt: 'test', fps: 0 },
      { prompt: 'test', fps: 121 },
      { prompt: 'test', maxRetries: 11 },
      { prompt: 'test', downloadMaxBytes: AI_DEFAULT_VIDEO_DOWNLOAD_MAX_BYTES + 1 },
    ]) {
      await expect(executeAIGenerateVideo(request, context)).rejects.toMatchObject({
        code: 'AI_REQUEST_INVALID',
        status: 400,
      });
    }
    expect(() => validateAIVideoPollOptions({ intervalMs: 100 })).toThrow();
    expect(() => validateAIVideoPollOptions({ intervalMs: 2_000, timeoutMs: 1_000 })).toThrow();
    expect(() => validateAIVideoWebhookURL('http://example.com/hook', true)).toThrow();
    expect(validateAIVideoWebhookURL('http://localhost:3000/hook', true))
      .toBe('http://localhost:3000/hook');
    expect(() => validateAIVideoWebhookURL('http://localhost:3000/hook', false)).toThrow();
    expect(validateAIVideoWebhookURL('https://example.com/hook', false))
      .toBe('https://example.com/hook');
  });

  test('rejects malformed, cyclic, and oversized durable operation envelopes', () => {
    expect(() => validateAIVideoOperationEnvelope({
      version: 1,
      resolvedModel: 'video-provider/model-a',
      operation: { value: Number.NaN },
    })).toThrow();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => validateAIVideoOperationEnvelope({
      version: 1,
      resolvedModel: 'video-provider/model-a',
      operation: cyclic,
    })).toThrow();
    expect(() => validateAIVideoOperationEnvelope({
      version: 2,
      resolvedModel: 'video-provider/model-a',
      operation: {},
    })).toThrow();
  });

  test('requires native asynchronous support for durable starts and status', async () => {
    const context = videoContext({
      'model-a': videoModel('model-a', {
        async doGenerate() {
          return {
            videos: [{ type: 'binary', data: new Uint8Array([1]), mediaType: 'video/mp4' }],
            warnings: [],
            response: responseMetadata('model-a'),
          };
        },
      }),
    });
    await expect(executeAIStartVideo({ prompt: 'test' }, context)).rejects.toMatchObject({
      code: 'AI_CAPABILITY_NOT_SUPPORTED',
      status: 400,
    });
  });

  test('rejects a provider that returns more videos than requested', async () => {
    const context = videoContext({
      'model-a': videoModel('model-a', {
        async doGenerate() {
          return {
            videos: [1, 2].map(value => ({
              type: 'binary' as const, data: new Uint8Array([value]), mediaType: 'video/mp4',
            })),
            warnings: [], response: responseMetadata('model-a'),
          };
        },
      }),
    });
    await expect(executeAIGenerateVideo({ prompt: 'One video.', n: 1 }, context))
      .rejects.toMatchObject({ code: 'AI_PROVIDER_RESPONSE_INVALID', status: 502 });
  });

  test('rejects an empty materialized video', async () => {
    const context = videoContext({
      'model-a': videoModel('model-a', {
        async doGenerate() {
          return {
            videos: [{ type: 'binary', data: new Uint8Array(), mediaType: 'video/mp4' }],
            warnings: [], response: responseMetadata('model-a'),
          };
        },
      }),
    });
    await expect(executeAIGenerateVideo({ prompt: 'A video.' }, context))
      .rejects.toMatchObject({ code: 'AI_PROVIDER_RESPONSE_INVALID', status: 502 });
  });

  test.each(['binary', 'base64'] as const)('rejects empty completed %s media', async type => {
    const context = videoContext({
      'model-a': videoModel('model-a', {
        async doStart() {
          return { operation: {}, warnings: [], response: responseMetadata('model-a') };
        },
        async doStatus() {
          return {
            status: 'completed',
            videos: [type === 'binary'
              ? { type, data: new Uint8Array(), mediaType: 'video/mp4' }
              : { type, data: '', mediaType: 'video/mp4' }],
            warnings: [], response: responseMetadata('model-a'),
          };
        },
      }),
    });
    await expect(executeAIGetVideoStatus({ operation: {
      version: 1, resolvedModel: 'video-provider/model-a', operation: {},
    } }, context)).rejects.toMatchObject({ code: 'AI_PROVIDER_RESPONSE_INVALID', status: 502 });
  });
});

function videoModel(
  modelId: string,
  methods: Partial<Pick<Experimental_VideoModelV4, 'doGenerate' | 'doStart' | 'doStatus'>>
): Experimental_VideoModelV4 {
  return {
    specificationVersion: 'v4',
    provider: 'test.video',
    modelId,
    maxVideosPerCall: 4,
    ...methods,
  };
}

function responseMetadata(modelId: string) {
  return {
    timestamp: new Date('2026-10-04T12:00:00.000Z'),
    modelId,
    headers: { 'x-request-id': 'request_1' },
  };
}

function videoContext(
  models: Record<string, Experimental_VideoModelV4>
): AIVideoServiceContext {
  const id = 'video-provider';
  const capabilities: ResolvedAIProviderCapabilities = {
    text: false,
    streaming: false,
    tools: false,
    vision: false,
    embeddings: false,
    images: false,
    transcription: false,
    speech: false,
    reranking: false,
    video: true,
    files: false,
    fileMetadata: false,
    fileDownload: false,
    fileDelete: false,
    skills: false,
    realtime: false,
    evaluation: false,
    batch: false,
  };
  const provider: ResolvedAIProviderConfig = {
    id,
    type: 'custom',
    enabled: true,
    active: true,
    source: 'config',
    configuredBy: ['test'],
    capabilities,
    reason: null,
    adapter: {} as ProviderV4,
  };
  const registry: AIRegistry = {
    providers: { [id]: provider },
    providerInstances: { [id]: {} as ProviderV4 },
    registry: {
      videoModel(reference: string) {
        const modelId = reference.slice(reference.indexOf('/') + 1);
        const model = models[modelId];
        if (!model) throw new Error(`unknown model ${reference}`);
        return model;
      },
    } as AIRegistry['registry'],
  };
  return {
    registry,
    aliases: { video: `${id}/model-a` },
    allowInsecureLocalhostWebhooks: true,
  };
}
