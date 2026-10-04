import { describe, expect, test } from 'bun:test';
import type {
  SpeechModelV4,
  SpeechModelV4CallOptions,
  SpeechModelV4Result,
  TranscriptionModelV4,
  TranscriptionModelV4CallOptions,
  TranscriptionModelV4Result,
} from '@ai-sdk/provider';

import {
  AI_MAX_AUDIO_INPUT_BYTES,
  AI_MAX_SPEECH_OUTPUT_BYTES,
  AI_MAX_SPEECH_TEXT_BYTES,
  executeAISpeech,
  executeAITranscription,
} from './ai-audio-operations';
import type { AIRequestTelemetry } from './ai-request-telemetry';

describe('executeAITranscription', () => {
  test('rejects oversized local audio before provider I/O', async () => {
    let providerCalls = 0;
    const telemetry = recordingTelemetry();
    const audio = new Uint8Array(AI_MAX_AUDIO_INPUT_BYTES + 1);

    await expect(executeAITranscription({ audio }, {
      model: transcriptionModel(async () => {
        providerCalls += 1;
        return transcriptionResponse();
      }),
      requestTelemetry: telemetry.service,
    })).rejects.toMatchObject({
      code: 'AI_REQUEST_LIMIT_EXCEEDED',
      status: 413,
    });

    expect(providerCalls).toBe(0);
    expect(telemetry.completions).toEqual([]);
    expect(telemetry.failures).toHaveLength(1);
  });

  test('blocks private URL inputs through Zero safe download before provider I/O', async () => {
    let providerCalls = 0;
    const telemetry = recordingTelemetry();

    await expect(executeAITranscription({
      audio: new URL('http://127.0.0.1/private-audio.wav'),
    }, {
      model: transcriptionModel(async () => {
        providerCalls += 1;
        return transcriptionResponse();
      }),
      requestTelemetry: telemetry.service,
    })).rejects.toMatchObject({
      code: 'AI_REQUEST_INVALID',
      status: 400,
    });

    expect(providerCalls).toBe(0);
    expect(telemetry.completions).toEqual([]);
    expect(telemetry.failures).toHaveLength(1);
  });

  test('validates and detaches provider transcript segments', async () => {
    const segment = { text: 'hello', startSecond: 0, endSecond: 1 };
    const result = await executeAITranscription({ audio: new Uint8Array([1]) }, {
      model: transcriptionModel(async () => transcriptionResponse({ segments: [segment] })),
      requestTelemetry: recordingTelemetry().service,
    });
    segment.text = 'mutated';
    expect(result.segments).toEqual([{ text: 'hello', startSecond: 0, endSecond: 1 }]);

    await expect(executeAITranscription({ audio: new Uint8Array([1]) }, {
      model: transcriptionModel(async () => transcriptionResponse({
        segments: [{ text: 'bad', startSecond: 2, endSecond: 1 }],
      })),
      requestTelemetry: recordingTelemetry().service,
    })).rejects.toMatchObject({ code: 'AI_PROVIDER_RESPONSE_INVALID', status: 502 });
  });
});

describe('executeAISpeech', () => {
  test('rejects oversized text before provider I/O', async () => {
    let providerCalls = 0;
    const telemetry = recordingTelemetry();

    await expect(executeAISpeech({
      text: 'a'.repeat(AI_MAX_SPEECH_TEXT_BYTES + 1),
    }, {
      model: speechModel(async () => {
        providerCalls += 1;
        return speechResponse(new Uint8Array([1]));
      }),
      requestTelemetry: telemetry.service,
    })).rejects.toMatchObject({
      code: 'AI_REQUEST_LIMIT_EXCEEDED',
      status: 413,
    });

    expect(providerCalls).toBe(0);
    expect(telemetry.completions).toEqual([]);
    expect(telemetry.failures).toHaveLength(1);
  });

  test('rejects oversized provider audio before SDK result materialization', async () => {
    let providerCalls = 0;
    const telemetry = recordingTelemetry();
    const oversized = new Uint8Array(AI_MAX_SPEECH_OUTPUT_BYTES + 1);

    await expect(executeAISpeech({ text: 'Hello.', maxRetries: 0 }, {
      model: speechModel(async () => {
        providerCalls += 1;
        return speechResponse(oversized);
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

  test('detaches generated speech from provider-owned buffers', async () => {
    const providerAudio = new Uint8Array([1, 2, 3]);
    const result = await executeAISpeech({ text: 'Hello.' }, {
      model: speechModel(async () => speechResponse(providerAudio)),
      requestTelemetry: recordingTelemetry().service,
    });
    providerAudio[0] = 9;
    expect(result.audio.uint8Array).toEqual(new Uint8Array([1, 2, 3]));
  });
});

function transcriptionModel(
  doGenerate: (
    options: TranscriptionModelV4CallOptions,
  ) => Promise<TranscriptionModelV4Result>,
): TranscriptionModelV4 {
  return {
    specificationVersion: 'v4',
    provider: 'test.transcription',
    modelId: 'transcription-test',
    doGenerate,
  };
}

function transcriptionResponse(
  overrides: Partial<TranscriptionModelV4Result> = {},
): TranscriptionModelV4Result {
  return {
    text: 'Transcript.',
    segments: [],
    language: 'en',
    durationInSeconds: 1,
    warnings: [],
    response: {
      timestamp: new Date('2026-10-04T12:00:00.000Z'),
      modelId: 'transcription-test',
      headers: {},
    },
    ...overrides,
  };
}

function speechModel(
  doGenerate: (options: SpeechModelV4CallOptions) => Promise<SpeechModelV4Result>,
): SpeechModelV4 {
  return {
    specificationVersion: 'v4',
    provider: 'test.speech',
    modelId: 'speech-test',
    doGenerate,
  };
}

function speechResponse(audio: Uint8Array): SpeechModelV4Result {
  return {
    audio,
    warnings: [],
    response: {
      timestamp: new Date('2026-10-04T12:00:00.000Z'),
      modelId: 'speech-test',
      headers: {},
    },
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
