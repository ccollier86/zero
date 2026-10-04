/**
 * ai-agent-tool.ts
 *
 * Defines typed Zero agent tools and materializes one isolated AI SDK toolset
 * per run. This file owns tool execution context only; it does not register
 * agents or select models.
 */

import {
  tool as defineSDKTool,
  type FlexibleSchema,
  type ModelMessage,
  type Tool,
  type ToolApprovalStatus,
} from 'ai';
import { validateTypes } from '@ai-sdk/provider-utils';

import { AIError } from '../ai-errors';
import {
  assertAIAgentApprovalRule,
  isAIAgentApprovalStatusObject,
} from './ai-agent-approval-status';
import type { AIAgentExecutionBudget } from './ai-agent-budget';
import type { AIAgentContext, AIAgentIdentity } from './ai-agent-types';

/** Context passed to one app-owned tool handler. */
export interface AIAgentToolExecutionContext<
  RUNTIME_CONTEXT extends AIAgentContext,
  TOOL_CONTEXT extends AIAgentContext,
  EXECUTION_CONTEXT,
> extends AIAgentIdentity {
  readonly runId: string;
  readonly toolName: string;
  readonly toolCallId: string;
  readonly messages: readonly ModelMessage[];
  readonly runtimeContext: Readonly<RUNTIME_CONTEXT>;
  readonly toolContext: Readonly<TOOL_CONTEXT>;
  readonly executionContext: EXECUTION_CONTEXT;
  readonly abortSignal?: AbortSignal;
}

/** Context available while deciding whether a tool call needs approval. */
export type AIAgentToolApprovalContext<
  RUNTIME_CONTEXT extends AIAgentContext,
  TOOL_CONTEXT extends AIAgentContext,
  EXECUTION_CONTEXT,
> = Omit<AIAgentToolExecutionContext<RUNTIME_CONTEXT, TOOL_CONTEXT, EXECUTION_CONTEXT>, 'abortSignal'>;

/** App-owned approval rule for one tool. */
export type AIAgentToolApprovalRule<
  INPUT,
  RUNTIME_CONTEXT extends AIAgentContext,
  TOOL_CONTEXT extends AIAgentContext,
  EXECUTION_CONTEXT,
> = ToolApprovalStatus | ((
  input: INPUT,
  context: AIAgentToolApprovalContext<RUNTIME_CONTEXT, TOOL_CONTEXT, EXECUTION_CONTEXT>,
) => ToolApprovalStatus | PromiseLike<ToolApprovalStatus>);

/** Immutable blueprint used to materialize a fresh SDK tool for every run. */
export interface AIAgentToolDefinition<
  INPUT = unknown,
  OUTPUT = unknown,
  TOOL_CONTEXT extends AIAgentContext = Record<string, never>,
  RUNTIME_CONTEXT extends AIAgentContext = AIAgentContext,
  EXECUTION_CONTEXT = undefined,
> {
  readonly kind: 'zero.ai-agent-tool';
  readonly description?: string;
  readonly inputSchema: FlexibleSchema<INPUT>;
  readonly outputSchema?: FlexibleSchema<OUTPUT>;
  readonly contextSchema?: FlexibleSchema<TOOL_CONTEXT>;
  readonly approval?: AIAgentToolApprovalRule<INPUT, RUNTIME_CONTEXT, TOOL_CONTEXT, EXECUTION_CONTEXT>;
  readonly execute: (
    input: INPUT,
    context: AIAgentToolExecutionContext<RUNTIME_CONTEXT, TOOL_CONTEXT, EXECUTION_CONTEXT>,
  ) => OUTPUT | PromiseLike<OUTPUT>;
}

/** Input accepted by `defineAIAgentTool`; `kind` is supplied by Zero. */
export type AIAgentToolDefinitionInput<
  INPUT,
  OUTPUT,
  TOOL_CONTEXT extends AIAgentContext,
  RUNTIME_CONTEXT extends AIAgentContext,
  EXECUTION_CONTEXT,
> = Omit<AIAgentToolDefinition<INPUT, OUTPUT, TOOL_CONTEXT, RUNTIME_CONTEXT, EXECUTION_CONTEXT>, 'kind'>;

/** Heterogeneous map of app-owned agent tool blueprints. */
export type AIAgentToolSet<
  RUNTIME_CONTEXT extends AIAgentContext = AIAgentContext,
  EXECUTION_CONTEXT = unknown,
> = Record<string, AIAgentToolDefinition<any, any, any, RUNTIME_CONTEXT, EXECUTION_CONTEXT>>;

/** Infer the SDK tool type materialized from a Zero tool blueprint. */
export type MaterializedAIAgentTool<DEFINITION> = DEFINITION extends AIAgentToolDefinition<
  infer INPUT,
  infer OUTPUT,
  infer TOOL_CONTEXT,
  any,
  any
> ? Tool<INPUT, OUTPUT, TOOL_CONTEXT> : never;

/** SDK toolset produced from a Zero tool blueprint map. */
export type MaterializedAIAgentTools<TOOLS extends AIAgentToolSet<any, any>> = {
  readonly [NAME in keyof TOOLS]: MaterializedAIAgentTool<TOOLS[NAME]>;
};

/** Per-tool context map accepted by an agent run. */
export type AIAgentToolsContext<TOOLS extends AIAgentToolSet<any, any>> = {
  readonly [NAME in keyof TOOLS]: TOOLS[NAME] extends AIAgentToolDefinition<any, any, infer CONTEXT, any, any>
    ? CONTEXT
    : never;
};

/** Define and freeze a typed, reusable agent-tool blueprint. */
export function defineAIAgentTool<
  INPUT,
  OUTPUT,
  TOOL_CONTEXT extends AIAgentContext = Record<string, never>,
  RUNTIME_CONTEXT extends AIAgentContext = AIAgentContext,
  EXECUTION_CONTEXT = undefined,
>(
  definition: AIAgentToolDefinitionInput<INPUT, OUTPUT, TOOL_CONTEXT, RUNTIME_CONTEXT, EXECUTION_CONTEXT>,
): AIAgentToolDefinition<INPUT, OUTPUT, TOOL_CONTEXT, RUNTIME_CONTEXT, EXECUTION_CONTEXT> {
  if (typeof definition.execute !== 'function') {
    throw new AIError('AI agent tools require an execute function.', 'AI_AGENT_DEFINITION_INVALID', 400);
  }
  assertAIAgentApprovalRule(definition.approval, 'AI agent tool approval');
  const approval = isAIAgentApprovalStatusObject(definition.approval)
    ? Object.freeze({ ...definition.approval })
    : definition.approval;
  return Object.freeze({
    kind: 'zero.ai-agent-tool' as const,
    ...definition,
    ...(approval === undefined ? {} : { approval }),
  });
}

interface MaterializeAIAgentToolsOptions<
  TOOLS extends AIAgentToolSet<RUNTIME_CONTEXT, EXECUTION_CONTEXT>,
  RUNTIME_CONTEXT extends AIAgentContext,
  EXECUTION_CONTEXT,
> extends AIAgentIdentity {
  readonly runId: string;
  readonly tools: TOOLS;
  readonly runtimeContext: Readonly<RUNTIME_CONTEXT>;
  readonly executionContext: EXECUTION_CONTEXT;
  readonly budget: AIAgentExecutionBudget;
  readonly notify: (event: AIAgentToolRuntimeEvent) => void;
}

/** Minimal secret-safe tool event passed back to the runner. */
export type AIAgentToolRuntimeEvent =
  | { readonly type: 'started'; readonly stepNumber: number; readonly toolName: string; readonly toolCallId: string }
  | { readonly type: 'completed'; readonly stepNumber: number; readonly toolName: string; readonly toolCallId: string; readonly durationMs: number }
  | { readonly type: 'failed'; readonly stepNumber: number; readonly toolName: string; readonly toolCallId: string; readonly durationMs: number; readonly error: unknown };

/** Materialize run-bound SDK tools so runtime and authority objects never leak across runs. */
export function materializeAIAgentTools<
  RUNTIME_CONTEXT extends AIAgentContext,
  EXECUTION_CONTEXT,
  TOOLS extends AIAgentToolSet<RUNTIME_CONTEXT, EXECUTION_CONTEXT>,
>(
  options: MaterializeAIAgentToolsOptions<TOOLS, RUNTIME_CONTEXT, EXECUTION_CONTEXT>,
): MaterializedAIAgentTools<TOOLS> {
  const materialized = Object.create(null) as Record<string, Tool<any, any, any>>;

  for (const [toolName, definition] of Object.entries(options.tools)) {
    materialized[toolName] = defineSDKTool({
      description: definition.description,
      inputSchema: definition.inputSchema,
      outputSchema: definition.outputSchema,
      contextSchema: definition.contextSchema,
      execute: async (input, sdkContext) => {
        const startedAt = performance.now();
        const stepNumber = options.budget.currentStepNumber;
        try {
          options.budget.beginToolCall();
          options.notify({ type: 'started', stepNumber, toolName, toolCallId: sdkContext.toolCallId });
          const output = await definition.execute(input, {
            name: options.name,
            version: options.version,
            runId: options.runId,
            toolName,
            toolCallId: sdkContext.toolCallId,
            messages: sdkContext.messages,
            runtimeContext: options.runtimeContext,
            toolContext: sdkContext.context ?? {},
            executionContext: options.executionContext,
            abortSignal: sdkContext.abortSignal,
          });
          const validatedOutput = definition.outputSchema === undefined
            ? output
            : await validateTypes({
                value: output,
                schema: definition.outputSchema,
                context: { field: `tools.${toolName}.output` },
              });
          const snapshot = options.budget.recordToolResult(validatedOutput);
          options.notify({
            type: 'completed',
            stepNumber,
            toolName,
            toolCallId: sdkContext.toolCallId,
            durationMs: performance.now() - startedAt,
          });
          return snapshot;
        } catch (error) {
          const normalized = normalizeToolError(error, toolName);
          options.notify({
            type: 'failed',
            stepNumber,
            toolName,
            toolCallId: sdkContext.toolCallId,
            durationMs: performance.now() - startedAt,
            error: normalized,
          });
          throw normalized;
        }
      },
    });
  }

  return Object.freeze(materialized) as MaterializedAIAgentTools<TOOLS>;
}

function normalizeToolError(error: unknown, toolName: string): AIError {
  if (error instanceof AIError && (
    error.code === 'AI_AGENT_EXECUTION_LIMIT_EXCEEDED'
    || error.code === 'AI_REQUEST_ABORTED'
    || error.code === 'AI_REQUEST_TIMEOUT'
    || error.code === 'AI_AGENT_EXECUTION_TIMEOUT'
  )) {
    return error;
  }
  const wrapped = new AIError(
    `AI agent tool failed: ${toolName}.`,
    'AI_AGENT_TOOL_EXECUTION_FAILED',
    500,
  );
  Object.defineProperty(wrapped, 'cause', { value: error, configurable: true });
  return wrapped;
}
