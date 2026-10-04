import { describe, expect, test } from 'bun:test';

import { MemoryEventStore } from '../observability/memory-event-store';
import { emitPlatformCodeTo } from '../observability/sink';
import type { PlatformObservabilityRuntime } from '../observability/types';
import { emitAIAgentLifecycle } from './agents/ai-agent-observability';
import { AIError } from './ai-errors';
import { emitAIStepStarted } from './ai-generation-lifecycle-events';
import {
  emitAIRequestCompleted,
  emitAIRequestFailed,
  emitAIRequestStarted,
  emitAIToolFailed,
  type AIEmitCode,
} from './ai-observability';

describe('AI observability safety', () => {
  test('replaces request and tool failures with stable secret-safe errors', () => {
    const { emitCode, store } = createEmitter();
    const providerError = new Error('provider echoed private prompt and api-key-secret');
    providerError.stack = 'private-provider-stack api-key-secret';
    const zeroError = new AIError(
      'private timeout detail api-key-secret',
      'AI_REQUEST_TIMEOUT',
      504,
    );

    emitAIRequestFailed(providerError, { providerId: 'test' }, emitCode);
    emitAIToolFailed(zeroError, { capability: 'tools' }, emitCode);
    const agentError = new Error('private agent failure api-key-secret');
    agentError.name = 'private-agent-error-name';
    emitAIAgentLifecycle({
      type: 'run.failed',
      name: 'safe-agent',
      version: '1',
      runId: 'run-secret-safe',
      error: agentError,
    }, undefined, emitCode);

    const [requestEvent, toolEvent, agentEvent] = store.query().events;
    expect(requestEvent?.error).toMatchObject({
      name: 'Error',
      message: 'AI request failed.',
    });
    expect(requestEvent?.metadata).toMatchObject({
      providerId: 'test',
      reason: 'Error',
    });
    expect(toolEvent?.error).toMatchObject({
      name: 'AIError',
      message: 'AI tool execution failed.',
    });
    expect(toolEvent?.metadata).toMatchObject({
      capability: 'tools',
      reason: 'AI_REQUEST_TIMEOUT',
    });
    expect(agentEvent?.error).toMatchObject({
      name: 'Error',
      message: 'AI agent lifecycle operation failed.',
    });
    expect(String((requestEvent?.error as Error | undefined)?.stack))
      .not.toContain('private-provider-stack');
    expect(JSON.stringify(store.query().events)).not.toContain('api-key-secret');
  });

  test('keeps hostile metadata and a failing emitter from changing AI behavior', async () => {
    const { emitCode, store } = createEmitter();
    const hostile: Record<string, unknown> = { correlationId: 'not-observed' };
    Object.defineProperty(hostile, 'throwing', {
      enumerable: true,
      get() {
        throw new Error('private getter value');
      },
    });

    expect(() => emitAIRequestStarted({ metadata: hostile }, emitCode)).not.toThrow();
    expect(store.query().events[0]?.metadata).toEqual({ _sanitizationFailed: true });

    const throwingEmitter: AIEmitCode = () => {
      throw new Error('sink failed');
    };
    const rejectingEmitter: AIEmitCode = () => Promise.reject(new Error('sink rejected'));
    expect(() => emitAIRequestStarted({}, throwingEmitter)).not.toThrow();
    expect(() => emitAIRequestStarted({}, rejectingEmitter)).not.toThrow();
    expect(() => emitAIStepStarted({ callId: 'call-1', stepNumber: 0 }, throwingEmitter))
      .not.toThrow();
    expect(() => emitAIStepStarted({ callId: 'call-2', stepNumber: 0 }, rejectingEmitter))
      .not.toThrow();
    expect(() => emitAIAgentLifecycle({
      type: 'run.started',
      name: 'safe-agent',
      version: '1',
      runId: 'run-1',
    }, undefined, throwingEmitter)).not.toThrow();
    expect(() => emitAIAgentLifecycle({
      type: 'run.started',
      name: 'safe-agent',
      version: '1',
      runId: 'run-2',
    }, undefined, rejectingEmitter)).not.toThrow();
    await Promise.resolve();
  });

  test('bounds canonical identifiers, tool arrays, and numeric usage fields', () => {
    const { emitCode, store } = createEmitter();
    const oversized = 'm'.repeat(2_000);
    const toolNames = [
      'safe-tool',
      'authorization-secret=private-value',
      'sk-proj-abcdefghijklmnopqrstuv',
      oversized,
      ...Array.from({ length: 25 }, (_, index) => `tool-${index}`),
    ];

    emitAIRequestCompleted({
      providerId: oversized,
      providerType: 'custom',
      requestedModel: 'api-key=private-model-key',
      model: oversized,
      capability: 'text',
      reason: oversized,
      durationMs: Number.NaN,
      inputTokens: -1,
      outputTokens: Number.POSITIVE_INFINITY,
      totalTokens: 9,
      toolNames,
    }, emitCode);

    const [event] = store.query().events;
    expect(String(event?.metadata?.providerId).length).toBeLessThan(600);
    expect(String(event?.metadata?.model).length).toBeLessThan(600);
    expect(String(event?.metadata?.reason).length).toBeLessThan(600);
    expect(event?.metadata?.requestedModel).toBe('[redacted]');
    expect(event?.metadata).not.toHaveProperty('durationMs');
    expect(event?.metadata).not.toHaveProperty('inputTokens');
    expect(event?.metadata).not.toHaveProperty('outputTokens');
    expect(event?.metadata?.totalTokens).toBe(9);
    expect(event?.metadata?.toolNames).toHaveLength(21);
    expect((event?.metadata?.toolNames as string[])[1]).toBe('[redacted]');
    expect((event?.metadata?.toolNames as string[])[2]).toBe('[redacted]');
    expect((event?.metadata?.toolNames as string[])[3].length).toBeLessThan(600);
    expect((event?.metadata?.toolNames as string[]).at(-1)).toBe('[truncated]');
    expect(JSON.stringify(event?.metadata)).not.toContain('private-model-key');
    expect(JSON.stringify(event?.metadata)).not.toContain('private-value');
    expect(JSON.stringify(event?.metadata)).not.toContain('sk-proj-abcdefghijklmnopqrstuv');
  });
});

function createEmitter(): {
  readonly store: MemoryEventStore;
  readonly emitCode: AIEmitCode;
} {
  const store = new MemoryEventStore();
  const runtime: PlatformObservabilityRuntime = {
    config: { console: false, store },
    sink: store,
    store,
  };
  return {
    store,
    emitCode: (definition, options) => emitPlatformCodeTo(runtime, definition, options),
  };
}
