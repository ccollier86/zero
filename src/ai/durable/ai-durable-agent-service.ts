/**
 * ai-durable-agent-service.ts
 *
 * Starts, inspects, and answers durable AI-agent runs through Torrent's
 * authority- and tenant-scoped service boundary. It never exposes private
 * prompts, contexts, tool inputs, tool outputs, or workflow scratch memory.
 */

import type { AuthContext } from '../../auth/types';
import type { ServiceDataScope } from '../../auth/service-data-scope';
import type { WorkflowInteractionActor } from '../../workflows/workflow-interaction-authority';
import type { WorkflowInteractionSubmissionResult } from '../../workflows/workflow-interaction-service';
import type { WorkflowSystemExecutionOptions } from '../../workflows/workflow-execution-authority';
import { getWorkflowGraphRuntime } from '../../workflows/workflow-service';
import { AIError } from '../ai-errors';
import type {
  AIAgentDefinition,
  AnyAIAgentDefinition,
} from '../agents/ai-agent-definition';
import type { AIAgentContext } from '../agents/ai-agent-types';
import type { AIAgentReference } from '../agents/ai-agent-types';
import type { AIAgentToolSet } from '../agents/ai-agent-tool';
import {
  requireDurableControl,
  requireDurableStoredResult,
} from './ai-durable-agent-state';
import type {
  AIDurableAgentApprovalResponse,
  AIDurableAgentProgress,
  AIDurableAgentResult,
  AIDurableAgentRunInput,
  AIDurableAgentServiceDependencies,
  RegisteredAIDurableAgent,
} from './ai-durable-agent-types';
import { AIDurableAgentWorkflowRuntime } from './ai-durable-agent-workflow';
import { AI_DURABLE_AGENT_WORKFLOW_MEMORY_LIMITS } from './ai-durable-agent-limits';
import { requireAIDurablePublicEnvelope } from './ai-durable-agent-envelope';
import { AIDurableAgentLifecycleCoordinator } from './ai-durable-agent-lifecycle';
import { prepareAIDurableAgentRun } from './ai-durable-agent-run-preparation';

export interface AIDurableAgentRespondOptions {
  readonly runId: string;
  readonly interactionId: string;
  readonly submissionId: string;
  readonly response: AIDurableAgentApprovalResponse;
  readonly actor: WorkflowInteractionActor;
  readonly scope: ServiceDataScope;
  readonly assertCurrentResponder: () => void;
  readonly channel?: string;
}

/** Authority-scoped facade over code-owned durable-agent Torrent graphs. */
export class AIDurableAgentService<EXECUTION_CONTEXT = undefined, TServices = unknown> {
  private readonly lifecycle: AIDurableAgentLifecycleCoordinator;

  constructor(
    private readonly runtime: AIDurableAgentWorkflowRuntime<EXECUTION_CONTEXT, TServices>,
    private readonly dependencies: AIDurableAgentServiceDependencies,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.lifecycle = new AIDurableAgentLifecycleCoordinator(
      runtime,
      getWorkflowGraphRuntime(dependencies.workflows),
    );
  }

  /** Start with the exact live Guardian actor captured by WorkflowService. */
  async startAsActor<DEFINITION extends AnyAIAgentDefinition>(
    reference: RegisteredAIDurableAgent<DEFINITION>,
    input: DurableRunInputFor<DEFINITION>,
    actor: AuthContext,
    assertCurrentAuthority: () => void,
  ): Promise<string>;
  async startAsActor(
    reference: AIAgentReference,
    input: AIDurableAgentRunInput<any, any, any>,
    actor: AuthContext,
    assertCurrentAuthority: () => void,
  ): Promise<string>;
  async startAsActor(
    reference: AIAgentReference | RegisteredAIDurableAgent,
    input: AIDurableAgentRunInput<any, any, any>,
    actor: AuthContext,
    assertCurrentAuthority: () => void,
  ): Promise<string> {
    const run = await prepareAIDurableAgentRun(this.runtime, reference, input, this.now());
    return this.dependencies.workflows.startAsActor(
      run.descriptor.workflowName,
      run.publicInput,
      actor,
      {
        version: run.descriptor.workflowVersion,
        initialMemory: run.initialMemory,
        memoryLimits: AI_DURABLE_AGENT_WORKFLOW_MEMORY_LIMITS,
      },
      assertCurrentAuthority,
    );
  }

  /** Start from an explicit audited Torrent system principal. */
  async startAsSystem<DEFINITION extends AnyAIAgentDefinition>(
    reference: RegisteredAIDurableAgent<DEFINITION>,
    input: DurableRunInputFor<DEFINITION>,
    system: WorkflowSystemExecutionOptions,
  ): Promise<string>;
  async startAsSystem(
    reference: AIAgentReference,
    input: AIDurableAgentRunInput<any, any, any>,
    system: WorkflowSystemExecutionOptions,
  ): Promise<string>;
  async startAsSystem(
    reference: AIAgentReference | RegisteredAIDurableAgent,
    input: AIDurableAgentRunInput<any, any, any>,
    system: WorkflowSystemExecutionOptions,
  ): Promise<string> {
    const run = await prepareAIDurableAgentRun(this.runtime, reference, input, this.now());
    return this.dependencies.workflows.startAsSystem(
      run.descriptor.workflowName,
      run.publicInput,
      system,
      {
        version: run.descriptor.workflowVersion,
        initialMemory: run.initialMemory,
        memoryLimits: AI_DURABLE_AGENT_WORKFLOW_MEMORY_LIMITS,
      },
    );
  }

  /** Return a payload-free progress projection after Torrent scope checks. */
  getProgress(runId: string, scope: ServiceDataScope): AIDurableAgentProgress {
    const instance = this.requireRun(runId, scope);
    const envelope = requireAIDurablePublicEnvelope(instance.input);
    const descriptor = this.runtime.require(envelope.agent.name, envelope.agent.version);
    if (instance.name !== descriptor.workflowName
      || instance.definition_version !== descriptor.workflowVersion) {
      throw corruptRun();
    }
    const graph = getWorkflowGraphRuntime(this.dependencies.workflows);
    const lifecycle = this.lifecycle.reconcile(instance);
    const steps = this.dependencies.workflows.getSteps(runId, scope);
    return Object.freeze({
      runId,
      agent: Object.freeze({ ...envelope.agent }),
      tenantId: instance.tenant_id,
      status: instance.status,
      currentStep: instance.current_step,
      createdAt: instance.created_at,
      updatedAt: instance.updated_at,
      completedAt: instance.completed_at,
      ...(lifecycle.terminal?.error === undefined
        ? {}
        : { error: Object.freeze({ ...lifecycle.terminal.error }) }),
      steps: Object.freeze(steps.map((step) =>
        Object.freeze({
          nodeId: step.node_id ?? null,
          label: step.step_name,
          status: step.status,
          startedAt: step.started_at,
          completedAt: step.completed_at,
        }))),
      interactions: Object.freeze(graph.interactions.listByInstance(runId).map((interaction) =>
        Object.freeze({
          interactionId: interaction.interactionId,
          label: interaction.safeLabel,
          status: interaction.status,
          openedAt: interaction.openedAt,
          expiresAt: interaction.expiresAt,
        }))),
    });
  }

  /** Return the private final value only to a caller already admitted to its scope. */
  getResult(runId: string, scope: ServiceDataScope): AIDurableAgentResult | null {
    const instance = this.requireRun(runId, scope);
    if (!['completed', 'failed', 'cancelled'].includes(instance.status)) return null;
    const envelope = requireAIDurablePublicEnvelope(instance.input);
    const descriptor = this.runtime.require(envelope.agent.name, envelope.agent.version);
    if (instance.name !== descriptor.workflowName
      || instance.definition_version !== descriptor.workflowVersion) {
      throw corruptRun();
    }
    const graph = getWorkflowGraphRuntime(this.dependencies.workflows);
    const lifecycle = this.lifecycle.reconcile(instance);
    const memory = memoryReader(graph, runId);
    if (instance.status !== 'completed') {
      const counts = terminalCounts(
        memory,
        this.dependencies.workflows.getSteps(runId, scope),
      );
      const error = lifecycle.terminal?.error;
      if (!error || lifecycle.terminal?.status !== instance.status) throw corruptRun();
      return Object.freeze({
        runId,
        agent: Object.freeze({ ...envelope.agent }),
        status: instance.status,
        turns: counts.turns,
        toolCalls: counts.toolCalls,
        error: Object.freeze({ ...error }),
      });
    }
    const stored = requireDurableStoredResult(memory);
    return Object.freeze({
      runId,
      agent: Object.freeze({ ...envelope.agent }),
      status: instance.status,
      ...(stored.output === undefined ? {} : { output: stored.output }),
      text: stored.text,
      finishReason: stored.finishReason,
      turns: stored.turns,
      toolCalls: stored.toolCalls,
    });
  }

  /** Answer an open approval through Torrent's idempotent interaction ledger. */
  async respondToApproval(
    options: AIDurableAgentRespondOptions,
  ): Promise<WorkflowInteractionSubmissionResult> {
    this.requireRun(options.runId, options.scope);
    if ((options.scope.tenantId ?? null) !== (options.actor.tenantId ?? null)) {
      throw runNotFound();
    }
    const graph = getWorkflowGraphRuntime(this.dependencies.workflows);
    const interactionId = requireIdentifier(options.interactionId, 'interaction ID');
    const interaction = graph.interactions.get(interactionId);
    if (!interaction || interaction.instanceId !== options.runId) throw runNotFound();
    return graph.submitInteraction({
      interactionId: interaction.interactionId,
      submissionId: requireIdentifier(options.submissionId, 'submission ID'),
      actor: options.actor,
      payload: options.response,
      channel: options.channel?.trim() || 'agent',
      assertCurrentResponder: options.assertCurrentResponder,
    });
  }

  /** Release this facade's committed-transition subscription. */
  dispose(): void {
    this.lifecycle.dispose();
  }

  private requireRun(runId: string, scope: ServiceDataScope) {
    const normalized = requireIdentifier(runId, 'run ID');
    const instance = this.dependencies.workflows.getInstance(normalized, scope);
    if (!instance) throw runNotFound();
    requireAIDurablePublicEnvelope(instance.input);
    return instance;
  }
}

type DurableRunInputFor<DEFINITION extends AnyAIAgentDefinition> =
  DEFINITION extends AIAgentDefinition<
    infer RUNTIME_CONTEXT,
    infer DEFINITION_EXECUTION_CONTEXT,
    infer TOOLS,
    any
  >
    ? RUNTIME_CONTEXT extends AIAgentContext
      ? TOOLS extends AIAgentToolSet<RUNTIME_CONTEXT, DEFINITION_EXECUTION_CONTEXT>
        ? AIDurableAgentRunInput<RUNTIME_CONTEXT, DEFINITION_EXECUTION_CONTEXT, TOOLS>
        : never
      : never
    : never;

function memoryReader(
  graph: ReturnType<typeof getWorkflowGraphRuntime>,
  runId: string,
) {
  return {
    get: (key: string) => graph.memory.get({ instanceId: runId, kind: 'instance' }, key)?.value,
  };
}

function terminalCounts(
  memory: ReturnType<typeof memoryReader>,
  steps: readonly Readonly<{ node_id?: string | null; started_at: string | null }>[],
): { turns: number; toolCalls: number } {
  let toolCalls = 0;
  try {
    toolCalls = requireDurableControl(memory).totalToolCalls;
  } catch {
    // A state-corruption failure still receives a secret-safe terminal result.
  }
  const turns = steps.filter((step) => step.started_at !== null
    && typeof step.node_id === 'string'
    && /^turn-\d+-decide$/.test(step.node_id)).length;
  return { turns, toolCalls };
}

function requireIdentifier(value: string, label: string): string {
  if (typeof value !== 'string') {
    throw new AIError(`Durable AI agent ${label} is invalid.`, 'AI_REQUEST_INVALID', 400);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 512) {
    throw new AIError(`Durable AI agent ${label} is invalid.`, 'AI_REQUEST_INVALID', 400);
  }
  return normalized;
}

function runNotFound(): AIError {
  return new AIError('Durable AI agent run was not found.', 'AI_AGENT_EXECUTION_FAILED', 404);
}

function corruptRun(): AIError {
  return new AIError(
    'Durable AI agent run state is invalid.',
    'AI_AGENT_EXECUTION_FAILED',
    500,
  );
}
