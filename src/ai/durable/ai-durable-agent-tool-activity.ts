/**
 * ai-durable-agent-tool-activity.ts
 *
 * Executes one private Torrent fan-out item behind a fresh Guardian authority
 * fence. It owns tool timeout/output validation, not fan-out scheduling.
 */

import { validateTypes } from '@ai-sdk/provider-utils';

import type { StepContext } from '../../workflows/types';
import {
  normalizeWorkflowJson,
  serializeWorkflowJson,
  workflowJsonBytes,
} from '../../workflows/workflow-json-value';
import { AIError } from '../ai-errors';
import type { AnyAIAgentDefinition } from '../agents/ai-agent-definition';
import type { AIAgentToolDefinition } from '../agents/ai-agent-tool';
import { ownAIAgentTool } from './ai-durable-agent-approval';
import { AIDurableAgentActivityRuntime } from './ai-durable-agent-activity-runtime';
import {
  isObject,
  requireAIDurableMemory,
  requireAIDurableToolReference,
} from './ai-durable-agent-activity-validation';
import { writeAIDurableMemory } from './ai-durable-agent-memory';
import {
  AI_DURABLE_MEMORY_KEYS,
  durableToolResultKey,
  requireDurableContext,
  requireDurableControl,
  requireDurableMessages,
  requireDurableMeta,
  requireToolCall,
} from './ai-durable-agent-state';
import type {
  AIDurableAgentModelToolOutput,
  AIDurableAgentToolCallReference,
  AIDurableAgentToolResult,
} from './ai-durable-agent-types';
import { assertAIDurableMemoryCapacity } from './ai-durable-agent-capacity';

/** One authority-fenced tool side-effect handler. */
export class AIDurableAgentToolActivity<EXECUTION_CONTEXT, TServices> {
  constructor(
    private readonly runtime: AIDurableAgentActivityRuntime<EXECUTION_CONTEXT, TServices>,
  ) {}

  readonly execute = async (
    ctx: StepContext<AIDurableAgentToolCallReference, TServices>,
  ) => {
    const memory = requireAIDurableMemory(ctx);
    const reference = requireAIDurableToolReference(ctx.input);
    const meta = requireDurableMeta(memory);
    const control = requireDurableControl(memory);
    const definition = this.runtime.requireDefinition(meta.agentName, meta.agentVersion);
    const call = requireToolCall(memory, control.turn, reference.index);
    const toolDefinition = ownAIAgentTool(definition, call.toolName) as AIAgentToolDefinition<
      unknown,
      unknown,
      Record<string, unknown>,
      Record<string, unknown>,
      EXECUTION_CONTEXT
    > | undefined;
    if (!toolDefinition) {
      throw new AIError(
        `Durable AI agent tool is unavailable: ${call.toolName}.`,
        'AI_AGENT_TOOL_EXECUTION_FAILED',
        500,
      );
    }
    this.runtime.assertWithinDeadline(meta.deadlineAt);
    const storedContext = requireDurableContext(memory);
    const executionContext = await this.runtime.createLiveContext(
      ctx,
      control.turn,
      'tool',
      `workflow:${ctx.instanceId}:tool:${control.turn}:${call.toolCallId}`,
      call,
    );

    const decision = memory.get(AI_DURABLE_MEMORY_KEYS.approvalDecision);
    const denied = call.approval === 'denied'
      || (call.approval === 'user-approval'
        && (!isObject(decision) || decision.approved !== true));
    const startedAt = performance.now();
    this.runtime.emit({
      type: 'tool.started', name: definition.name, version: definition.version,
      runId: ctx.instanceId, stepNumber: control.turn,
      attempt: ctx.attempt,
      toolName: call.toolName, toolCallId: call.toolCallId,
    });

    try {
      let output: AIDurableAgentModelToolOutput;
      let bytes = 0;
      if (denied) {
        const reason = call.approval === 'denied'
          ? call.approvalReason
          : isObject(decision) && typeof decision.reason === 'string'
            ? decision.reason
            : 'Approval was denied.';
        output = { type: 'execution-denied', ...(reason ? { reason } : {}) };
        bytes = serializedToolOutputBytes(output);
      } else {
        ctx.assertCurrentAuthority();
        const value = await runDurableToolWithTimeout(
          (abortSignal) => toolDefinition.execute(call.input, {
            name: definition.name,
            version: definition.version,
            runId: ctx.instanceId,
            toolName: call.toolName,
            toolCallId: call.toolCallId,
            messages: requireDurableMessages(memory),
            runtimeContext: storedContext.runtimeContext,
            toolContext: storedContext.toolsContext[call.toolName] ?? {},
            executionContext,
            abortSignal,
          }),
          resolveToolTimeout(definition, call.toolName, meta.deadlineAt, this.runtime.now()),
          ctx.signal,
        );
        ctx.assertCurrentAuthority();
        if (toolDefinition.outputSchema !== undefined) {
          await validateTypes({
            value,
            schema: toolDefinition.outputSchema,
            context: { field: `tools.${call.toolName}.output` },
          });
        }
        const normalized = normalizeToolOutput(value, call.toolName);
        output = normalized.output;
        bytes = normalized.bytes;
      }
      if (bytes > call.resultByteLimit) {
        throw new AIError(
          `Durable AI agent tool result exceeded its ${call.resultByteLimit}-byte reserved capacity.`,
          'AI_AGENT_EXECUTION_LIMIT_EXCEEDED',
          429,
        );
      }
      const result: AIDurableAgentToolResult = {
        index: call.index,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output,
        bytes,
      };
      writeAIDurableMemory(
        memory,
        durableToolResultKey(control.turn, reference.index),
        result,
      );
      assertAIDurableMemoryCapacity(memory);
      this.runtime.emit({
        type: 'tool.completed', name: definition.name, version: definition.version,
        runId: ctx.instanceId, stepNumber: control.turn,
        attempt: ctx.attempt,
        toolName: call.toolName, toolCallId: call.toolCallId,
        durationMs: performance.now() - startedAt,
      });
      return { turn: control.turn, index: call.index, completed: true };
    } catch (error) {
      const normalized = normalizeToolError(error, call.toolName, ctx.signal);
      this.runtime.emit({
        type: 'tool.failed', name: definition.name, version: definition.version,
        runId: ctx.instanceId, stepNumber: control.turn,
        attempt: ctx.attempt,
        toolName: call.toolName, toolCallId: call.toolCallId,
        durationMs: performance.now() - startedAt, error: normalized,
      });
      throw normalized;
    }
  };
}

function normalizeToolOutput(
  value: unknown,
  toolName: string,
): { output: AIDurableAgentModelToolOutput; bytes: number } {
  if (typeof value === 'string') {
    const output = { type: 'text' as const, value };
    return {
      output,
      bytes: serializedToolOutputBytes(output),
    };
  }
  try {
    const normalized = normalizeWorkflowJson(value);
    const output = { type: 'json' as const, value: normalized };
    return {
      output,
      bytes: serializedToolOutputBytes(output),
    };
  } catch (error) {
    throw normalizeToolError(error, toolName);
  }
}

function serializedToolOutputBytes(output: AIDurableAgentModelToolOutput): number {
  return workflowJsonBytes(serializeWorkflowJson(output));
}

function resolveToolTimeout(
  definition: AnyAIAgentDefinition,
  toolName: string,
  deadlineAt: string | null,
  now: Date,
): number | undefined {
  const configured = definition.timeout;
  const tool = typeof configured === 'object'
    ? configured.tools?.[`${toolName}Ms`] ?? configured.toolMs
    : undefined;
  const remaining = deadlineAt === null
    ? undefined
    : Math.max(1, Date.parse(deadlineAt) - now.getTime());
  if (tool === undefined) return remaining;
  return remaining === undefined ? tool : Math.min(tool, remaining);
}

async function runDurableToolWithTimeout<T>(
  operation: (signal: AbortSignal | undefined) => T | PromiseLike<T>,
  timeoutMs: number | undefined,
  parentSignal?: AbortSignal,
): Promise<T> {
  if (parentSignal?.aborted) throw parentSignal.reason;
  const controller = new AbortController();
  let rejectParentAbort: ((reason?: unknown) => void) | undefined;
  const abortFromParent = () => {
    controller.abort(parentSignal?.reason);
    rejectParentAbort?.(parentSignal?.reason);
  };
  parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const races: Promise<T>[] = [Promise.resolve().then(() => operation(
    timeoutMs === undefined ? parentSignal : controller.signal,
  ))];

  if (timeoutMs !== undefined) {
    races.push(new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        const error = new AIError(
          'Durable AI agent tool execution timed out.',
          'AI_AGENT_EXECUTION_TIMEOUT',
          504,
        );
        controller.abort(error);
        reject(error);
      }, timeoutMs);
    }));
  }
  if (parentSignal) {
    races.push(new Promise<T>((_, reject) => {
      rejectParentAbort = reject;
    }));
  }
  try {
    return await Promise.race(races);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

function normalizeToolError(
  error: unknown,
  toolName: string,
  signal?: AbortSignal,
): AIError {
  if (error instanceof AIError) return error;
  if (signal?.aborted && signal.reason instanceof AIError) return signal.reason;
  const wrapped = new AIError(
    `Durable AI agent tool failed: ${toolName}.`,
    'AI_AGENT_TOOL_EXECUTION_FAILED',
    500,
  );
  Object.defineProperty(wrapped, 'cause', { value: error, configurable: true });
  return wrapped;
}
