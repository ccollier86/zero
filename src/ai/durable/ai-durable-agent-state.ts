/**
 * ai-durable-agent-state.ts
 *
 * Owns durable-agent private key names, state validation, and safe public
 * summaries. It does not call models/tools or read the workflow database.
 */

import type { ModelMessage, ToolApprovalStatus } from 'ai';

import { AIError } from '../ai-errors';
import type { WorkflowMemoryContext } from '../../workflows/workflow-memory-context';
import type { WorkflowJsonValue } from '../../workflows/workflow-json-value';
import type {
  AIDurableAgentApprovalResponse,
  AIDurableAgentControlState,
  AIDurableAgentPrivateMeta,
  AIDurableAgentLifecycleState,
  AIDurableAgentModelToolOutput,
  AIDurableAgentResult,
  AIDurableAgentToolCall,
  AIDurableAgentToolCallReference,
  AIDurableAgentToolResult,
} from './ai-durable-agent-types';
import { AI_DURABLE_AGENT_STATE_VERSION } from './ai-durable-agent-types';
import {
  deleteAIDurableMemory,
  readAIDurableMemory,
} from './ai-durable-agent-memory';

export const AI_DURABLE_MEMORY_KEYS = Object.freeze({
  meta: 'zero.ai.meta',
  context: 'zero.ai.context',
  messages: 'zero.ai.messages',
  control: 'zero.ai.control',
  lifecycle: 'zero.ai.lifecycle',
  approvalRequest: 'zero.ai.approval.request',
  approvalDecision: 'zero.ai.approval.decision',
  result: 'zero.ai.result',
});

/** Validate the durable once-only lifecycle receipt. */
export function requireDurableLifecycleState(
  value: unknown,
): AIDurableAgentLifecycleState {
  if (!isJsonObject(value)
    || value.version !== 1
    || (value.startedAt !== null && !isIsoTimestamp(value.startedAt))
    || (value.terminal !== null && !isDurableTerminal(value.terminal))) {
    throw corrupt('lifecycle state');
  }
  return value as unknown as AIDurableAgentLifecycleState;
}

export interface AIDurableAgentStoredContext {
  readonly runtimeContext: Record<string, unknown>;
  readonly toolsContext: Record<string, Record<string, unknown>>;
}

export interface AIDurableAgentStoredResult {
  readonly output?: AIDurableAgentResult['output'];
  readonly text: string;
  readonly finishReason: string;
  readonly turns: number;
  readonly toolCalls: number;
}

/** Read and validate the private terminal value before returning or finalizing it. */
export function requireDurableStoredResult(
  memory: Pick<WorkflowMemoryContext, 'get'>,
): AIDurableAgentStoredResult {
  const result = readAIDurableMemory<unknown>(memory, AI_DURABLE_MEMORY_KEYS.result);
  if (!isJsonObject(result)
    || typeof result.text !== 'string'
    || typeof result.finishReason !== 'string'
    || !Number.isSafeInteger(result.turns)
    || Number(result.turns) < 1
    || !Number.isSafeInteger(result.toolCalls)
    || Number(result.toolCalls) < 0) {
    throw corrupt('final result');
  }
  return result as unknown as AIDurableAgentStoredResult;
}

/** Exact private prefix for one model-selected tool call. */
export function durableToolCallKey(turn: number, index: number): string {
  return `zero.ai.turn.${turn}.call.${index}`;
}

/** Exact private prefix for one tool result. */
export function durableToolResultKey(turn: number, index: number): string {
  return `zero.ai.turn.${turn}.result.${index}`;
}

/** Small direct-memory key holding fan-out references for the current turn. */
export function durableToolReferencesKey(turn: number): string {
  return `zero.ai.turn.${turn}.refs`;
}

/** Validate and return the immutable agent identity stored with a run. */
export function requireDurableMeta(memory: WorkflowMemoryContext): AIDurableAgentPrivateMeta {
  const value = memory.get(AI_DURABLE_MEMORY_KEYS.meta);
  if (!isJsonObject(value)
    || value.stateVersion !== AI_DURABLE_AGENT_STATE_VERSION
    || typeof value.agentName !== 'string'
    || typeof value.agentVersion !== 'string'
    || (value.deadlineAt !== null
      && (typeof value.deadlineAt !== 'string'
        || !Number.isFinite(Date.parse(value.deadlineAt))
        || new Date(Date.parse(value.deadlineAt)).toISOString() !== value.deadlineAt))) {
    throw corrupt('agent metadata');
  }
  return value as unknown as AIDurableAgentPrivateMeta;
}

/** Validate and return the current control state. */
export function requireDurableControl(
  memory: Pick<WorkflowMemoryContext, 'get'>,
): AIDurableAgentControlState {
  const value = memory.get(AI_DURABLE_MEMORY_KEYS.control);
  if (!isJsonObject(value)
    || !Number.isSafeInteger(value.turn)
    || Number(value.turn) < 0
    || typeof value.completed !== 'boolean'
    || typeof value.approvalRequired !== 'boolean'
    || !Number.isSafeInteger(value.totalToolCalls)
    || Number(value.totalToolCalls) < 0
    || !Number.isSafeInteger(value.totalToolResultBytes)
    || Number(value.totalToolResultBytes) < 0
    || (value.finishReason !== null && typeof value.finishReason !== 'string')) {
    throw corrupt('control state');
  }
  return value as unknown as AIDurableAgentControlState;
}

/** Read the validated private runtime/tool context snapshot. */
export function requireDurableContext(
  memory: WorkflowMemoryContext,
): AIDurableAgentStoredContext {
  const value = readAIDurableMemory<AIDurableAgentStoredContext>(
    memory,
    AI_DURABLE_MEMORY_KEYS.context,
  );
  if (!isJsonObject(value)
    || !isJsonObject(value.runtimeContext)
    || !isJsonObject(value.toolsContext)) {
    throw corrupt('runtime context');
  }
  return value;
}

/** Read the private model transcript. */
export function requireDurableMessages(memory: WorkflowMemoryContext): ModelMessage[] {
  const messages = readAIDurableMemory<unknown>(memory, AI_DURABLE_MEMORY_KEYS.messages);
  if (!Array.isArray(messages)) throw corrupt('model messages');
  return messages as ModelMessage[];
}

/** Read a small, private fan-out reference array. */
export function requireToolReferences(
  memory: WorkflowMemoryContext,
  turn: number,
): AIDurableAgentToolCallReference[] {
  const value = memory.get(durableToolReferencesKey(turn));
  if (!Array.isArray(value)) throw corrupt('tool references');
  const indexes = new Set<number>();
  const references = value.map((entry) => {
    if (!isJsonObject(entry)
      || !Number.isSafeInteger(entry.index)
      || Number(entry.index) < 0
      || indexes.has(Number(entry.index))
      || entry.key !== durableToolCallKey(turn, Number(entry.index))) {
      throw corrupt('tool reference');
    }
    indexes.add(Number(entry.index));
    return { index: Number(entry.index), key: entry.key };
  });
  return references;
}

/** Read and validate one private model-selected tool call. */
export function requireToolCall(
  memory: WorkflowMemoryContext,
  turn: number,
  index: number,
): AIDurableAgentToolCall {
  const call = readAIDurableMemory<unknown>(
    memory,
    durableToolCallKey(turn, index),
  );
  if (!isJsonObject(call)
    || call.index !== index
    || typeof call.toolCallId !== 'string'
    || typeof call.toolName !== 'string'
    || !Number.isSafeInteger(call.resultByteLimit)
    || Number(call.resultByteLimit) < 1
    || !['approved', 'denied', 'user-approval'].includes(String(call.approval))
    || (call.approvalReason !== undefined && typeof call.approvalReason !== 'string')) {
    throw corrupt('tool call');
  }
  return call as unknown as AIDurableAgentToolCall;
}

/** Read and validate one private tool result. */
export function requireToolResult(
  memory: WorkflowMemoryContext,
  turn: number,
  index: number,
): AIDurableAgentToolResult {
  const result = readAIDurableMemory<unknown>(
    memory,
    durableToolResultKey(turn, index),
  );
  if (!isJsonObject(result)
    || result.index !== index
    || typeof result.toolCallId !== 'string'
    || typeof result.toolName !== 'string'
    || !Number.isSafeInteger(result.bytes)
    || Number(result.bytes) < 0
    || !isToolResultOutput(result.output)) {
    throw corrupt('tool result');
  }
  return result as unknown as AIDurableAgentToolResult;
}

/** Delete one turn's transient calls/results after folding them into messages. */
export function clearDurableTurn(
  memory: WorkflowMemoryContext,
  turn: number,
  references: readonly AIDurableAgentToolCallReference[],
): void {
  memory.delete(durableToolReferencesKey(turn));
  for (const reference of references) {
    deleteAIDurableMemory(memory, durableToolCallKey(turn, reference.index));
    deleteAIDurableMemory(memory, durableToolResultKey(turn, reference.index));
  }
  memory.delete(AI_DURABLE_MEMORY_KEYS.approvalRequest);
  memory.delete(AI_DURABLE_MEMORY_KEYS.approvalDecision);
}

/** Normalize SDK approval statuses into the durable three-state policy. */
export function normalizeDurableApproval(status: ToolApprovalStatus): {
  approval: AIDurableAgentToolCall['approval'];
  reason?: string;
} {
  const type = typeof status === 'string' || status === undefined
    ? status ?? 'not-applicable'
    : status.type;
  const reason = typeof status === 'object' && status !== null ? status.reason : undefined;
  return {
    approval: type === 'denied' ? 'denied'
      : type === 'user-approval' ? 'user-approval'
        : 'approved',
    ...(reason === undefined ? {} : { reason }),
  };
}

/** Validate the safe interaction response before recording it in private state. */
export function requireApprovalResponse(value: unknown): AIDurableAgentApprovalResponse {
  if (!isJsonObject(value)
    || typeof value.approved !== 'boolean'
    || (value.reason !== undefined
      && (typeof value.reason !== 'string' || value.reason.length > 512))) {
    throw new AIError(
      'Durable AI agent approval response is invalid.',
      'AI_AGENT_EXECUTION_FAILED',
      500,
    );
  }
  return {
    approved: value.approved,
    ...(value.reason === undefined ? {} : { reason: value.reason }),
  };
}

function isToolResultOutput(value: unknown): value is AIDurableAgentModelToolOutput {
  if (!isJsonObject(value) || typeof value.type !== 'string') return false;
  if (value.type === 'text' || value.type === 'error-text') {
    return typeof value.value === 'string';
  }
  if (value.type === 'json' || value.type === 'error-json') {
    return value.value !== undefined;
  }
  return value.type === 'execution-denied'
    && (value.reason === undefined || typeof value.reason === 'string');
}

function isJsonObject(value: unknown): value is Record<string, WorkflowJsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isDurableTerminal(value: unknown): boolean {
  if (!isJsonObject(value)
    || !['completed', 'failed', 'cancelled'].includes(String(value.status))
    || !isIsoTimestamp(value.at)) return false;
  if (value.status === 'completed') return value.error === undefined;
  return isJsonObject(value.error)
    && typeof value.error.code === 'string'
    && typeof value.error.message === 'string';
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value;
}

function corrupt(label: string): AIError {
  return new AIError(
    `Durable AI agent ${label} is invalid.`,
    'AI_AGENT_EXECUTION_FAILED',
    500,
  );
}
