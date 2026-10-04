/**
 * ai-durable-agent-types.ts
 *
 * Declares the public contracts for AI agents executed by Torrent. These
 * types contain durable JSON and safe progress projections only; live
 * Guardian authority, Fabric services, model objects, and secrets never
 * cross this boundary.
 */

import type { AuthContext } from '../../auth/types';
import type { ServiceDataScope } from '../../auth/service-data-scope';
import type {
  WorkflowExecutionIdentity,
  WorkflowSystemExecutionOptions,
} from '../../workflows/workflow-execution-authority';
import type { WorkflowStatus } from '../../workflows/types';
import type { WorkflowService } from '../../workflows/workflow-service';
import type { AIAgentDefinition, AnyAIAgentDefinition } from '../agents/ai-agent-definition';
import type {
  AIAgentContext,
  AIAgentObserver,
  AIAgentPlatformCodeEmitter,
  AIAgentPrompt,
} from '../agents/ai-agent-types';
import type { AIAgentToolSet, AIAgentToolsContext } from '../agents/ai-agent-tool';
import type { AIAgentRegistry } from '../agents/ai-agent-registry';
import type { LanguageModel, ModelMessage, OutputInterface } from 'ai';
import type { WorkflowJsonValue } from '../../workflows/workflow-json-value';
import type { AIErrorCode } from '../ai-errors';
import type { AIPrepareModelExecution } from '../ai-model-execution';

/** Version of Zero's private durable-agent state envelope. */
export const AI_DURABLE_AGENT_STATE_VERSION = 1 as const;

/** Live, non-serializable authority supplied only while trusted code runs. */
export interface AIDurableAgentLiveExecutionContext<TServices = unknown> {
  readonly runId: string;
  readonly phase: 'model' | 'approval' | 'tool' | 'finalize';
  readonly turn: number;
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly idempotencyKey: string;
  readonly execution: WorkflowExecutionIdentity;
  readonly zero: TServices | null;
  readonly assertCurrentAuthority: () => void;
}

/** Rebuild app-owned execution services from Torrent's live authority lease. */
export type AIDurableAgentExecutionContextFactory<EXECUTION_CONTEXT, TServices = unknown> = (
  context: AIDurableAgentLiveExecutionContext<TServices>,
) => EXECUTION_CONTEXT | PromiseLike<EXECUTION_CONTEXT>;

/** Runtime dependencies installed before WorkflowService publishes definitions. */
export interface AIDurableAgentRuntimeOptions<EXECUTION_CONTEXT = undefined, TServices = unknown> {
  readonly agents: AIAgentRegistry;
  /** Preferred managed boundary for provider policy, downloads, and telemetry. */
  readonly prepareModelExecution?: AIPrepareModelExecution;
  /** @deprecated Prefer prepareModelExecution so provider policy cannot be skipped. */
  readonly resolveModel?: (reference: string) => LanguageModel;
  readonly createExecutionContext?: AIDurableAgentExecutionContextFactory<EXECUTION_CONTEXT, TServices>;
  readonly observer?: AIAgentObserver;
  /** Managed apps inject their app-local observability emitter. */
  readonly emitCode?: AIAgentPlatformCodeEmitter;
  readonly now?: () => Date;
}

/** Typed input for a durable run. All data is validated before private seeding. */
export type AIDurableAgentRunInput<
  RUNTIME_CONTEXT extends AIAgentContext,
  EXECUTION_CONTEXT,
  TOOLS extends AIAgentToolSet<RUNTIME_CONTEXT, EXECUTION_CONTEXT>,
> = AIAgentPrompt & {
  readonly runtimeContext: RUNTIME_CONTEXT;
  readonly toolsContext: AIAgentToolsContext<TOOLS>;
};

/** Exact installation descriptor produced for one versioned code definition. */
export interface RegisteredAIDurableAgent<DEFINITION extends AnyAIAgentDefinition = AnyAIAgentDefinition> {
  readonly definition: DEFINITION;
  readonly workflowName: string;
  readonly workflowVersion: number;
}

/** Safe workflow input projected through normal Torrent/ReactiveDB tables. */
export interface AIDurableAgentPublicEnvelope {
  readonly kind: 'zero.ai.durable-agent';
  readonly stateVersion: typeof AI_DURABLE_AGENT_STATE_VERSION;
  readonly agent: Readonly<{ name: string; version: string }>;
}

/** Approval response consumed by Torrent requestAndWait. */
export interface AIDurableAgentApprovalResponse {
  readonly approved: boolean;
  readonly reason?: string;
}

/** Scope-checked, payload-free run progress suitable for UI projections. */
export interface AIDurableAgentProgress {
  readonly runId: string;
  readonly agent: Readonly<{ name: string; version: string }>;
  readonly tenantId: string | null;
  readonly status: WorkflowStatus;
  readonly currentStep: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly error?: AIDurableAgentTerminalError;
  readonly steps: readonly Readonly<{
    nodeId: string | null;
    label: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
  }>[];
  readonly interactions: readonly Readonly<{
    interactionId: string;
    label: string;
    status: string;
    openedAt: string;
    expiresAt: string | null;
  }>[];
}

/** Private final result returned only after WorkflowService scope checks. */
export interface AIDurableAgentResult<OUTPUT = unknown> {
  readonly runId: string;
  readonly agent: Readonly<{ name: string; version: string }>;
  readonly status: WorkflowStatus;
  readonly output?: OUTPUT;
  readonly text?: string;
  readonly finishReason?: string;
  readonly turns: number;
  readonly toolCalls: number;
  readonly error?: AIDurableAgentTerminalError;
}

/** Secret-safe terminal reason retained for failed or cancelled runs. */
export interface AIDurableAgentTerminalError {
  readonly code: AIErrorCode;
  readonly message: string;
}

/** Service binding created after the app's WorkflowService is ready. */
export interface AIDurableAgentServiceDependencies {
  readonly workflows: WorkflowService;
}

/** Internal private meta envelope persisted in Torrent scratch memory. */
export interface AIDurableAgentPrivateMeta {
  readonly stateVersion: typeof AI_DURABLE_AGENT_STATE_VERSION;
  readonly agentName: string;
  readonly agentVersion: string;
  readonly deadlineAt: string | null;
}

/** Internal private control state persisted between model decisions. */
export interface AIDurableAgentControlState {
  readonly turn: number;
  readonly completed: boolean;
  readonly approvalRequired: boolean;
  readonly totalToolCalls: number;
  readonly totalToolResultBytes: number;
  readonly finishReason: string | null;
}

/** Private once-only lifecycle receipt reconciled from committed Torrent rows. */
export interface AIDurableAgentLifecycleState {
  readonly version: 1;
  readonly startedAt: string | null;
  readonly terminal: Readonly<{
    status: 'completed' | 'failed' | 'cancelled';
    at: string;
    error?: AIDurableAgentTerminalError;
  }> | null;
}

/** Private model-selected call retained outside Sync-visible step rows. */
export interface AIDurableAgentToolCall {
  readonly index: number;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: unknown;
  /** Exact per-call share reserved before parallel side effects begin. */
  readonly resultByteLimit: number;
  readonly approval: 'approved' | 'denied' | 'user-approval';
  readonly approvalReason?: string;
}

/** Private fan-out reference; the actual tool input lives in chunked memory. */
export interface AIDurableAgentToolCallReference {
  readonly index: number;
  readonly key: string;
}

/** Private result converted to the AI SDK model-message representation. */
export interface AIDurableAgentToolResult {
  readonly index: number;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output: AIDurableAgentModelToolOutput;
  readonly bytes: number;
}

/** JSON-safe tool result form accepted by SDK 7 model transcripts. */
export type AIDurableAgentModelToolOutput =
  | Readonly<{ type: 'text'; value: string }>
  | Readonly<{ type: 'json'; value: WorkflowJsonValue }>
  | Readonly<{ type: 'execution-denied'; reason?: string }>
  | Readonly<{ type: 'error-text'; value: string }>
  | Readonly<{ type: 'error-json'; value: WorkflowJsonValue }>;

/** Type-only helpers used by the service's generic methods. */
export type AIDurableDefinition<
  RUNTIME_CONTEXT extends AIAgentContext,
  EXECUTION_CONTEXT,
  TOOLS extends AIAgentToolSet<RUNTIME_CONTEXT, EXECUTION_CONTEXT>,
  OUTPUT extends OutputInterface,
> = AIAgentDefinition<RUNTIME_CONTEXT, EXECUTION_CONTEXT, TOOLS, OUTPUT>;

export type AIDurableMessages = readonly ModelMessage[];
export type AIDurableActorContext = AuthContext;
export type AIDurableSystemContext = WorkflowSystemExecutionOptions;
export type AIDurableScope = ServiceDataScope;
