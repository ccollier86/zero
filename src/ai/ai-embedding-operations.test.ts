import { describe, expect, test } from 'bun:test';
import type {
  EmbeddingModelV4,
  EmbeddingModelV4CallOptions,
  EmbeddingModelV4Result,
} from '@ai-sdk/provider';

import { executeAIEmbed, executeAIEmbedMany } from './ai-embedding-operations';
import type { AIRequestTelemetry } from './ai-request-telemetry';

describe('executeAIEmbed', () => {
  test('preserves missing-usage semantics and detaches the returned vector', async () => {
    const providerVector = [0.25, 0.75];
    const telemetry = recordingTelemetry();
    const result = await executeAIEmbed({ value: 'one' }, {
      model: embeddingModel(async () => ({
        embeddings: [providerVector],
        warnings: [],
      })),
      requestTelemetry: telemetry.service,
    });

    expect(result.value).toBe('one');
    expect(result.embedding).toEqual([0.25, 0.75]);
    expect(Number.isNaN((result.usage as { tokens: number }).tokens)).toBe(true);
    expect(telemetry.completions).toEqual([{ totalTokens: undefined }]);
    expect(telemetry.failures).toEqual([]);

    providerVector[0] = 999;
    expect(result.embedding).toEqual([0.25, 0.75]);
  });

  test('rejects empty and non-finite vectors and negative provider usage', async () => {
    const responses = [
      { embeddings: [[]], usage: { tokens: 1 }, warnings: [] },
      { embeddings: [[Number.POSITIVE_INFINITY]], usage: { tokens: 1 }, warnings: [] },
      { embeddings: [[1]], usage: { tokens: -1 }, warnings: [] },
    ] satisfies EmbeddingModelV4Result[];

    for (const response of responses) {
      const telemetry = recordingTelemetry();
      let providerCalls = 0;
      await expect(executeAIEmbed({ value: 'provider-secret-value' }, {
        model: embeddingModel(async () => {
          providerCalls += 1;
          return response;
        }),
        requestTelemetry: telemetry.service,
      })).rejects.toMatchObject({
        code: 'AI_PROVIDER_RESPONSE_INVALID',
        status: 502,
      });
      expect(providerCalls).toBe(1);
      expect(telemetry.completions).toEqual([]);
      expect(telemetry.failures).toHaveLength(1);
      expect(telemetry.failures[0]).toMatchObject({ code: 'AI_PROVIDER_RESPONSE_INVALID' });
      expect(JSON.stringify(telemetry.failures)).not.toContain('provider-secret-value');
    }
  });
});

describe('executeAIEmbedMany', () => {
  test('forwards SDK 7 controls, bounds concurrency, and returns detached ordered results', async () => {
    const calls: EmbeddingModelV4CallOptions[] = [];
    const providerVectors: number[][] = [];
    let active = 0;
    let peakActive = 0;
    const model = embeddingModel(async (options) => {
      calls.push(options);
      active += 1;
      peakActive = Math.max(peakActive, active);
      await Bun.sleep(5);
      active -= 1;
      const vector = [options.values[0].length, calls.length];
      providerVectors.push(vector);
      return {
        embeddings: [vector],
        usage: { tokens: 1 },
        warnings: [],
      };
    });
    const lifecycle: string[] = [];
    const telemetry = recordingTelemetry();
    const runtimeContext = { traceId: 'trace_1' };
    const providerOptions = { test: { mode: 'fast' } };

    const result = await executeAIEmbedMany({
      values: ['one', 'two', 'three', 'four', 'five'],
      headers: { 'x-test': 'present', 'x-omit': undefined },
      providerOptions,
      runtimeContext,
      onStart(event) {
        lifecycle.push(`start:${event.runtimeContext.traceId}`);
      },
      onEnd(event) {
        lifecycle.push(`end:${event.embedding.length}`);
      },
    }, {
      model,
      requestTelemetry: telemetry.service,
    });

    expect(calls).toHaveLength(5);
    expect(peakActive).toBe(4);
    expect(calls[0].headers?.['x-test']).toBe('present');
    expect(calls[0].headers?.['x-omit']).toBeUndefined();
    expect(calls[0].providerOptions).toEqual({ test: { mode: 'fast' } });
    expect(calls[0].providerOptions).not.toBe(providerOptions);
    expect(Object.isFrozen(calls[0].providerOptions)).toBe(true);
    expect(Object.isFrozen(calls[0].providerOptions?.test)).toBe(true);
    expect(lifecycle).toEqual(['start:trace_1', 'end:5']);
    expect(result.values).toEqual(['one', 'two', 'three', 'four', 'five']);
    expect(result.embeddings).toHaveLength(5);
    expect(result.usage.tokens).toBe(5);
    expect(telemetry.completions).toEqual([{ totalTokens: 5 }]);
    expect(telemetry.failures).toEqual([]);

    providerVectors[0][0] = 999;
    expect(result.embeddings.flat()).not.toContain(999);
  });

  test('maps malformed provider counts and vectors to a secret-safe 502', async () => {
    for (const response of [
      { embeddings: [], usage: { tokens: 1 }, warnings: [] },
      { embeddings: [[Number.NaN]], usage: { tokens: 1 }, warnings: [] },
    ] satisfies EmbeddingModelV4Result[]) {
      const telemetry = recordingTelemetry();
      let caught: unknown;
      try {
        await executeAIEmbedMany({ values: ['provider-secret-value'] }, {
          model: embeddingModel(async () => response),
          requestTelemetry: telemetry.service,
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toMatchObject({
        code: 'AI_PROVIDER_RESPONSE_INVALID',
        status: 502,
      });
      expect((caught as Error).message).not.toContain('provider-secret-value');
      expect(telemetry.completions).toHaveLength(0);
      expect(telemetry.failures).toHaveLength(1);
      expect(telemetry.failures[0]).toMatchObject({ code: 'AI_PROVIDER_RESPONSE_INVALID' });
    }
  });

  test('preserves SDK missing-usage semantics without treating them as malformed', async () => {
    const telemetry = recordingTelemetry();
    const result = await executeAIEmbedMany({ values: ['one'] }, {
      model: embeddingModel(async () => ({ embeddings: [[1]], warnings: [] })),
      requestTelemetry: telemetry.service,
    });

    expect(Number.isNaN(result.usage.tokens)).toBe(true);
    expect(telemetry.failures).toEqual([]);
  });

  test('reports bounded request validation through request telemetry', async () => {
    const telemetry = recordingTelemetry();
    await expect(executeAIEmbedMany({ values: [] }, {
      model: embeddingModel(async () => {
        throw new Error('provider must not run');
      }),
      requestTelemetry: telemetry.service,
    })).rejects.toMatchObject({ code: 'AI_REQUEST_INVALID', status: 400 });
    expect(telemetry.failures).toHaveLength(1);
  });
});

function embeddingModel(
  doEmbed: (options: EmbeddingModelV4CallOptions) => Promise<EmbeddingModelV4Result>
): EmbeddingModelV4 {
  return {
    specificationVersion: 'v4',
    provider: 'test',
    modelId: 'embed-test',
    maxEmbeddingsPerCall: 1,
    supportsParallelCalls: true,
    doEmbed,
  };
}

function recordingTelemetry(): {
  service: AIRequestTelemetry;
  completions: unknown[];
  failures: unknown[];
} {
  const completions: unknown[] = [];
  const failures: unknown[] = [];
  return {
    completions,
    failures,
    service: {
      complete(details) {
        completions.push(details);
      },
      fail(error) {
        failures.push(error);
      },
    },
  };
}
