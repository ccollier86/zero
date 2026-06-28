/**
 * ai-toolkit.ts
 *
 * Helpers for defining app-owned AI tools. This file owns conversion from
 * Zero-friendly tool declarations to AI SDK tool definitions only; it does not
 * register routes, persist tool records, or authorize domain actions.
 */

import type { ToolSet } from 'ai';
import { jsonSchema, tool as defineProviderTool } from '@ai-sdk/provider-utils';

import { AIError } from './ai-errors';
import { emitAIToolFailed } from './ai-observability';

/** App-owned tool declaration converted to an AI SDK tool definition. */
export interface AIToolDefinition<Input = unknown, Output = unknown> {
  description?: string;
  input?: Record<string, unknown>;
  execute?: (input: Input) => Promise<Output> | Output;
}

/**
 * Define one server-side AI tool.
 *
 * `input` accepts JSON Schema-compatible objects, including schemas produced by
 * Elysia `t.*`. Tool execution remains server-side and should enforce any
 * domain authorization needed by the app.
 */
export function aiTool<Input = unknown, Output = unknown>(
  definition: AIToolDefinition<Input, Output>
) {
  const inputSchema = definition.input ?? {
    type: 'object',
    properties: {},
    additionalProperties: false,
  };

  return (defineProviderTool as any)({
    description: definition.description,
    inputSchema: jsonSchema(inputSchema as any),
    execute: definition.execute
      ? async (input: Input) => {
          try {
            return await definition.execute!(input);
          } catch (error) {
            emitAIToolFailed(error, {});
            throw error;
          }
        }
      : undefined,
  });
}

/**
 * Define a toolset for `ai.generateConversation()` and `ai.streamConversation()`.
 *
 * Throws when a tool name is empty so invalid toolsets fail before reaching a
 * provider.
 */
export function defineAITools<Tools extends Record<string, ReturnType<typeof aiTool>>>(
  tools: Tools
): Tools & ToolSet {
  for (const name of Object.keys(tools)) {
    if (!name.trim()) {
      throw new AIError('AI tool names must be non-empty.', 'AI_TOOL_INVALID', 400);
    }
  }
  return tools as Tools & ToolSet;
}
