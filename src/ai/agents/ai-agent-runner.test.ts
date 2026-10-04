import { describe, expect, test } from 'bun:test';
import { Output } from 'ai';
import type { LanguageModelV4GenerateResult } from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';

import { defineAIAgent } from './ai-agent-definition';
import { AIAgentRunner } from './ai-agent-runner';
import { defineAIAgentTool } from './ai-agent-tool';
import type { AIAgentLifecycleEvent } from './ai-agent-types';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

describe('AI agent runner', () => {
  test('resolves Zero model aliases without coupling definitions to a provider', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: generated([{ type: 'text', text: 'resolved' }], 'stop'),
    });
    const definition = defineAIAgent({
      name: 'alias-backed',
      version: '1',
      model: '  smart  ',
      tools: {},
    });
    const references: string[] = [];
    const runner = new AIAgentRunner({
      resolveModel: (reference) => {
        references.push(reference);
        return model;
      },
    });

    const result = await runner.generate(definition, {
      prompt: 'Resolve the configured model.',
      runtimeContext: {},
      toolsContext: {},
    });

    expect(result.text).toBe('resolved');
    expect(references).toEqual(['smart']);
  });

  test('provides typed runtime/tool/execution context and structured output', async () => {
    type Runtime = { tenantId: string };
    type ToolContext = { prefix: string };
    type Execution = { lookup: (id: string) => string };
    const observed: AIAgentLifecycleEvent[] = [];
    let captured: unknown;

    const lookup = defineAIAgentTool<
      { id: string },
      { value: string },
      ToolContext,
      Runtime,
      Execution
    >({
      inputSchema: z.object({ id: z.string() }),
      outputSchema: z.object({ value: z.string() }),
      contextSchema: z.object({ prefix: z.string() }),
      execute: (input, context) => {
        captured = { input, context };
        return { value: `${context.toolContext.prefix}${context.executionContext.lookup(input.id)}` };
      },
    });
    const model = new MockLanguageModelV4({
      doGenerate: [
        generated([
          { type: 'tool-call', toolCallId: 'lookup-1', toolName: 'lookup', input: '{"id":"42"}' },
        ], 'tool-calls'),
        generated([{ type: 'text', text: '{"answer":"T-record-42"}' }], 'stop'),
      ],
    });
    const definition = defineAIAgent<Runtime, Execution, { lookup: typeof lookup }, ReturnType<typeof Output.object>>({
      name: 'records',
      version: '1',
      model,
      instructions: 'Use the lookup tool.',
      runtimeContextSchema: z.object({ tenantId: z.string() }),
      tools: { lookup },
      output: Output.object({ schema: z.object({ answer: z.string() }) }),
    });
    const runner = new AIAgentRunner({
      generateRunId: () => 'run-1',
      observer: (event) => {
        observed.push(event);
      },
    });

    const result = await runner.generate(definition, {
      prompt: 'Find record 42.',
      runtimeContext: { tenantId: 'tenant-1' },
      toolsContext: { lookup: { prefix: 'T-' } },
      executionContext: { lookup: (id) => `record-${id}` },
    });

    expect(result.output).toEqual({ answer: 'T-record-42' });
    expect(captured).toMatchObject({
      input: { id: '42' },
      context: {
        name: 'records',
        version: '1',
        runId: 'run-1',
        runtimeContext: { tenantId: 'tenant-1' },
        toolContext: { prefix: 'T-' },
      },
    });
    expect(observed.map((event) => event.type)).toEqual([
      'run.started',
      'step.started',
      'tool.started',
      'tool.completed',
      'step.started',
      'run.completed',
    ]);
  });

  test('requires signed approvals and emits an SDK HMAC signature', async () => {
    let executions = 0;
    const dangerous = defineAIAgentTool({
      inputSchema: z.object({ id: z.string() }),
      approval: { type: 'user-approval', reason: 'Destructive operation.' },
      execute: () => {
        executions += 1;
        return { ok: true };
      },
    });
    const definition = defineAIAgent({
      name: 'approval',
      version: '1',
      model: new MockLanguageModelV4({
        doGenerate: generated([
          { type: 'tool-call', toolCallId: 'danger-1', toolName: 'dangerous', input: '{"id":"1"}' },
        ], 'tool-calls'),
      }),
      tools: { dangerous },
    });
    const input = {
      prompt: 'Perform the operation.',
      runtimeContext: {},
      toolsContext: { dangerous: {} },
    } as const;

    await expect(new AIAgentRunner().generate(definition, input)).rejects.toMatchObject({
      code: 'AI_AGENT_APPROVAL_CONFIG_INVALID',
    });

    const result = await new AIAgentRunner({ approvalSecret: 'a'.repeat(32) }).generate(definition, input);
    const approval = result.content.find((part) => part.type === 'tool-approval-request');
    expect(approval).toMatchObject({
      type: 'tool-approval-request',
      toolCall: { toolCallId: 'danger-1', toolName: 'dangerous' },
    });
    expect(approval && 'signature' in approval ? approval.signature : undefined).toBeString();
    expect(executions).toBe(0);
  });

  test('aborts before tool side effects can exceed the configured budget', async () => {
    let executions = 0;
    const bounded = defineAIAgentTool({
      inputSchema: z.object({ id: z.number() }),
      execute: ({ id }) => {
        executions += 1;
        return { id };
      },
    });
    const definition = defineAIAgent({
      name: 'bounded',
      version: '1',
      model: new MockLanguageModelV4({
        doGenerate: generated([
          { type: 'tool-call', toolCallId: 'call-1', toolName: 'bounded', input: '{"id":1}' },
          { type: 'tool-call', toolCallId: 'call-2', toolName: 'bounded', input: '{"id":2}' },
        ], 'tool-calls'),
      }),
      tools: { bounded },
      limits: { maxToolCalls: 1, maxToolCallsPerStep: 1 },
    });

    await expect(new AIAgentRunner().generate(definition, {
      prompt: 'Call twice.',
      runtimeContext: {},
      toolsContext: { bounded: {} },
    })).rejects.toMatchObject({ code: 'AI_AGENT_EXECUTION_LIMIT_EXCEEDED' });
    expect(executions).toBe(1);
  });

  test('keeps provider and tool causes out of app lifecycle observers', async () => {
    const observed: AIAgentLifecycleEvent[] = [];
    const unsafe = defineAIAgentTool({
      inputSchema: z.object({}),
      execute: () => {
        throw new Error('private tool payload must not escape');
      },
    });
    const definition = defineAIAgent({
      name: 'safe-observer',
      version: '1',
      model: new MockLanguageModelV4({
        doGenerate: generated([
          { type: 'tool-call', toolCallId: 'unsafe-1', toolName: 'unsafe', input: '{}' },
        ], 'tool-calls'),
      }),
      tools: { unsafe },
      limits: { maxSteps: 1 },
    });

    await new AIAgentRunner({ observer: (event) => { observed.push(event); } }).generate(
      definition,
      { prompt: 'Run safely.', runtimeContext: {}, toolsContext: { unsafe: {} } },
    );

    const failures = observed.filter((event) => 'error' in event);
    expect(failures).toHaveLength(1);
    for (const failure of failures) {
      const error = failure.error as Error & { cause?: unknown };
      expect(error.cause).toBeUndefined();
      expect(error.message).not.toContain('private tool payload');
    }
  });

  test('validates tool output schemas before publishing a completed tool result', async () => {
    const invalid = defineAIAgentTool({
      inputSchema: z.object({}),
      outputSchema: z.object({ value: z.string() }),
      execute: () => ({ value: 42 }) as unknown as { value: string },
    });
    const definition = defineAIAgent({
      name: 'validated-tool-output',
      version: '1',
      model: new MockLanguageModelV4({
        doGenerate: generated([{
          type: 'tool-call',
          toolCallId: 'invalid-output-1',
          toolName: 'invalid',
          input: '{}',
        }], 'tool-calls'),
      }),
      tools: { invalid },
      limits: { maxSteps: 1 },
    });
    const observed: AIAgentLifecycleEvent[] = [];

    await new AIAgentRunner({ observer: (event) => { observed.push(event); } }).generate(
      definition,
      { prompt: 'Call the tool.', runtimeContext: {}, toolsContext: { invalid: {} } },
    );

    expect(observed.filter((event) => event.type === 'tool.failed')).toHaveLength(1);
    expect(observed.some((event) => event.type === 'tool.completed')).toBe(false);
  });

  test('settles a terminal streaming provider error as failed, never completed', async () => {
    const observed: AIAgentLifecycleEvent[] = [];
    const model = new MockLanguageModelV4({
      async doStream() {
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'stream-start', warnings: [] });
              controller.enqueue({
                type: 'error',
                error: new Error('private streaming provider failure'),
              });
              controller.close();
            },
          }),
        };
      },
    });
    const definition = defineAIAgent({
      name: 'stream-failure',
      version: '1',
      model,
      tools: {},
      limits: { maxSteps: 1 },
    });
    const result = await new AIAgentRunner({ observer: (event) => { observed.push(event); } }).stream(
      definition,
      { prompt: 'Stream safely.', runtimeContext: {}, toolsContext: {} },
    );

    await result.consumeStream();
    expect(await result.finishReason).toBe('error');
    await Promise.resolve();

    expect(observed.some((event) => event.type === 'run.failed')).toBe(true);
    expect(observed.some((event) => event.type === 'run.completed')).toBe(false);
    const failure = observed.find((event) => event.type === 'run.failed');
    expect(failure && 'error' in failure ? (failure.error as Error).message : '')
      .not.toContain('private streaming provider failure');
  });

  test('forwards total timeout policy and returns a stable timeout error', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: ({ abortSignal }) => new Promise((_, reject) => {
        if (!abortSignal) return reject(new Error('Missing timeout abort signal.'));
        if (abortSignal.aborted) return reject(abortSignal.reason);
        abortSignal.addEventListener('abort', () => reject(abortSignal.reason), { once: true });
      }),
    });
    const definition = defineAIAgent({
      name: 'timeout',
      version: '1',
      model,
      tools: {},
      timeout: { totalMs: 5, stepMs: 50, firstChunkMs: 50, chunkMs: 50, toolMs: 50 },
    });

    await expect(new AIAgentRunner().generate(definition, {
      prompt: 'Wait.',
      runtimeContext: {},
      toolsContext: {},
      timeout: { totalMs: 5 },
    })).rejects.toMatchObject({ code: 'AI_AGENT_EXECUTION_TIMEOUT', status: 504 });
  });

  test('classifies caller cancellation as cancelled and never failed or completed', async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const model = new MockLanguageModelV4({
      doGenerate: ({ abortSignal }) => new Promise((_, reject) => {
        markStarted();
        if (!abortSignal) return reject(new Error('Missing caller abort signal.'));
        if (abortSignal.aborted) return reject(abortSignal.reason);
        abortSignal.addEventListener('abort', () => reject(abortSignal.reason), { once: true });
      }),
    });
    const definition = defineAIAgent({
      name: 'caller-cancelled',
      version: '1',
      model,
      tools: {},
    });
    const observed: AIAgentLifecycleEvent[] = [];
    const controller = new AbortController();
    const run = new AIAgentRunner({ observer: (event) => { observed.push(event); } }).generate(
      definition,
      {
        prompt: 'Wait for cancellation.',
        runtimeContext: {},
        toolsContext: {},
        abortSignal: controller.signal,
      },
    );
    await started;
    controller.abort(new DOMException('cancelled by caller', 'AbortError'));

    await expect(run).rejects.toMatchObject({ code: 'AI_REQUEST_ABORTED', status: 499 });
    expect(observed.filter((event) => event.type === 'run.cancelled')).toHaveLength(1);
    expect(observed.some((event) => event.type === 'run.failed')).toBe(false);
    expect(observed.some((event) => event.type === 'run.completed')).toBe(false);
  });

  test('publishes structured-output parsing failures as failed, never completed', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: generated([{ type: 'text', text: '{"answer":42}' }], 'stop'),
    });
    const definition = defineAIAgent({
      name: 'invalid-structured-output',
      version: '1',
      model,
      tools: {},
      output: Output.object({ schema: z.object({ answer: z.string() }) }),
    });
    const observed: AIAgentLifecycleEvent[] = [];

    await expect(new AIAgentRunner({
      observer: (event) => { observed.push(event); },
    }).generate(definition, {
      prompt: 'Return a string answer.',
      runtimeContext: {},
      toolsContext: {},
    })).rejects.toMatchObject({ code: 'AI_AGENT_EXECUTION_FAILED' });
    expect(observed.filter((event) => event.type === 'run.failed')).toHaveLength(1);
    expect(observed.some((event) => event.type === 'run.completed')).toBe(false);
  });
});

function generated(
  content: LanguageModelV4GenerateResult['content'],
  reason: 'stop' | 'tool-calls',
): LanguageModelV4GenerateResult {
  return {
    content,
    finishReason: { unified: reason, raw: reason },
    usage,
    warnings: [],
  };
}
