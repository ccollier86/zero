import { describe, expect, test } from 'bun:test';

import { OBS_CODES, MemoryEventStore, configureObservability } from '../observability';
import { resolveAIConfig } from './ai-env';
import { AIService } from './ai-service';

describe('AIService request lifecycle', () => {
  test('reports a terminal provider stream error exactly once', async () => {
    const store = new MemoryEventStore();
    configureObservability({ console: false, store });
    const config = resolveAIConfig({
      autoDetect: false,
      providers: { test: { type: 'custom', adapter: failingStreamingAdapter() } },
      aliases: { smart: 'test/model' },
    }, {});
    if (config === false) throw new Error('AI unexpectedly resolved as disabled.');

    try {
      const result = new AIService(config).streamText({ prompt: 'Fail after streaming starts.' });
      await settleWithin(result.consumeStream(), 1_000);
      await Promise.resolve();

      expect(store.query({ code: OBS_CODES.AI_REQUEST_FAILED.code }).count).toBe(1);
      expect(store.query({ code: OBS_CODES.AI_REQUEST_COMPLETED.code }).count).toBe(0);
    } finally {
      configureObservability({ console: false });
    }
  });

  test('does not report a recovered stream retry as a failed request', async () => {
    const store = new MemoryEventStore();
    configureObservability({ console: false, store });
    const adapter = retryingStreamingAdapter();
    const config = resolveAIConfig({
      autoDetect: false,
      providers: { test: { type: 'custom', adapter } },
      aliases: { smart: 'test/model' },
    }, {});
    if (config === false) throw new Error('AI unexpectedly resolved as disabled.');
    let observedErrors = 0;

    try {
      const result = new AIService(config).streamText({
        prompt: 'Recover once.',
        streamRetries: 1,
        onError: () => {
          observedErrors += 1;
        },
      });
      await settleWithin(result.consumeStream(), 1_000);
      await Promise.resolve();

      expect(adapter.calls()).toBe(2);
      expect(observedErrors).toBe(1);
      expect(store.query({ code: OBS_CODES.AI_REQUEST_FAILED.code }).count).toBe(0);
      expect(store.query({ code: OBS_CODES.AI_REQUEST_COMPLETED.code }).count).toBe(1);
    } finally {
      configureObservability({ console: false });
    }
  });

  test('reports an aborted stream exactly once and never as completed', async () => {
    const store = new MemoryEventStore();
    configureObservability({ console: false, store });
    const providerStarted = Promise.withResolvers<void>();
    const adapter = streamingAdapter(providerStarted.resolve);
    const config = resolveAIConfig({
      autoDetect: false,
      providers: { test: { type: 'custom', adapter } },
      aliases: { smart: 'test/model' },
    }, {});
    if (config === false) throw new Error('AI unexpectedly resolved as disabled.');

    const controller = new AbortController();
    try {
      const result = new AIService(config).streamText({
        prompt: 'Stream until cancelled.',
        abortSignal: controller.signal,
      });
      const consumed = result.consumeStream();
      await providerStarted.promise;
      controller.abort(new DOMException('Caller cancelled the stream.', 'AbortError'));
      await settleWithin(consumed, 1_000);

      expect(store.query({ code: OBS_CODES.AI_REQUEST_STARTED.code }).count).toBe(1);
      expect(store.query({ code: OBS_CODES.AI_REQUEST_FAILED.code }).count).toBe(1);
      expect(store.query({ code: OBS_CODES.AI_REQUEST_COMPLETED.code }).count).toBe(0);
    } finally {
      configureObservability({ console: false });
    }
  });

  test('returns a bounded Zero error for an invalid empty conversation', async () => {
    const config = resolveAIConfig({
      autoDetect: false,
      providers: { test: { type: 'custom', adapter: generatingAdapter() } },
      aliases: { smart: 'test/model' },
    }, {});
    if (config === false) throw new Error('AI unexpectedly resolved as disabled.');

    await expect(new AIService(config).generateConversation({
      messages: [],
    })).rejects.toMatchObject({
      code: 'AI_REQUEST_INVALID',
      status: 400,
    });
  });
});

function streamingAdapter(started: () => void) {
  return providerWithModel({
    async doStream(options: { abortSignal?: AbortSignal }) {
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({ type: 'text-start', id: 'text-1' });
            controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'partial' });
            const abort = () => {
              const error = new Error('Provider stream aborted.');
              error.name = 'AbortError';
              controller.error(error);
            };
            if (options.abortSignal?.aborted) abort();
            else options.abortSignal?.addEventListener('abort', abort, { once: true });
            started();
          },
        }),
      };
    },
  });
}

function failingStreamingAdapter() {
  return providerWithModel({
    async doStream() {
      return streamResult([
        { type: 'stream-start', warnings: [] },
        { type: 'error', error: new Error('Provider response contained private data.') },
      ]);
    },
  });
}

function retryingStreamingAdapter() {
  let callCount = 0;
  return Object.assign(providerWithModel({
    async doStream() {
      callCount += 1;
      if (callCount === 1) {
        return streamResult([
          { type: 'stream-start', warnings: [] },
          { type: 'error', error: new Error('Transient provider failure.') },
        ]);
      }
      return streamResult([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 'text-1' },
        { type: 'text-delta', id: 'text-1', delta: 'recovered' },
        { type: 'text-end', id: 'text-1' },
        {
          type: 'finish',
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
        },
      ]);
    },
  }), {
    calls: () => callCount,
  });
}

function streamResult(parts: unknown[]) {
  return {
    stream: new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }),
  };
}

function generatingAdapter() {
  return providerWithModel({
    async doGenerate() {
      throw new Error('The provider must not receive an invalid prompt.');
    },
  });
}

function providerWithModel(implementation: Record<string, unknown>) {
  return {
    specificationVersion: 'v3',
    languageModel(modelId: string) {
      return {
        specificationVersion: 'v3',
        provider: 'test',
        modelId,
        supportedUrls: {},
        ...implementation,
      };
    },
    embeddingModel() {
      throw new Error('Embedding models are not used by this test.');
    },
    imageModel() {
      throw new Error('Image models are not used by this test.');
    },
  } as any;
}

async function settleWithin<T>(promise: PromiseLike<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    Bun.sleep(timeoutMs).then(() => {
      throw new Error(`AI stream did not settle within ${timeoutMs}ms.`);
    }),
  ]);
}
