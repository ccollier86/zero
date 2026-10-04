/**
 * ai-agent-budget.ts
 *
 * Accounts for bounded work during one ephemeral agent run. This module owns
 * counters and serialized-size admission only; it does not execute tools or
 * choose models.
 */

import { AIError } from '../ai-errors';
import type { ResolvedAIAgentLimits } from './ai-agent-limits';
import { snapshotAIAgentJSON } from './ai-agent-json';

/** Mutable, run-local budget shared by the runner and materialized tools. */
export class AIAgentExecutionBudget {
  private stepNumber = -1;
  private toolCalls = 0;
  private toolCallsInStep = 0;
  private totalToolResultBytes = 0;
  private failure: AIError | null = null;

  constructor(
    private readonly limits: ResolvedAIAgentLimits,
    private readonly onExceeded: (error: AIError) => void,
  ) {}

  /** Admit a model step and reset its per-step tool counter. */
  beginStep(stepNumber: number): void {
    if (!Number.isSafeInteger(stepNumber) || stepNumber < 0) {
      this.exceed('AI agent emitted an invalid step number.');
    }
    if (stepNumber + 1 > this.limits.maxSteps) {
      this.exceed(`AI agent exceeded its ${this.limits.maxSteps}-step limit.`);
    }
    this.stepNumber = stepNumber;
    this.toolCallsInStep = 0;
  }

  /** Admit a tool side effect before its handler is invoked. */
  beginToolCall(): void {
    if (this.failure) throw this.failure;
    if (this.stepNumber < 0) {
      this.exceed('AI agent attempted a tool call outside an active step.');
    }
    if (this.toolCalls + 1 > this.limits.maxToolCalls) {
      this.exceed(`AI agent exceeded its ${this.limits.maxToolCalls}-tool-call limit.`);
    }
    if (this.toolCallsInStep + 1 > this.limits.maxToolCallsPerStep) {
      this.exceed(`AI agent exceeded its ${this.limits.maxToolCallsPerStep}-tool-call per-step limit.`);
    }
    this.toolCalls += 1;
    this.toolCallsInStep += 1;
  }

  /** Admit one tool result before returning it to the model. */
  recordToolResult<T>(value: T): T {
    let snapshot: ReturnType<typeof snapshotAIAgentJSON<T>>;
    try {
      snapshot = snapshotAIAgentJSON(
        value,
        'AI agent tool result',
        'AI_AGENT_EXECUTION_LIMIT_EXCEEDED',
      );
    } catch (error) {
      this.exceed(error instanceof Error
        ? error.message
        : 'AI agent tool result must contain only JSON data.');
    }
    const bytes = snapshot.bytes;
    if (bytes > this.limits.maxToolResultBytes) {
      this.exceed(`AI agent tool result exceeded ${this.limits.maxToolResultBytes} bytes.`);
    }
    if (this.totalToolResultBytes + bytes > this.limits.maxTotalToolResultBytes) {
      this.exceed(`AI agent tool results exceeded ${this.limits.maxTotalToolResultBytes} total bytes.`);
    }
    this.totalToolResultBytes += bytes;
    return snapshot.value;
  }

  /** Return the first terminal budget failure, if one occurred. */
  get exceeded(): AIError | null {
    return this.failure;
  }

  /** Current zero-based model step, used only for lifecycle correlation. */
  get currentStepNumber(): number {
    return this.stepNumber;
  }

  private exceed(message: string): never {
    const error = this.failure ?? new AIError(
      message,
      'AI_AGENT_EXECUTION_LIMIT_EXCEEDED',
      429,
    );
    this.failure = error;
    this.onExceeded(error);
    throw error;
  }
}

/** Reject context that is cyclic, non-serializable, or over its byte budget. */
export function assertAIAgentContextSize(
  value: unknown,
  label: string,
  maxBytes: number,
): void {
  const { bytes } = snapshotAIAgentJSON(value, label, 'AI_AGENT_CONTEXT_INVALID');
  if (bytes > maxBytes) {
    throw new AIError(
      `${label} exceeded ${maxBytes} bytes.`,
      'AI_AGENT_CONTEXT_INVALID',
      413,
    );
  }
}
