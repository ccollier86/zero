/**
 * ai-durable-agent-activity-runtime.ts
 *
 * Resolves immutable agent definitions, live execution context, models, and
 * secret-safe lifecycle events for Torrent activities. It does not call a
 * model/tool or persist durable state.
 */

import type { ModelMessage, TimeoutConfiguration, ToolSet } from 'ai';

import type { StepContext } from '../../workflows/types';
import { AIError } from '../ai-errors';
import type { AnyAIAgentDefinition } from '../agents/ai-agent-definition';
import { emitAIAgentLifecycle } from '../agents/ai-agent-observability';
import type { AIAgentLifecycleEvent } from '../agents/ai-agent-types';
import {
  prepareDirectAIModelExecution,
  type AIPreparedModelExecution,
} from '../ai-model-execution';
import type {
  AIDurableAgentLiveExecutionContext,
  AIDurableAgentRuntimeOptions,
  AIDurableAgentToolCall,
} from './ai-durable-agent-types';

/** Shared trusted dependencies used by the focused durable-agent activities. */
export class AIDurableAgentActivityRuntime<
  EXECUTION_CONTEXT = undefined,
  TServices = unknown,
> {
  readonly now: () => Date;

  constructor(
    private readonly options: AIDurableAgentRuntimeOptions<EXECUTION_CONTEXT, TServices>,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  requireDefinition(name: string, version: string): AnyAIAgentDefinition {
    return this.options.agents.require({ name, version });
  }

  /** Prepare one model call without exposing private messages to persistence. */
  async prepareModelExecution(
    definition: AnyAIAgentDefinition,
    input: Readonly<{
      messages: readonly ModelMessage[];
      toolNames: readonly string[];
      abortSignal?: AbortSignal;
      timeout?: TimeoutConfiguration<ToolSet>;
      metadata?: Record<string, unknown>;
    }>,
  ): Promise<AIPreparedModelExecution> {
    if (typeof definition.model === 'string' && this.options.prepareModelExecution) {
      return await this.options.prepareModelExecution({
        reference: definition.model,
        ...input,
      });
    }

    const model = typeof definition.model === 'string'
      ? this.options.resolveModel?.(definition.model)
      : definition.model;
    if (!model) {
      throw new AIError(
        'Durable AI agent model references require a Zero model execution preparer.',
        'AI_MODEL_NOT_CONFIGURED',
        503,
      );
    }
    return prepareDirectAIModelExecution({
      model,
      abortSignal: input.abortSignal,
      timeout: input.timeout,
      emitCode: this.options.emitCode,
    });
  }

  /** Rebuild live app services without persisting the returned authority object. */
  async createLiveContext(
    ctx: StepContext<unknown, TServices>,
    turn: number,
    phase: AIDurableAgentLiveExecutionContext<TServices>['phase'],
    idempotencyKey: string,
    call?: Pick<AIDurableAgentToolCall, 'toolName' | 'toolCallId'>,
  ): Promise<EXECUTION_CONTEXT> {
    ctx.assertCurrentAuthority();
    const live: AIDurableAgentLiveExecutionContext<TServices> = Object.freeze({
      runId: ctx.instanceId,
      phase,
      turn,
      ...(call ? { toolName: call.toolName, toolCallId: call.toolCallId } : {}),
      idempotencyKey,
      execution: ctx.execution,
      zero: ctx.zero as TServices | null,
      assertCurrentAuthority: ctx.assertCurrentAuthority,
    });
    const context = this.options.createExecutionContext
      ? await this.options.createExecutionContext(live)
      : undefined as EXECUTION_CONTEXT;
    ctx.assertCurrentAuthority();
    return context;
  }

  assertWithinDeadline(deadlineAt: string | null): void {
    if (deadlineAt !== null && this.now().getTime() >= Date.parse(deadlineAt)) {
      throw new AIError(
        'Durable AI agent execution timed out.',
        'AI_AGENT_EXECUTION_TIMEOUT',
        504,
      );
    }
  }

  emit(event: AIAgentLifecycleEvent): void {
    emitAIAgentLifecycle(event, this.options.observer, this.options.emitCode);
  }
}
