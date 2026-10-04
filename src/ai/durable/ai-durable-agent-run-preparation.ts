/**
 * ai-durable-agent-run-preparation.ts
 *
 * Validates and normalizes one durable-agent invocation into Torrent's public
 * envelope and private initial memory. It does not start or inspect workflows.
 */

import type { ModelMessage } from 'ai';

import { normalizeWorkflowJson } from '../../workflows/workflow-json-value';
import { AIError } from '../ai-errors';
import { resolveAIAgentRunContexts } from '../agents/ai-agent-context';
import type { AnyAIAgentDefinition } from '../agents/ai-agent-definition';
import type { AIAgentReference } from '../agents/ai-agent-types';
import { assertAIDurableSeedCapacity } from './ai-durable-agent-capacity';
import { createAIDurableMemorySeed } from './ai-durable-agent-memory';
import { AI_DURABLE_MEMORY_KEYS } from './ai-durable-agent-state';
import type {
  AIDurableAgentPublicEnvelope,
  AIDurableAgentRunInput,
  RegisteredAIDurableAgent,
} from './ai-durable-agent-types';
import { AI_DURABLE_AGENT_STATE_VERSION } from './ai-durable-agent-types';
import type { AIDurableAgentWorkflowRuntime } from './ai-durable-agent-workflow';

interface AIDurablePreparedRun {
  readonly descriptor: RegisteredAIDurableAgent;
  readonly publicInput: AIDurableAgentPublicEnvelope;
  readonly initialMemory: Readonly<Record<string, unknown>>;
}

/** Prepare a version-pinned run without exposing its private invocation data. */
export async function prepareAIDurableAgentRun<EXECUTION_CONTEXT, TServices>(
  runtime: AIDurableAgentWorkflowRuntime<EXECUTION_CONTEXT, TServices>,
  reference: AIAgentReference | RegisteredAIDurableAgent,
  input: AIDurableAgentRunInput<any, any, any>,
  now: Date,
): Promise<AIDurablePreparedRun> {
  const identity = 'definition' in reference ? reference.definition : reference;
  const descriptor = runtime.require(identity.name, identity.version);
  const definition = descriptor.definition as AnyAIAgentDefinition;
  const contexts = await resolveAIAgentRunContexts(
    definition,
    input.runtimeContext,
    input.toolsContext,
  );
  const messages = normalizeMessages(input);
  const deadlineAt = durableDeadline(definition, now);
  const publicInput: AIDurableAgentPublicEnvelope = Object.freeze({
    kind: 'zero.ai.durable-agent',
    stateVersion: AI_DURABLE_AGENT_STATE_VERSION,
    agent: Object.freeze({ name: definition.name, version: definition.version }),
  });
  const context = normalizePrivateState({
    runtimeContext: contexts.runtimeContext,
    toolsContext: contexts.toolsContext,
  });
  const transcript = normalizePrivateState(messages);
  const initialMemory = Object.freeze({
    [AI_DURABLE_MEMORY_KEYS.meta]: {
      stateVersion: AI_DURABLE_AGENT_STATE_VERSION,
      agentName: definition.name,
      agentVersion: definition.version,
      deadlineAt,
    },
    [AI_DURABLE_MEMORY_KEYS.control]: {
      turn: 0,
      completed: false,
      approvalRequired: false,
      totalToolCalls: 0,
      totalToolResultBytes: 0,
      finishReason: null,
    },
    [AI_DURABLE_MEMORY_KEYS.lifecycle]: {
      version: 1,
      startedAt: null,
      terminal: null,
    },
    ...createAIDurableMemorySeed(AI_DURABLE_MEMORY_KEYS.context, context),
    ...createAIDurableMemorySeed(AI_DURABLE_MEMORY_KEYS.messages, transcript),
  });
  assertAIDurableSeedCapacity(initialMemory);
  return { descriptor, publicInput, initialMemory };
}

function normalizeMessages(input: AIDurableAgentRunInput<any, any, any>): ModelMessage[] {
  if ('messages' in input && input.messages !== undefined) return [...input.messages];
  if (typeof input.prompt === 'string') {
    return [{ role: 'user', content: input.prompt }];
  }
  return [...input.prompt];
}

function normalizePrivateState<T>(value: T): T {
  try {
    return normalizeWorkflowJson(value) as T;
  } catch (error) {
    if (error instanceof AIError) throw error;
    const wrapped = new AIError(
      'Durable AI agent input must contain JSON-safe data only.',
      'AI_AGENT_CONTEXT_INVALID',
      400,
    );
    Object.defineProperty(wrapped, 'cause', { value: error, configurable: true });
    throw wrapped;
  }
}

function durableDeadline(
  definition: AnyAIAgentDefinition,
  now: Date,
): string | null {
  const timeout = typeof definition.timeout === 'number'
    ? definition.timeout
    : definition.timeout?.totalMs;
  return timeout === undefined ? null : new Date(now.getTime() + timeout).toISOString();
}
