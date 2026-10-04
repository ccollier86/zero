/**
 * ai-durable-agent-approval.ts
 *
 * Resolves declarative and callback approval policies for one durable tool
 * call. It never opens interactions; Torrent owns that persisted boundary.
 */

import type { ModelMessage, ToolApprovalStatus } from 'ai';

import { AIError } from '../ai-errors';
import type { AnyAIAgentDefinition } from '../agents/ai-agent-definition';
import {
  assertAIAgentApprovalRule,
  isAIAgentApprovalStatusObject,
} from '../agents/ai-agent-approval-status';
import type { AIAgentToolDefinition } from '../agents/ai-agent-tool';
import {
  normalizeDurableApproval,
  type AIDurableAgentStoredContext,
} from './ai-durable-agent-state';
import { durableStateError } from './ai-durable-agent-activity-validation';

interface ResolveDurableApprovalOptions<EXECUTION_CONTEXT> {
  readonly definition: AnyAIAgentDefinition;
  readonly call: { toolCallId: string; toolName: string; input: unknown };
  readonly messages: readonly ModelMessage[];
  readonly storedContext: AIDurableAgentStoredContext;
  readonly executionContext: EXECUTION_CONTEXT;
  readonly runId: string;
  readonly assertCurrentAuthority: () => void;
}

/** Resolve one live approval policy immediately behind an authority fence. */
export async function resolveDurableToolApproval<EXECUTION_CONTEXT>(
  input: ResolveDurableApprovalOptions<EXECUTION_CONTEXT>,
): Promise<ReturnType<typeof normalizeDurableApproval>> {
  const { definition, call } = input;
  const toolDefinition = ownAIAgentTool(definition, call.toolName);
  if (!toolDefinition) throw durableStateError(`tool ${call.toolName}`);
  const policy = definition.approval;
  let rule: unknown;

  input.assertCurrentAuthority();
  if (typeof policy === 'function') {
    rule = await policy({
      name: definition.name,
      version: definition.version,
      runId: input.runId,
      toolCall: call,
      messages: input.messages,
      runtimeContext: input.storedContext.runtimeContext,
      toolsContext: input.storedContext.toolsContext,
      executionContext: input.executionContext,
    } as never);
  } else if (policy !== undefined && isApprovalStatus(policy)) {
    rule = policy;
  } else {
    rule = policy && Object.prototype.hasOwnProperty.call(policy, call.toolName)
      ? (policy as Record<string, unknown>)[call.toolName]
      : toolDefinition.approval;
    if (typeof rule === 'function') {
      rule = await rule(call.input, {
        name: definition.name,
        version: definition.version,
        runId: input.runId,
        toolName: call.toolName,
        toolCallId: call.toolCallId,
        messages: input.messages,
        runtimeContext: input.storedContext.runtimeContext,
        toolContext: input.storedContext.toolsContext[call.toolName] ?? {},
        executionContext: input.executionContext,
      });
    }
  }
  input.assertCurrentAuthority();
  try {
    assertAIAgentApprovalRule(rule, 'AI agent approval result');
  } catch (error) {
    const wrapped = new AIError(
      'Durable AI agent approval policy returned an invalid decision.',
      'AI_AGENT_EXECUTION_FAILED',
      500,
    );
    Object.defineProperty(wrapped, 'cause', { value: error, configurable: true });
    throw wrapped;
  }
  return normalizeDurableApproval(rule as ToolApprovalStatus);
}

/** Resolve only an own, declared tool property. */
export function ownAIAgentTool(
  definition: AnyAIAgentDefinition,
  name: string,
): AIAgentToolDefinition | undefined {
  return Object.prototype.hasOwnProperty.call(definition.tools, name)
    ? definition.tools[name]
    : undefined;
}

function isApprovalStatus(value: unknown): value is ToolApprovalStatus {
  return value === undefined
    || typeof value === 'string'
    || isAIAgentApprovalStatusObject(value);
}
