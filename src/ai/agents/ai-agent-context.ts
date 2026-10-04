/**
 * ai-agent-context.ts
 *
 * Validates and snapshots runtime/tool contexts before an agent run begins.
 * Execution services are intentionally outside this serializable data boundary.
 */

import { validateTypes } from '@ai-sdk/provider-utils';

import { AIError } from '../ai-errors';
import { snapshotAIAgentJSON } from './ai-agent-json';
import type { AIAgentDefinition } from './ai-agent-definition';
import type { AIAgentContext } from './ai-agent-types';
import type { AIAgentToolSet, AIAgentToolsContext } from './ai-agent-tool';

/** Validate schemas, reject unknown tool keys, and return frozen run snapshots. */
export async function resolveAIAgentRunContexts<
  RUNTIME_CONTEXT extends AIAgentContext,
  EXECUTION_CONTEXT,
  TOOLS extends AIAgentToolSet<RUNTIME_CONTEXT, EXECUTION_CONTEXT>,
>(
  definition: AIAgentDefinition<RUNTIME_CONTEXT, EXECUTION_CONTEXT, TOOLS, any>,
  runtimeContext: RUNTIME_CONTEXT,
  toolsContext: AIAgentToolsContext<TOOLS>,
): Promise<{
  readonly runtimeContext: Readonly<RUNTIME_CONTEXT>;
  readonly toolsContext: Readonly<AIAgentToolsContext<TOOLS>>;
}> {
  assertRecord(runtimeContext, 'AI agent runtime context');
  assertRecord(toolsContext, 'AI agent tools context');

  try {
    const runtime = definition.runtimeContextSchema === undefined
      ? runtimeContext
      : await validateTypes({
          value: runtimeContext,
          schema: definition.runtimeContextSchema,
          context: { field: 'runtimeContext' },
        });

    const knownTools = new Set(Object.keys(definition.tools));
    for (const key of Object.keys(toolsContext)) {
      if (!knownTools.has(key)) throw new Error(`Unknown tool context: ${key}.`);
    }

    const resolvedTools = Object.create(null) as Record<string, AIAgentContext>;
    for (const [name, tool] of Object.entries(definition.tools)) {
      const supplied = Object.prototype.hasOwnProperty.call(toolsContext, name)
        ? (toolsContext as Record<string, AIAgentContext>)[name]
        : {};
      assertRecord(supplied, `AI agent tool context ${name}`);
      resolvedTools[name] = tool.contextSchema === undefined
        ? supplied
        : await validateTypes({
            value: supplied,
            schema: tool.contextSchema,
            context: { field: `toolsContext.${name}` },
          });
    }

    const snapshot = snapshotAIAgentJSON(
      { runtimeContext: runtime, toolsContext: resolvedTools },
      'AI agent context',
      'AI_AGENT_CONTEXT_INVALID',
    );
    if (snapshot.bytes > definition.limits.maxContextBytes) {
      throw new AIError(
        `AI agent context exceeded ${definition.limits.maxContextBytes} bytes.`,
        'AI_AGENT_CONTEXT_INVALID',
        413,
      );
    }
    return {
      runtimeContext: snapshot.value.runtimeContext as Readonly<RUNTIME_CONTEXT>,
      toolsContext: snapshot.value.toolsContext as Readonly<AIAgentToolsContext<TOOLS>>,
    };
  } catch (error) {
    if (error instanceof AIError) throw error;
    const wrapped = new AIError(
      'AI agent runtime or tool context is invalid.',
      'AI_AGENT_CONTEXT_INVALID',
      400,
    );
    Object.defineProperty(wrapped, 'cause', { value: error, configurable: true });
    throw wrapped;
  }
}

function assertRecord(value: unknown, label: string): asserts value is AIAgentContext {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AIError(`${label} must be an object.`, 'AI_AGENT_CONTEXT_INVALID', 400);
  }
}
