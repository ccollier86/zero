/** Deterministic per-call shares of the cumulative durable tool-output budget. */

import { serializeWorkflowJson, workflowJsonBytes } from '../../workflows/workflow-json-value';
import { AIError } from '../ai-errors';
import type { AnyAIAgentDefinition } from '../agents/ai-agent-definition';

/** Smallest canonical tool output a successful tool can produce (`null`). */
export const AI_DURABLE_MIN_TOOL_RESULT_BYTES = workflowJsonBytes(serializeWorkflowJson({
  type: 'json',
  value: null,
}));

/**
 * Allocate the remaining cumulative budget before any parallel tool executes.
 * The shares are deterministic, individually bounded, and cannot oversubscribe
 * the run-wide contract when every call returns its maximum admitted result.
 */
export function allocateAIDurableToolResultBudgets(
  definition: AnyAIAgentDefinition,
  callCount: number,
  priorBytes: number,
): readonly number[] {
  if (!Number.isSafeInteger(callCount) || callCount < 0
    || !Number.isSafeInteger(priorBytes) || priorBytes < 0) throw invalidBudget();
  if (callCount === 0) return Object.freeze([]);
  let remaining = definition.limits.maxTotalToolResultBytes - priorBytes;
  if (remaining < callCount * AI_DURABLE_MIN_TOOL_RESULT_BYTES) throw exhausted();

  const result: number[] = [];
  for (let index = 0; index < callCount; index += 1) {
    const remainingCalls = callCount - index;
    const share = Math.min(
      definition.limits.maxToolResultBytes,
      Math.floor(remaining / remainingCalls),
    );
    if (share < AI_DURABLE_MIN_TOOL_RESULT_BYTES) throw exhausted();
    result.push(share);
    remaining -= share;
  }
  return Object.freeze(result);
}

function exhausted(): AIError {
  return new AIError(
    'Durable AI agent has insufficient cumulative tool-result capacity for this decision.',
    'AI_AGENT_EXECUTION_LIMIT_EXCEEDED',
    429,
  );
}

function invalidBudget(): AIError {
  return new AIError(
    'Durable AI agent tool-result accounting is invalid.',
    'AI_AGENT_EXECUTION_FAILED',
    500,
  );
}
