/**
 * ai-agent-approval.ts
 *
 * Adapts Zero's typed approval policy to AI SDK 7 and validates the HMAC key
 * used to bind approvals to tool calls. It does not persist approvals or make
 * application authorization decisions.
 */

import type {
  ModelMessage,
  ToolApprovalConfiguration,
  ToolApprovalStatus,
} from 'ai';

import { AIError } from '../ai-errors';
import type { AIAgentContext, AIAgentIdentity } from './ai-agent-types';
import type {
  AIAgentToolDefinition,
  AIAgentToolSet,
  AIAgentToolsContext,
  MaterializedAIAgentTools,
} from './ai-agent-tool';

/** Discriminated, typed tool call supplied to an agent-wide approval rule. */
export type AIAgentApprovalToolCall<TOOLS extends AIAgentToolSet<any, any>> = {
  [NAME in keyof TOOLS & string]: TOOLS[NAME] extends AIAgentToolDefinition<infer INPUT, any, any, any, any>
    ? { readonly toolCallId: string; readonly toolName: NAME; readonly input: INPUT }
    : never;
}[keyof TOOLS & string];

/** Context supplied to an agent-wide approval rule. */
export interface AIAgentApprovalContext<
  TOOLS extends AIAgentToolSet<RUNTIME_CONTEXT, EXECUTION_CONTEXT>,
  RUNTIME_CONTEXT extends AIAgentContext,
  EXECUTION_CONTEXT,
> extends AIAgentIdentity {
  readonly runId: string;
  readonly toolCall: AIAgentApprovalToolCall<TOOLS>;
  readonly messages: readonly ModelMessage[];
  readonly runtimeContext: Readonly<RUNTIME_CONTEXT>;
  readonly toolsContext: Readonly<AIAgentToolsContext<TOOLS>>;
  readonly executionContext: EXECUTION_CONTEXT;
}

/** Agent-wide rule or per-tool overrides; tool-local rules are the fallback. */
export type AIAgentApprovalPolicy<
  TOOLS extends AIAgentToolSet<RUNTIME_CONTEXT, EXECUTION_CONTEXT>,
  RUNTIME_CONTEXT extends AIAgentContext,
  EXECUTION_CONTEXT,
> = ToolApprovalStatus
  | ((context: AIAgentApprovalContext<TOOLS, RUNTIME_CONTEXT, EXECUTION_CONTEXT>) => ToolApprovalStatus | PromiseLike<ToolApprovalStatus>)
  | Readonly<Partial<{
      [NAME in keyof TOOLS]: TOOLS[NAME]['approval'];
    }>>;

interface CreateApprovalOptions<
  TOOLS extends AIAgentToolSet<RUNTIME_CONTEXT, EXECUTION_CONTEXT>,
  RUNTIME_CONTEXT extends AIAgentContext,
  EXECUTION_CONTEXT,
> extends AIAgentIdentity {
  readonly runId: string;
  readonly tools: TOOLS;
  readonly policy?: AIAgentApprovalPolicy<TOOLS, RUNTIME_CONTEXT, EXECUTION_CONTEXT>;
  readonly executionContext: EXECUTION_CONTEXT;
}

/** Build the SDK approval callback while retaining Zero runtime/execution context. */
export function createAIAgentApprovalConfiguration<
  RUNTIME_CONTEXT extends AIAgentContext,
  EXECUTION_CONTEXT,
  TOOLS extends AIAgentToolSet<RUNTIME_CONTEXT, EXECUTION_CONTEXT>,
>(
  options: CreateApprovalOptions<TOOLS, RUNTIME_CONTEXT, EXECUTION_CONTEXT>,
): ToolApprovalConfiguration<MaterializedAIAgentTools<TOOLS>, RUNTIME_CONTEXT> | undefined {
  if (!hasAIAgentApprovalPolicy(options.tools, options.policy)) return undefined;

  return async ({ toolCall, messages, toolsContext, runtimeContext }) => {
    const typedCall = toolCall as unknown as AIAgentApprovalToolCall<TOOLS>;
    const common = {
      name: options.name,
      version: options.version,
      runId: options.runId,
      toolCall: typedCall,
      messages,
      runtimeContext,
      toolsContext: toolsContext as unknown as AIAgentToolsContext<TOOLS>,
      executionContext: options.executionContext,
    };

    if (typeof options.policy === 'function') return options.policy(common);
    if (options.policy !== undefined && isApprovalStatus(options.policy)) return options.policy;

    const toolName = typedCall.toolName;
    const definition = own(options.tools, toolName);
    const configured = options.policy === undefined || !hasOwn(options.policy, toolName)
      ? definition?.approval
      : own(options.policy, toolName);
    if (typeof configured !== 'function') return configured;

    return configured(typedCall.input, {
      name: options.name,
      version: options.version,
      runId: options.runId,
      toolName,
      toolCallId: typedCall.toolCallId,
      messages,
      runtimeContext,
      toolContext: (toolsContext as Record<string, AIAgentContext>)[toolName] ?? {},
      executionContext: options.executionContext,
    });
  };
}

/** Return true when an agent or any of its tools declares approval behavior. */
export function hasAIAgentApprovalPolicy<
  TOOLS extends AIAgentToolSet<any, any>,
>(tools: TOOLS, policy: AIAgentApprovalPolicy<any, any, any> | undefined): boolean {
  if (policy !== undefined) return true;
  return Object.values(tools).some((definition) => definition.approval !== undefined);
}

/** Validate and defensively copy an HMAC approval secret. */
export function resolveAIAgentApprovalSecret(
  value: string | Uint8Array | undefined,
): string | Uint8Array | undefined {
  if (value === undefined) return undefined;
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  if (bytes.byteLength < 32 || bytes.byteLength > 64 * 1024) {
    throw new AIError(
      'AI agent approval HMAC secrets must contain 32 through 65536 bytes.',
      'AI_AGENT_APPROVAL_CONFIG_INVALID',
      500,
    );
  }
  return typeof value === 'string' ? value : new Uint8Array(value);
}

function isApprovalStatus(value: unknown): value is ToolApprovalStatus {
  if (value === undefined || typeof value === 'string') return true;
  return value !== null
    && typeof value === 'object'
    && Object.prototype.hasOwnProperty.call(value, 'type');
}

function own<T extends object, KEY extends PropertyKey>(value: T, key: KEY): T[KEY & keyof T] | undefined {
  return Object.prototype.hasOwnProperty.call(value, key) ? value[key as KEY & keyof T] : undefined;
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
