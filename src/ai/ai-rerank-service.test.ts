import { describe, expect, test } from 'bun:test';
import type {
  RerankingModelV4,
  RerankingModelV4CallOptions,
  RerankingModelV4Result,
} from '@ai-sdk/provider';

import type { AIRequestTelemetry } from './ai-request-telemetry';
import { executeAIRerank } from './ai-rerank-service';

describe('executeAIRerank', () => {
  test('forwards SDK 7 controls and returns detached results over document snapshots', async () => {
    let call: RerankingModelV4CallOptions | undefined;
    const original = [{ id: 'a', nested: { score: 1 } }, { id: 'b', nested: { score: 2 } }];
    const timestamp = new Date('2026-10-04T12:00:00.000Z');
    const model = rerankingModel(async (options) => {
      call = options;
      expect(Object.isFrozen(options.documents.values)).toBe(true);
      expect(Object.isFrozen(options.documents.values[0])).toBe(true);
      return {
        ranking: [
          { index: 1, relevanceScore: 0.9 },
          { index: 0, relevanceScore: 0.5 },
        ],
        warnings: [],
        providerMetadata: { test: { region: 'local' } },
        response: { id: 'rank_1', timestamp, modelId: 'rerank-test' },
      };
    });
    const lifecycle: string[] = [];
    const telemetry = recordingTelemetry();
    const providerOptions = { test: { mode: 'strict' } };

    const result = await executeAIRerank({
      documents: original,
      query: 'best match',
      topN: 2,
      maxRetries: 0,
      headers: { 'x-test': 'present', 'x-omit': undefined },
      providerOptions,
      runtimeContext: { traceId: 'trace_2' },
      onStart(event) {
        lifecycle.push(`start:${event.runtimeContext.traceId}`);
      },
      onEnd(event) {
        lifecycle.push(`end:${event.ranking.length}`);
      },
    }, {
      model,
      requestTelemetry: telemetry.service,
    });
    original[0].nested.score = 99;

    expect(call?.documents.type).toBe('object');
    expect(call?.query).toBe('best match');
    expect(call?.topN).toBe(2);
    expect(call?.headers?.['x-test']).toBe('present');
    expect(call?.headers?.['x-omit']).toBeUndefined();
    expect(call?.providerOptions).toEqual({ test: { mode: 'strict' } });
    expect(call?.providerOptions).not.toBe(providerOptions);
    expect(Object.isFrozen(call?.providerOptions)).toBe(true);
    expect(Object.isFrozen(call?.providerOptions?.test)).toBe(true);
    expect(lifecycle).toEqual(['start:trace_2', 'end:2']);
    expect(result.rerankedDocuments.map((document) => document.id)).toEqual(['b', 'a']);
    expect((result.originalDocuments[0] as typeof original[number]).nested.score).toBe(1);
    expect(result.originalDocuments).not.toBe(original);
    expect(result.ranking).not.toBe(result.rerankedDocuments);
    expect(result.response.timestamp).not.toBe(timestamp);
    expect(result.response.timestamp.toISOString()).toBe(timestamp.toISOString());
    expect(telemetry.completions).toEqual([undefined]);
    expect(telemetry.failures).toEqual([]);
  });

  test('rejects duplicate, out-of-range, non-integer, and non-finite rankings', async () => {
    const rankings: RerankingModelV4Result['ranking'][] = [
      [{ index: 0, relevanceScore: 1 }, { index: 0, relevanceScore: 0.5 }],
      [{ index: 2, relevanceScore: 1 }],
      [{ index: 0.5, relevanceScore: 1 }],
      [{ index: 0, relevanceScore: Number.NaN }],
    ];

    for (const ranking of rankings) {
      const telemetry = recordingTelemetry();
      let caught: unknown;
      try {
        await executeAIRerank({
          documents: ['sensitive-one', 'sensitive-two'],
          query: 'sensitive-query',
        }, {
          model: rerankingModel(async () => ({ ranking })),
          requestTelemetry: telemetry.service,
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toMatchObject({
        code: 'AI_PROVIDER_RESPONSE_INVALID',
        status: 502,
      });
      expect((caught as Error).message).not.toContain('sensitive');
      expect(telemetry.completions).toHaveLength(0);
      expect(telemetry.failures).toHaveLength(1);
      expect(telemetry.failures[0]).toMatchObject({ code: 'AI_PROVIDER_RESPONSE_INVALID' });
    }
  });

  test('maps structurally malformed raw provider responses to a safe 502', async () => {
    const telemetry = recordingTelemetry();
    await expect(executeAIRerank({ documents: ['sensitive'], query: 'query' }, {
      model: rerankingModel(async () => ({ ranking: null } as never)),
      requestTelemetry: telemetry.service,
    })).rejects.toMatchObject({
      code: 'AI_PROVIDER_RESPONSE_INVALID',
      status: 502,
      message: 'AI reranking provider returned an invalid response.',
    });
    expect(telemetry.failures).toHaveLength(1);
  });

  test('enforces topN against providers that return too many documents', async () => {
    const telemetry = recordingTelemetry();
    await expect(executeAIRerank({
      documents: ['one', 'two'],
      query: 'query',
      topN: 1,
    }, {
      model: rerankingModel(async () => ({
        ranking: [
          { index: 0, relevanceScore: 1 },
          { index: 1, relevanceScore: 0.5 },
        ],
      })),
      requestTelemetry: telemetry.service,
    })).rejects.toMatchObject({ code: 'AI_PROVIDER_RESPONSE_INVALID', status: 502 });
  });
});

function rerankingModel(
  doRerank: (options: RerankingModelV4CallOptions) => Promise<RerankingModelV4Result>
): RerankingModelV4 {
  return {
    specificationVersion: 'v4',
    provider: 'test',
    modelId: 'rerank-test',
    doRerank,
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
