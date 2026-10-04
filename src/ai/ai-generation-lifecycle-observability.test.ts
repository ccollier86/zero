import { afterEach, describe, expect, test } from 'bun:test';
import { generateText } from 'ai';
import { APICallError } from '@ai-sdk/provider';

import { MemoryEventStore, OBS_CODES, configureObservability } from '../observability';
import {
  composeAIGenerationLifecycleCallbacks,
  composeAIStreamErrorCallback,
} from './ai-generation-lifecycle-observability';

afterEach(() => {
  configureObservability({ console: false });
});

describe('AI generation lifecycle observability', () => {
  test('emits correlated content-free step, model, and tool events', async () => {
    const store = configuredStore();
    const seen: unknown[] = [];
    const callbacks = composeAIGenerationLifecycleCallbacks({
      onStepStart(event) { seen.push(event); },
      onLanguageModelCallStart(event) { seen.push(event); },
      onLanguageModelCallEnd(event) { seen.push(event); },
      onToolExecutionStart(event) { seen.push(event); },
      onToolExecutionEnd(event) { seen.push(event); },
      onStepEnd(event) { seen.push(event); },
    });
    const usage = testUsage();
    const privateValue = 'private-patient-payload';
    const stepStart = {
      callId: 'call_1',
      stepNumber: 2,
      messages: [{ role: 'user', content: privateValue }],
      runtimeContext: { secret: privateValue },
      headers: { authorization: privateValue },
      providerOptions: { test: { secret: privateValue } },
    };
    const modelStart = {
      callId: 'call_1',
      messages: [{ role: 'user', content: privateValue }],
      tools: [{ inputSchema: privateValue }],
    };
    const modelEnd = {
      callId: 'call_1',
      finishReason: 'stop',
      usage,
      content: [{ type: 'text', text: privateValue }],
      performance: { responseTimeMs: 18 },
    };
    const toolStart = {
      callId: 'call_1',
      messages: [{ role: 'user', content: privateValue }],
      toolCall: { toolCallId: 'tool_1', toolName: 'lookup', input: privateValue },
      toolContext: { secret: privateValue },
    };
    const toolEnd = {
      ...toolStart,
      toolExecutionMs: 7,
      toolOutput: {
        type: 'tool-error',
        error: new Error(privateValue),
        input: privateValue,
        toolCallId: 'tool_1',
        toolName: 'lookup',
      },
    };
    const stepEnd = {
      callId: 'call_1',
      stepNumber: 2,
      finishReason: 'stop',
      usage,
      text: privateValue,
      runtimeContext: { secret: privateValue },
      performance: { stepTimeMs: 31 },
    };

    await callbacks.onStepStart(stepStart as never);
    await callbacks.onLanguageModelCallStart(modelStart as never);
    await callbacks.onLanguageModelCallEnd(modelEnd as never);
    await callbacks.onToolExecutionStart(toolStart as never);
    await callbacks.onToolExecutionEnd(toolEnd as never);
    await callbacks.onStepEnd(stepEnd as never);

    expect(seen).toEqual([stepStart, modelStart, modelEnd, toolStart, toolEnd, stepEnd]);
    expect(store.query().events.map(event => event.code)).toEqual([
      OBS_CODES.AI_STEP_STARTED.code,
      OBS_CODES.AI_MODEL_CALL_STARTED.code,
      OBS_CODES.AI_MODEL_CALL_COMPLETED.code,
      OBS_CODES.AI_TOOL_STARTED.code,
      OBS_CODES.AI_TOOL_FAILED.code,
      OBS_CODES.AI_STEP_COMPLETED.code,
    ]);
    expect(store.query({ code: OBS_CODES.AI_MODEL_CALL_COMPLETED.code }).events[0]?.metadata)
      .toEqual({
        callId: 'call_1',
        stepNumber: 2,
        durationMs: 18,
        inputTokens: 11,
        outputTokens: 5,
        totalTokens: 16,
        cacheReadTokens: 3,
        cacheWriteTokens: 2,
        reasoningTokens: 1,
      });
    expect(store.query({ code: OBS_CODES.AI_TOOL_FAILED.code }).events[0]?.metadata)
      .toEqual({
        callId: 'call_1',
        stepNumber: 2,
        toolCallId: 'tool_1',
        toolName: 'lookup',
        durationMs: 7,
      });
    expect(JSON.stringify(store.query().events)).not.toContain(privateValue);
  });

  test('classifies model and step error finish reasons as failures', async () => {
    const store = configuredStore();
    const callbacks = composeAIGenerationLifecycleCallbacks({});
    const usage = testUsage();

    await callbacks.onStepStart({ callId: 'call_error', stepNumber: 0 } as never);
    await callbacks.onLanguageModelCallStart({ callId: 'call_error' } as never);
    await callbacks.onLanguageModelCallEnd({
      callId: 'call_error',
      finishReason: 'error',
      usage,
      performance: { responseTimeMs: 4 },
    } as never);
    await callbacks.onStepEnd({
      callId: 'call_error',
      stepNumber: 0,
      finishReason: 'error',
      usage,
      performance: { stepTimeMs: 5 },
    } as never);

    expect(store.query({ code: OBS_CODES.AI_MODEL_CALL_FAILED.code }).count).toBe(1);
    expect(store.query({ code: OBS_CODES.AI_STEP_FAILED.code }).count).toBe(1);
    expect(store.query({ code: OBS_CODES.AI_MODEL_CALL_COMPLETED.code }).count).toBe(0);
    expect(store.query({ code: OBS_CODES.AI_STEP_COMPLETED.code }).count).toBe(0);
  });

  test('propagates caller callback errors after recording the reached boundary', async () => {
    const store = configuredStore();
    const expected = new Error('caller callback failed');
    const callbacks = composeAIGenerationLifecycleCallbacks({
      onStepStart() {
        throw expected;
      },
    });

    let received: unknown;
    try {
      await callbacks.onStepStart({ callId: 'call_callback', stepNumber: 0 } as never);
    } catch (error) {
      received = error;
    }

    expect(received).toBe(expected);
    expect(store.query({ code: OBS_CODES.AI_STEP_STARTED.code }).count).toBe(1);
  });

  test('records one logical model lifecycle when the provider retries', async () => {
    const store = configuredStore();
    let attempts = 0;
    const callbacks = composeAIGenerationLifecycleCallbacks({});
    const model = {
      specificationVersion: 'v4' as const,
      provider: 'test',
      modelId: 'retry-model',
      supportedUrls: {},
      async doGenerate() {
        attempts += 1;
        if (attempts === 1) {
          throw new APICallError({
            message: 'temporary private provider failure',
            url: 'https://provider.example.test/generate',
            requestBodyValues: { prompt: 'private retry prompt' },
            statusCode: 503,
            responseHeaders: { 'retry-after-ms': '0' },
            responseBody: 'private provider response',
          });
        }
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

    const result = await generateText({
      model,
      prompt: 'private retry prompt',
      maxRetries: 1,
      ...callbacks,
    });

    expect(result.text).toBe('ok');
    expect(attempts).toBe(2);
    expect(store.query({ code: OBS_CODES.AI_MODEL_CALL_STARTED.code }).count).toBe(1);
    expect(store.query({ code: OBS_CODES.AI_MODEL_CALL_COMPLETED.code }).count).toBe(1);
    expect(store.query({ code: OBS_CODES.AI_MODEL_CALL_FAILED.code }).count).toBe(0);
    expect(store.query({ code: OBS_CODES.AI_STEP_STARTED.code }).count).toBe(1);
    expect(store.query({ code: OBS_CODES.AI_STEP_COMPLETED.code }).count).toBe(1);
    expect(JSON.stringify(store.query().events)).not.toContain('private retry prompt');
  });

  test('preserves recoverable stream error retry responses without terminal events', async () => {
    const store = configuredStore();
    const event = { error: new Error('private recoverable stream failure') };
    let received: unknown;
    const callback = composeAIStreamErrorCallback(async input => {
      received = input;
      return { retry: true };
    });

    const result = await callback?.(event);

    expect(received).toBe(event);
    expect(result).toEqual({ retry: true });
    expect(store.query({ category: 'ai' }).count).toBe(0);
  });
});

function configuredStore(): MemoryEventStore {
  const store = new MemoryEventStore();
  configureObservability({ console: false, store });
  return store;
}

function testUsage() {
  return {
    inputTokens: 11,
    inputTokenDetails: {
      noCacheTokens: 6,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
    },
    outputTokens: 5,
    outputTokenDetails: {
      textTokens: 4,
      reasoningTokens: 1,
    },
    totalTokens: 16,
    raw: { private: 'provider-private-usage' },
  };
}
