/**
 * ai-durable-agent-activity-validation.ts
 *
 * Validates the small payloads passed between Torrent durable-agent nodes.
 * It owns no model, tool, authority, or persistence behavior.
 */

import { AIError } from '../ai-errors';
import type { StepContext } from '../../workflows/types';
import type { WorkflowMemoryContext } from '../../workflows/workflow-memory-context';
import type { AIDurableAgentToolCallReference } from './ai-durable-agent-types';

export interface AIDurableTurnInput {
  readonly turn: number;
}

/** Require Torrent scratch memory for one graph activity. */
export function requireAIDurableMemory(ctx: StepContext): WorkflowMemoryContext {
  if (!ctx.memory) throw durableStateError('scratch memory');
  return ctx.memory;
}

/** Validate the bounded turn envelope compiled into the graph. */
export function requireAIDurableTurn(value: unknown): number {
  if (!isObject(value) || !Number.isSafeInteger(value.turn) || Number(value.turn) < 0) {
    throw durableStateError('turn input');
  }
  return Number(value.turn);
}

/** Validate one private fan-out reference without reading its tool input. */
export function requireAIDurableToolReference(
  value: unknown,
): AIDurableAgentToolCallReference {
  if (!isObject(value)
    || !Number.isSafeInteger(value.index)
    || Number(value.index) < 0
    || typeof value.key !== 'string') {
    throw durableStateError('tool reference');
  }
  return { index: Number(value.index), key: value.key };
}

/** Create a stable, non-secret durable-state error. */
export function durableStateError(label: string): AIError {
  return new AIError(
    `Durable AI agent ${label} is invalid.`,
    'AI_AGENT_EXECUTION_FAILED',
    500,
  );
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
