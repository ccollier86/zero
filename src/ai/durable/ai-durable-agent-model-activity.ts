/**
 * ai-durable-agent-model-activity.ts
 *
 * Executes exactly one durable model decision and stages its private transcript
 * and tool-call state. It does not execute tools or schedule the next node.
 */

import {
  generateText,
  stepCountIs,
  tool as defineSDKTool,
  type ModelMessage,
  type TimeoutConfiguration,
  type ToolSet,
} from 'ai';

import type { StepContext } from '../../workflows/types';
import { AIError } from '../ai-errors';
import type { AnyAIAgentDefinition } from '../agents/ai-agent-definition';
import type { AIAgentToolDefinition } from '../agents/ai-agent-tool';
import { resolveDurableToolApproval } from './ai-durable-agent-approval';
import { AIDurableAgentActivityRuntime } from './ai-durable-agent-activity-runtime';
import {
  requireAIDurableMemory,
  requireAIDurableTurn,
  type AIDurableTurnInput,
} from './ai-durable-agent-activity-validation';
import { writeAIDurableMemory } from './ai-durable-agent-memory';
import {
  AI_DURABLE_MEMORY_KEYS,
  durableToolCallKey,
  durableToolReferencesKey,
  requireDurableContext,
  requireDurableControl,
  requireDurableMessages,
  requireDurableMeta,
  type AIDurableAgentStoredResult,
} from './ai-durable-agent-state';
import type {
  AIDurableAgentControlState,
  AIDurableAgentToolCall,
  AIDurableAgentToolCallReference,
} from './ai-durable-agent-types';
import {
  assertAIDurableMemoryCapacity,
  reserveAIDurableToolResults,
} from './ai-durable-agent-capacity';
import { allocateAIDurableToolResultBudgets } from './ai-durable-agent-tool-budget';
import type { AIPreparedModelExecution } from '../ai-model-execution';

/** One authority-fenced model decision handler. */
export class AIDurableAgentModelActivity<EXECUTION_CONTEXT, TServices> {
  constructor(
    private readonly runtime: AIDurableAgentActivityRuntime<EXECUTION_CONTEXT, TServices>,
  ) {}

  readonly execute = async (ctx: StepContext<AIDurableTurnInput, TServices>) => {
    const memory = requireAIDurableMemory(ctx);
    const turn = requireAIDurableTurn(ctx.input);
    const meta = requireDurableMeta(memory);
    const definition = this.runtime.requireDefinition(meta.agentName, meta.agentVersion);
    const control = requireDurableControl(memory);
    if (control.turn !== turn || control.completed) {
      throw durableModelError('Durable AI agent model turn is invalid.');
    }
    this.runtime.assertWithinDeadline(meta.deadlineAt);

    this.runtime.emit({
      type: 'step.started', name: definition.name, version: definition.version,
      runId: ctx.instanceId, stepNumber: turn, attempt: ctx.attempt,
    });

    let prepared: AIPreparedModelExecution | undefined;
    try {
      const storedContext = requireDurableContext(memory);
      const messages = requireDurableMessages(memory);
      const executionContext = await this.runtime.createLiveContext(
        ctx,
        turn,
        'model',
        `workflow:${ctx.instanceId}:model:${turn}`,
      );
      ctx.assertCurrentAuthority();
      const timeout = resolveModelTimeout(definition, meta.deadlineAt, this.runtime.now());
      const toolNames = Object.keys(definition.tools);
      prepared = await this.runtime.prepareModelExecution(definition, {
        messages,
        toolNames,
        abortSignal: ctx.signal,
        timeout,
        metadata: {
          agentName: definition.name,
          agentVersion: definition.version,
          durableRunId: ctx.instanceId,
          durableTurn: turn,
        },
      });
      ctx.assertCurrentAuthority();
      const lifecycle = prepared.lifecycle;
      const result = await generateText({
        model: prepared.model,
        instructions: definition.instructions,
        messages,
        tools: materializeDecisionTools(definition),
        output: definition.output,
        stopWhen: stepCountIs(1),
        abortSignal: ctx.signal,
        timeout,
        experimental_download: prepared.download,
        onStepStart: lifecycle.onStepStart,
        onLanguageModelCallStart: lifecycle.onLanguageModelCallStart,
        onLanguageModelCallEnd: lifecycle.onLanguageModelCallEnd,
        onToolExecutionStart: lifecycle.onToolExecutionStart,
        onToolExecutionEnd: lifecycle.onToolExecutionEnd,
        onStepEnd: lifecycle.onStepEnd,
        maxRetries: definition.maxRetries,
        maxOutputTokens: definition.maxOutputTokens,
        temperature: definition.temperature,
        topP: definition.topP,
        topK: definition.topK,
        presencePenalty: definition.presencePenalty,
        frequencyPenalty: definition.frequencyPenalty,
        stopSequences: definition.stopSequences === undefined
          ? undefined
          : [...definition.stopSequences],
        seed: definition.seed,
        reasoning: definition.reasoning,
        providerOptions: definition.providerOptions,
      });
      prepared.complete({ usage: result.usage, toolNames });
      ctx.assertCurrentAuthority();

      const calls = result.toolCalls;
      assertToolCallBudget(definition, control, calls.length);
      assertUniqueToolCalls(calls);
      const resultBudgets = allocateAIDurableToolResultBudgets(
        definition,
        calls.length,
        control.totalToolResultBytes,
      );
      writeAIDurableMemory(
        memory,
        AI_DURABLE_MEMORY_KEYS.messages,
        [...messages, ...result.responseMessages] as ModelMessage[],
      );

      const references: AIDurableAgentToolCallReference[] = [];
      const approvalRequest: Array<{
        toolCallId: string;
        toolName: string;
        reason?: string;
      }> = [];
      for (const [index, call] of calls.entries()) {
        const approval = await resolveDurableToolApproval({
          definition,
          call: { toolCallId: call.toolCallId, toolName: call.toolName, input: call.input },
          messages,
          storedContext,
          executionContext,
          runId: ctx.instanceId,
          assertCurrentAuthority: ctx.assertCurrentAuthority,
        });
        const durableCall: AIDurableAgentToolCall = {
          index,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: call.input,
          resultByteLimit: resultBudgets[index]!,
          approval: approval.approval,
          ...(approval.reason === undefined ? {} : { approvalReason: approval.reason }),
        };
        const key = durableToolCallKey(turn, index);
        writeAIDurableMemory(memory, key, durableCall);
        references.push({ index, key });
        if (approval.approval === 'user-approval') {
          approvalRequest.push({
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            ...(approval.reason === undefined ? {} : { reason: approval.reason }),
          });
        }
      }
      memory.set(durableToolReferencesKey(turn), references);
      memory.set(AI_DURABLE_MEMORY_KEYS.approvalRequest, {
        turn,
        calls: approvalRequest,
      });

      const completed = calls.length === 0;
      const nextControl: AIDurableAgentControlState = {
        ...control,
        turn,
        completed,
        approvalRequired: approvalRequest.length > 0,
        totalToolCalls: control.totalToolCalls + calls.length,
        finishReason: completed ? String(result.finishReason) : null,
      };
      memory.set(AI_DURABLE_MEMORY_KEYS.control, nextControl);
      if (completed) {
        const stored: AIDurableAgentStoredResult = {
          ...(definition.output === undefined ? {} : { output: result.output }),
          text: result.text,
          finishReason: String(result.finishReason),
          turns: turn + 1,
          toolCalls: nextControl.totalToolCalls,
        };
        writeAIDurableMemory(memory, AI_DURABLE_MEMORY_KEYS.result, stored);
      }

      assertAIDurableMemoryCapacity(
        memory,
        reserveAIDurableToolResults(
          calls.map((call, index) => ({
            index,
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            resultByteLimit: resultBudgets[index]!,
          })),
        ),
      );

      return {
        turn,
        completed,
        toolCallCount: calls.length,
        approvalRequired: approvalRequest.length > 0,
      };
    } catch (error) {
      const normalized = normalizeDurableModelError(error, ctx.signal);
      prepared?.fail(normalized);
      throw normalized;
    }
  };
}

function materializeDecisionTools(definition: AnyAIAgentDefinition): ToolSet {
  const tools = Object.create(null) as ToolSet;
  const definitions = definition.tools as Record<string, AIAgentToolDefinition>;
  for (const [name, item] of Object.entries(definitions)) {
    tools[name] = defineSDKTool<unknown, Record<string, never>>({
      description: item.description,
      inputSchema: item.inputSchema,
    });
  }
  return tools;
}

function resolveModelTimeout(
  definition: AnyAIAgentDefinition,
  deadlineAt: string | null,
  now: Date,
): TimeoutConfiguration<ToolSet> | undefined {
  const configured = definition.timeout;
  const remaining = deadlineAt === null
    ? undefined
    : Math.max(1, Date.parse(deadlineAt) - now.getTime());
  if (configured === undefined) {
    return remaining === undefined ? undefined : { totalMs: remaining };
  }
  if (typeof configured === 'number') {
    return { totalMs: remaining ?? configured, stepMs: configured };
  }
  return {
    ...configured,
    ...(remaining === undefined
      ? {}
      : { totalMs: Math.min(configured.totalMs ?? remaining, remaining) }),
  };
}

function assertToolCallBudget(
  definition: AnyAIAgentDefinition,
  control: AIDurableAgentControlState,
  count: number,
): void {
  if (count > definition.limits.maxToolCallsPerStep
    || control.totalToolCalls + count > definition.limits.maxToolCalls) {
    throw new AIError(
      'Durable AI agent exceeded its configured tool-call limit.',
      'AI_AGENT_EXECUTION_LIMIT_EXCEEDED',
      429,
    );
  }
}

function assertUniqueToolCalls(
  calls: readonly { toolCallId: string; toolName: string }[],
): void {
  const ids = new Set<string>();
  for (const call of calls) {
    if (!call.toolCallId
      || call.toolCallId.length > 512
      || ids.has(call.toolCallId)
      || !call.toolName
      || call.toolName.length > 128) {
      throw new AIError(
        'AI provider returned invalid or duplicate tool-call identities.',
        'AI_PROVIDER_RESPONSE_INVALID',
        502,
      );
    }
    ids.add(call.toolCallId);
  }
}

function normalizeDurableModelError(error: unknown, signal?: AbortSignal): AIError {
  if (error instanceof AIError) return error;
  if (signal?.aborted && signal.reason instanceof AIError) return signal.reason;
  if (isTimeoutError(error)) {
    const timeout = new AIError(
      'Durable AI agent model decision timed out.',
      'AI_AGENT_EXECUTION_TIMEOUT',
      504,
    );
    Object.defineProperty(timeout, 'cause', { value: error, configurable: true });
    return timeout;
  }
  const wrapped = durableModelError('Durable AI agent model decision failed.');
  Object.defineProperty(wrapped, 'cause', { value: error, configurable: true });
  return wrapped;
}

function isTimeoutError(error: unknown, seen = new Set<object>()): boolean {
  if (error === null || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  if ('name' in error && error.name === 'TimeoutError') return true;
  return 'cause' in error && isTimeoutError(error.cause, seen);
}

function durableModelError(message: string): AIError {
  return new AIError(message, 'AI_AGENT_EXECUTION_FAILED', 500);
}
