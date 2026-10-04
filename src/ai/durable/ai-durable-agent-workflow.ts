/**
 * ai-durable-agent-workflow.ts
 *
 * Compiles immutable AI-agent definitions into finite Torrent graphs and
 * installs their trusted activities. It does not start or inspect runs.
 */

import { t } from 'elysia';

import type { WorkflowDefinitionAccessPolicy } from '../../workflows/types';
import {
  choose,
  each,
  flow,
  otherwise,
  requestAndWait,
  step,
  when,
  type WorkflowDslNode,
} from '../../workflows/workflow-dsl';
import { expr } from '../../workflows/workflow-expression';
import type { WorkflowRegistry } from '../../workflows/workflow-registry';
import type {
  AIAgentDefinition,
  AnyAIAgentDefinition,
} from '../agents/ai-agent-definition';
import { AIError } from '../ai-errors';
import { emitAIAgentLifecycle } from '../agents/ai-agent-observability';
import type { AIAgentLifecycleEvent } from '../agents/ai-agent-types';
import { assertAIDurableDefinitionCapacity } from './ai-durable-agent-capacity';
import {
  AI_DURABLE_ACTIVITIES,
  AI_DURABLE_ACTIVITY_VERSION,
  AIDurableAgentActivities,
} from './ai-durable-agent-activities';
import { AI_DURABLE_MEMORY_KEYS, durableToolReferencesKey } from './ai-durable-agent-state';
import {
  AI_DURABLE_AGENT_STATE_VERSION,
  type AIDurableAgentRuntimeOptions,
  type RegisteredAIDurableAgent,
} from './ai-durable-agent-types';

const BRIDGE_GRAPH_VERSION = 1;
const APPROVAL_EVENT = 'zero.ai.durable-agent.approval';

export interface RegisterAIDurableAgentOptions {
  readonly access?: WorkflowDefinitionAccessPolicy;
}

/** Installs one generic activity set and code-owned graph per exact agent version. */
export class AIDurableAgentWorkflowRuntime<
  EXECUTION_CONTEXT = undefined,
  TServices = unknown,
> {
  private readonly registered = new Map<string, RegisteredAIDurableAgent>();

  constructor(
    private readonly registry: WorkflowRegistry,
    private readonly options: AIDurableAgentRuntimeOptions<EXECUTION_CONTEXT, TServices>,
  ) {
    this.registerActivities();
  }

  /** Register one immutable definition and its finite, version-pinned graph. */
  register<DEFINITION extends AIAgentDefinition<any, EXECUTION_CONTEXT, any, any>>(
    definition: DEFINITION,
    options: RegisterAIDurableAgentOptions = {},
  ): RegisteredAIDurableAgent<DEFINITION> {
    assertAIDurableDefinitionCapacity(definition);
    const key = agentKey(definition.name, definition.version);
    if (this.registered.has(key)) {
      throw new AIError(
        `Durable AI agent is already installed: ${definition.name}@${definition.version}.`,
        'AI_AGENT_DEFINITION_INVALID',
        409,
      );
    }
    const known = this.options.agents.get(definition);
    if (!known) this.options.agents.register(definition);
    else if (known !== definition) {
      throw new AIError(
        `AI agent version is bound to a different definition: ${definition.name}@${definition.version}.`,
        'AI_AGENT_DEFINITION_INVALID',
        409,
      );
    }

    const identity = workflowIdentity(definition, options.access);
    this.registry.registerWorkflow({
      name: identity.name,
      version: identity.version,
      activate: true,
      inputSchema: publicEnvelopeSchema(definition),
      ...(options.access === undefined ? {} : { access: options.access }),
      flow: flow(...buildTurn(definition, 0)),
    });
    const descriptor = Object.freeze({
      definition,
      workflowName: identity.name,
      workflowVersion: identity.version,
    });
    this.registered.set(key, descriptor);
    return descriptor;
  }

  /** Resolve one exact installed definition without selecting a latest version. */
  require(name: string, version: string): RegisteredAIDurableAgent {
    const descriptor = this.registered.get(agentKey(name, version));
    if (descriptor) return descriptor;
    throw new AIError(
      `Durable AI agent is not installed: ${name}@${version}.`,
      'AI_AGENT_NOT_REGISTERED',
      404,
    );
  }

  list(): readonly RegisteredAIDurableAgent[] {
    return Object.freeze([...this.registered.values()]);
  }

  /** Emit one secret-safe lifecycle fact through the app-bound observer. */
  emitLifecycle(event: AIAgentLifecycleEvent): void {
    emitAIAgentLifecycle(event, this.options.observer, this.options.emitCode);
  }

  private registerActivities(): void {
    const activities = new AIDurableAgentActivities(this.options);
    const definitions = [
      [AI_DURABLE_ACTIVITIES.decide, activities.decide],
      [AI_DURABLE_ACTIVITIES.recordApproval, activities.recordApproval],
      [AI_DURABLE_ACTIVITIES.executeTool, activities.executeTool],
      [AI_DURABLE_ACTIVITIES.assemble, activities.assemble],
      [AI_DURABLE_ACTIVITIES.finalize, activities.finalize],
      [AI_DURABLE_ACTIVITIES.exhaust, activities.exhaust],
    ] as const;
    for (const [name, handler] of definitions) {
      this.registry.registerActivity({
        name,
        version: AI_DURABLE_ACTIVITY_VERSION,
        handler: handler as never,
        capabilities: ['ai'],
        databaseCallable: false,
        default: true,
      });
    }
  }
}

function buildTurn(
  definition: AnyAIAgentDefinition,
  turn: number,
): WorkflowDslNode[] {
  const prefix = `turn-${turn}`;
  const activity = (name: string) => ({ name, version: AI_DURABLE_ACTIVITY_VERSION });
  const timeout = stepTimeoutMs(definition);
  const nodes: WorkflowDslNode[] = [
    step(`${prefix}-decide`, activity(AI_DURABLE_ACTIVITIES.decide), {
      label: `Agent decision ${turn + 1}`,
      input: expr.literal({ turn }),
      retries: 1,
      ...(timeout === undefined ? {} : { timeoutMs: timeout }),
    }),
    choose(
      `${prefix}-approval-gate`,
      when(
        expr.eq(expr.memory([AI_DURABLE_MEMORY_KEYS.control, 'approvalRequired']), true),
        requestAndWait(`${prefix}-approval`, APPROVAL_EVENT, {
          label: `Approve agent tools for decision ${turn + 1}`,
          request: expr.memory([AI_DURABLE_MEMORY_KEYS.approvalRequest]),
          inputSchema: t.Object({
            approved: t.Boolean(),
            reason: t.Optional(t.String({ maxLength: 512 })),
          }, { additionalProperties: false }),
          maxRejections: 5,
          ...(totalTimeoutMs(definition) === undefined
            ? {}
            : { timeoutMs: totalTimeoutMs(definition) }),
        }),
        step(`${prefix}-record-approval`, activity(AI_DURABLE_ACTIVITIES.recordApproval), {
          label: `Record approval for decision ${turn + 1}`,
          input: expr.previous(),
          retries: 1,
        }),
      ),
      otherwise(),
    ),
    each(
      `${prefix}-tools`,
      expr.memory([durableToolReferencesKey(turn)]),
      flow(step(`${prefix}-tool`, activity(AI_DURABLE_ACTIVITIES.executeTool), {
        label: `Execute tool for decision ${turn + 1}`,
        retries: 3,
        ...(toolStepTimeoutMs(definition) === undefined
          ? {}
          : { timeoutMs: toolStepTimeoutMs(definition) }),
      })),
      {
        label: `Agent tools for decision ${turn + 1}`,
        concurrency: definition.limits.maxToolCallsPerStep,
        itemKey: expr.item('index'),
        visibility: 'private',
      },
    ),
    step(`${prefix}-assemble`, activity(AI_DURABLE_ACTIVITIES.assemble), {
      label: `Assemble decision ${turn + 1}`,
      input: expr.literal({ turn }),
      retries: 1,
    }),
  ];

  const terminal = turn + 1 >= definition.limits.maxSteps
    ? [step(`${prefix}-exhaust`, activity(AI_DURABLE_ACTIVITIES.exhaust), {
        label: 'Agent decision limit reached', input: expr.literal({ turn }), retries: 1,
      })]
    : buildTurn(definition, turn + 1);
  nodes.push(choose(
    `${prefix}-completion-gate`,
    when(
      expr.eq(expr.memory([AI_DURABLE_MEMORY_KEYS.control, 'completed']), true),
      step(`${prefix}-finalize`, activity(AI_DURABLE_ACTIVITIES.finalize), {
        label: 'Finalize agent run', input: expr.literal({ turn }), retries: 1,
      }),
    ),
    otherwise(...terminal),
  ));
  return nodes;
}

function publicEnvelopeSchema(definition: AnyAIAgentDefinition) {
  return t.Object({
    kind: t.Literal('zero.ai.durable-agent'),
    stateVersion: t.Literal(AI_DURABLE_AGENT_STATE_VERSION),
    agent: t.Object({
      name: t.Literal(definition.name),
      version: t.Literal(definition.version),
    }, { additionalProperties: false }),
  }, { additionalProperties: false });
}

function workflowIdentity(
  definition: AnyAIAgentDefinition,
  access: WorkflowDefinitionAccessPolicy | undefined,
): { name: string; version: number } {
  const content = JSON.stringify({
    bridge: BRIDGE_GRAPH_VERSION,
    name: definition.name,
    version: definition.version,
    limits: definition.limits,
    timeout: definition.timeout ?? null,
    access: access ?? null,
  });
  const digest = new Bun.CryptoHasher('sha256').update(content).digest('hex');
  const safeName = definition.name.slice(0, 128);
  return {
    name: `zero.ai.agent.${safeName}.${digest.slice(0, 24)}`,
    version: Math.max(1, Number.parseInt(digest.slice(0, 12), 16)),
  };
}

function stepTimeoutMs(definition: AnyAIAgentDefinition): number | undefined {
  return typeof definition.timeout === 'number'
    ? definition.timeout
    : definition.timeout?.stepMs ?? definition.timeout?.totalMs;
}

function toolStepTimeoutMs(definition: AnyAIAgentDefinition): number | undefined {
  return typeof definition.timeout === 'number'
    ? definition.timeout
    : definition.timeout?.toolMs ?? definition.timeout?.totalMs;
}

function totalTimeoutMs(definition: AnyAIAgentDefinition): number | undefined {
  return typeof definition.timeout === 'number'
    ? definition.timeout
    : definition.timeout?.totalMs;
}

function agentKey(name: string, version: string): string {
  return `${name}\u0000${version}`;
}
