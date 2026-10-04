import { describe, expect, test } from 'bun:test';
import type {
  ImageModelV4,
  ImageModelV4CallOptions,
  ImageModelV4Result,
} from '@ai-sdk/provider';

import {
  AI_MAX_GENERATED_IMAGE_BYTES,
  executeAIGenerateImage,
} from './ai-image-operations';
import type { AIRequestTelemetry } from './ai-request-telemetry';

describe('executeAIGenerateImage', () => {
  test('rejects invalid fanout before any provider call', async () => {
    let providerCalls = 0;
    const model = imageModel(async () => {
      providerCalls += 1;
      return imageResponse([new Uint8Array([1])]);
    });

    for (const request of [
      { prompt: 'test', n: 0 },
      { prompt: 'test', n: 17 },
      { prompt: 'test', n: 1.5 },
      { prompt: 'test', maxImagesPerCall: 0 },
      { prompt: 'test', maxImagesPerCall: 17 },
      { prompt: 'test', maxImagesPerCall: 1.5 },
    ]) {
      const telemetry = recordingTelemetry();
      await expect(executeAIGenerateImage(request, {
        model,
        requestTelemetry: telemetry.service,
      })).rejects.toMatchObject({ code: 'AI_REQUEST_INVALID', status: 400 });
      expect(telemetry.completions).toEqual([]);
      expect(telemetry.failures).toHaveLength(1);
    }

    expect(providerCalls).toBe(0);
  });

  test('maps malformed provider images and usage to a stable 502', async () => {
    const malformed: ImageModelV4Result[] = [
      imageResponse([new Uint8Array()]),
      imageResponse([new Uint8Array([1])], {
        inputTokens: -1,
        outputTokens: undefined,
        totalTokens: undefined,
      }),
      imageResponse([new Uint8Array([1])], {
        inputTokens: undefined,
        outputTokens: Number.NaN,
        totalTokens: undefined,
      }),
    ];

    for (const response of malformed) {
      const telemetry = recordingTelemetry();
      await expect(executeAIGenerateImage({
        prompt: 'provider-secret-prompt',
        maxRetries: 0,
      }, {
        model: imageModel(async () => response),
        requestTelemetry: telemetry.service,
      })).rejects.toMatchObject({
        code: 'AI_PROVIDER_RESPONSE_INVALID',
        status: 502,
      });
      expect(telemetry.completions).toEqual([]);
      expect(telemetry.failures).toHaveLength(1);
      expect(JSON.stringify(telemetry.failures)).not.toContain('provider-secret-prompt');
    }
  });

  test('rejects oversized provider output before materializing an SDK image result', async () => {
    const telemetry = recordingTelemetry();
    let providerCalls = 0;
    const oversized = new Uint8Array(AI_MAX_GENERATED_IMAGE_BYTES + 1);

    await expect(executeAIGenerateImage({ prompt: 'test', maxRetries: 0 }, {
      model: imageModel(async () => {
        providerCalls += 1;
        return imageResponse([oversized]);
      }),
      requestTelemetry: telemetry.service,
    })).rejects.toMatchObject({
      code: 'AI_REQUEST_LIMIT_EXCEEDED',
      status: 413,
    });

    expect(providerCalls).toBe(1);
    expect(telemetry.completions).toEqual([]);
    expect(telemetry.failures).toHaveLength(1);
  });

  test('detaches generated image bytes from provider-owned buffers', async () => {
    const providerImage = new Uint8Array([1, 2, 3]);
    const result = await executeAIGenerateImage({ prompt: 'test', maxRetries: 0 }, {
      model: imageModel(async () => imageResponse([providerImage])),
      requestTelemetry: recordingTelemetry().service,
    });

    providerImage[0] = 9;
    expect(result.image.uint8Array).toEqual(new Uint8Array([1, 2, 3]));
  });
});

function imageModel(
  doGenerate: (options: ImageModelV4CallOptions) => Promise<ImageModelV4Result>,
): ImageModelV4 {
  return {
    specificationVersion: 'v4',
    provider: 'test.image',
    modelId: 'image-test',
    maxImagesPerCall: 16,
    doGenerate,
  };
}

function imageResponse(
  images: ImageModelV4Result['images'],
  usage?: ImageModelV4Result['usage'],
): ImageModelV4Result {
  return {
    images,
    warnings: [],
    response: {
      timestamp: new Date('2026-10-04T12:00:00.000Z'),
      modelId: 'image-test',
      headers: {},
    },
    ...(usage === undefined ? {} : { usage }),
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
