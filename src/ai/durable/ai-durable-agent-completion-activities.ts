/**
 * ai-durable-agent-completion-activities.ts
 *
 * Records accepted approvals, folds private tool results into the transcript,
 * and terminates bounded durable-agent runs. Model/tool execution lives in
 * dedicated activities.
 */

import type { ModelMessage, ToolResultPart } from 'ai';

import type { StepContext } from '../../workflows/types';
import { AIError } from '../ai-errors';
import { AIDurableAgentActivityRuntime } from './ai-durable-agent-activity-runtime';
import {
  durableStateError,
  requireAIDurableMemory,
  requireAIDurableTurn,
  type AIDurableTurnInput,
} from './ai-durable-agent-activity-validation';
import { writeAIDurableMemory } from './ai-durable-agent-memory';
import {
  AI_DURABLE_MEMORY_KEYS,
  clearDurableTurn,
  requireApprovalResponse,
  requireDurableControl,
  requireDurableMessages,
  requireDurableMeta,
  requireDurableStoredResult,
  requireToolReferences,
  requireToolResult,
} from './ai-durable-agent-state';
import type { AIDurableAgentApprovalResponse } from './ai-durable-agent-types';
import { assertAIDurableMemoryCapacity } from './ai-durable-agent-capacity';

/** Non-model/tool activities sharing one trusted runtime. */
export class AIDurableAgentCompletionActivities<EXECUTION_CONTEXT, TServices> {
  constructor(
    private readonly runtime: AIDurableAgentActivityRuntime<EXECUTION_CONTEXT, TServices>,
  ) {}

  /** Persist Torrent's idempotently accepted interaction decision privately. */
  readonly recordApproval = async (
    ctx: StepContext<AIDurableAgentApprovalResponse, TServices>,
  ) => {
    const memory = requireAIDurableMemory(ctx);
    const meta = requireDurableMeta(memory);
    const control = requireDurableControl(memory);
    const decision = requireApprovalResponse(ctx.input);
    await this.runtime.createLiveContext(
      ctx,
      control.turn,
      'approval',
      `workflow:${ctx.instanceId}:approval:${control.turn}`,
    );
    ctx.assertCurrentAuthority();
    memory.set(AI_DURABLE_MEMORY_KEYS.approvalDecision, decision);
    assertAIDurableMemoryCapacity(memory);
    return {
      turn: control.turn,
      recorded: true,
      approved: decision.approved,
      agent: `${meta.agentName}@${meta.agentVersion}`,
    };
  };

  /** Fold private fan-out results into the next private model transcript. */
  readonly assemble = async (ctx: StepContext<AIDurableTurnInput, TServices>) => {
    const memory = requireAIDurableMemory(ctx);
    const turn = requireAIDurableTurn(ctx.input);
    const meta = requireDurableMeta(memory);
    const definition = this.runtime.requireDefinition(meta.agentName, meta.agentVersion);
    const control = requireDurableControl(memory);
    if (control.turn !== turn) throw durableStateError('assembly turn');
    const references = requireToolReferences(memory, turn);
    const messages = requireDurableMessages(memory);
    let turnBytes = 0;

    if (references.length > 0) {
      const content = references.map((reference) => {
        const result = requireToolResult(memory, turn, reference.index);
        turnBytes += result.bytes;
        return {
          type: 'tool-result' as const,
          toolCallId: result.toolCallId,
          toolName: result.toolName,
          output: result.output,
        } as ToolResultPart;
      });
      if (control.totalToolResultBytes + turnBytes
        > definition.limits.maxTotalToolResultBytes) {
        throw new AIError(
          `Durable AI agent tool results exceeded ${definition.limits.maxTotalToolResultBytes} total bytes.`,
          'AI_AGENT_EXECUTION_LIMIT_EXCEEDED',
          429,
        );
      }
      writeAIDurableMemory(
        memory,
        AI_DURABLE_MEMORY_KEYS.messages,
        [...messages, { role: 'tool', content } satisfies ModelMessage],
      );
    }
    clearDurableTurn(memory, turn, references);
    memory.set(AI_DURABLE_MEMORY_KEYS.control, {
      ...control,
      turn: control.completed ? turn : turn + 1,
      approvalRequired: false,
      totalToolResultBytes: control.totalToolResultBytes + turnBytes,
    });
    assertAIDurableMemoryCapacity(memory);
    return { turn, toolCallCount: references.length, completed: control.completed };
  };

  /** Complete the public workflow with a payload-free summary. */
  readonly finalize = async (ctx: StepContext<AIDurableTurnInput, TServices>) => {
    const memory = requireAIDurableMemory(ctx);
    const meta = requireDurableMeta(memory);
    this.runtime.requireDefinition(meta.agentName, meta.agentVersion);
    const result = requireDurableStoredResult(memory);
    await this.runtime.createLiveContext(
      ctx,
      requireAIDurableTurn(ctx.input),
      'finalize',
      `workflow:${ctx.instanceId}:finalize`,
    );
    ctx.assertCurrentAuthority();
    return { completed: true, turns: result.turns, toolCalls: result.toolCalls };
  };

  /** Fail closed when the code-owned definition's decision budget is exhausted. */
  readonly exhaust = async (ctx: StepContext<AIDurableTurnInput, TServices>) => {
    const memory = requireAIDurableMemory(ctx);
    const turn = requireAIDurableTurn(ctx.input);
    const meta = requireDurableMeta(memory);
    const definition = this.runtime.requireDefinition(meta.agentName, meta.agentVersion);
    await this.runtime.createLiveContext(
      ctx,
      turn,
      'finalize',
      `workflow:${ctx.instanceId}:exhaust`,
    );
    ctx.assertCurrentAuthority();
    const error = new AIError(
      `Durable AI agent exceeded its ${definition.limits.maxSteps}-step limit.`,
      'AI_AGENT_EXECUTION_LIMIT_EXCEEDED',
      429,
    );
    throw error;
  };
}
