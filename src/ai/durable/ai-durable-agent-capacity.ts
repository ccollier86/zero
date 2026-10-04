/**
 * ai-durable-agent-capacity.ts
 *
 * Enforces the bridge's explicit private-state contract before Torrent's
 * lower-level memory/runtime ceilings. It performs accounting only and never
 * executes models, tools, or workflow transitions.
 */

import type { WorkflowMemoryContext } from '../../workflows/workflow-memory-context';
import {
  serializeWorkflowJson,
  workflowJsonBytes,
  type WorkflowJsonValue,
} from '../../workflows/workflow-json-value';
import { AIError } from '../ai-errors';
import type { AnyAIAgentDefinition } from '../agents/ai-agent-definition';
import {
  estimateAIDurableEncodedStorage,
} from './ai-durable-agent-memory';
import {
  AI_DURABLE_AGENT_MAX_CONTEXT_AND_TOOL_BYTES,
  AI_DURABLE_AGENT_MAX_PRIVATE_STATE_BYTES,
  AI_DURABLE_AGENT_MAX_PRIVATE_STATE_ENTRIES,
} from './ai-durable-agent-limits';

export interface AIDurableCapacityReservation {
  readonly bytes: number;
  readonly entries: number;
}

/** Reject definitions whose declared durable payload envelope cannot fit. */
export function assertAIDurableDefinitionCapacity(
  definition: AnyAIAgentDefinition,
): void {
  if (definition.limits.maxContextBytes + definition.limits.maxTotalToolResultBytes
    > AI_DURABLE_AGENT_MAX_CONTEXT_AND_TOOL_BYTES) {
    throw new AIError(
      `Durable AI agent context and cumulative tool-result limits must total no more than ${AI_DURABLE_AGENT_MAX_CONTEXT_AND_TOOL_BYTES} bytes.`,
      'AI_AGENT_DEFINITION_INVALID',
      400,
    );
  }
}

/** Check a start-time seed before creating any workflow rows. */
export function assertAIDurableSeedCapacity(
  entries: Readonly<Record<string, WorkflowJsonValue>>,
): void {
  assertCapacity(Object.entries(entries), NO_RESERVATION, 'AI_AGENT_CONTEXT_INVALID', 413);
}

/** Check an activity overlay, optionally reserving every pending tool result. */
export function assertAIDurableMemoryCapacity(
  memory: Pick<WorkflowMemoryContext, 'entries'>,
  reservation: AIDurableCapacityReservation = NO_RESERVATION,
): void {
  assertCapacity(
    memory.entries(),
    reservation,
    'AI_AGENT_EXECUTION_LIMIT_EXCEEDED',
    429,
  );
}

/**
 * Reserve the worst persisted size of every result before any selected tool
 * can run. This makes parallel commits safe even though their attempt-local
 * snapshots were created together.
 */
export function reserveAIDurableToolResults(
  calls: readonly Readonly<{
    index: number;
    toolCallId: string;
    toolName: string;
    resultByteLimit: number;
  }>[],
): AIDurableCapacityReservation {
  let bytes = 0;
  let entries = 0;
  for (const call of calls) {
    const outputBytes = call.resultByteLimit;
    const shell = {
      index: call.index,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      output: null,
      bytes: outputBytes,
    };
    const shellBytes = workflowJsonBytes(serializeWorkflowJson(shell));
    // Replace the four-byte `null` placeholder with the maximum canonical
    // output payload, then retain a small fixed margin for object punctuation.
    const estimate = estimateAIDurableEncodedStorage(
      Math.max(1, shellBytes - 4 + outputBytes + 64),
    );
    bytes += estimate.bytes;
    entries += estimate.entries;
  }
  return { bytes, entries };
}

function assertCapacity(
  entries: readonly (readonly [string, WorkflowJsonValue])[],
  reservation: AIDurableCapacityReservation,
  code: 'AI_AGENT_CONTEXT_INVALID' | 'AI_AGENT_EXECUTION_LIMIT_EXCEEDED',
  status: 413 | 429,
): void {
  let bytes = reservation.bytes;
  for (const [, value] of entries) {
    bytes += workflowJsonBytes(serializeWorkflowJson(value));
    if (bytes > AI_DURABLE_AGENT_MAX_PRIVATE_STATE_BYTES) throw exceeded(code, status);
  }
  if (entries.length + reservation.entries > AI_DURABLE_AGENT_MAX_PRIVATE_STATE_ENTRIES) {
    throw exceeded(code, status);
  }
}

function exceeded(
  code: 'AI_AGENT_CONTEXT_INVALID' | 'AI_AGENT_EXECUTION_LIMIT_EXCEEDED',
  status: 413 | 429,
): AIError {
  return new AIError(
    `Durable AI agent private state exceeded ${AI_DURABLE_AGENT_MAX_PRIVATE_STATE_BYTES} bytes or ${AI_DURABLE_AGENT_MAX_PRIVATE_STATE_ENTRIES} entries.`,
    code,
    status,
  );
}

const NO_RESERVATION: AIDurableCapacityReservation = Object.freeze({ bytes: 0, entries: 0 });
