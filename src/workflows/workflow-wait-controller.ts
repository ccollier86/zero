/** Channel-independent durable event and human-interaction wait execution. */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import {
  evaluateWorkflowExpression,
  isWorkflowExpression,
} from './workflow-expression';
import type { WorkflowGraphActivityExecutor } from './workflow-graph-activity-executor';
import { WorkflowError } from './workflow-error';
import {
  collectWorkflowNodeOutputs, resolveWorkflowNodeInput,
} from './workflow-graph-planner';
import { encodeWorkflowActivityReference } from './workflow-activity-reference-codec';
import {
  assertInteractionDeliveryStep,
  createInteractionDeliveryStepRow,
  interactionDeliveryActivityNode,
} from './workflow-interaction-delivery-records';
import type { WorkflowGraphStore } from './workflow-graph-store';
import type {
  WorkflowGraphIR,
  WorkflowWaitNode,
} from './workflow-ir';
import type { WorkflowInteractionService } from './workflow-interaction-service';
import { WorkflowInteractionEventBridge } from './workflow-interaction-event-bridge';
import type { WorkflowMemoryStore } from './workflow-memory-store';
import type { WorkflowRuntimeStore } from './workflow-runtime-store';
import { validateWorkflowSchemaValue } from './workflow-schema-snapshot';
import type { WorkflowInstanceRecord, WorkflowStepRecord } from './types';
import { serializeWorkflowRuntimeJson } from './workflow-runtime-json';

export class WorkflowWaitController {
  private readonly eventBridge: WorkflowInteractionEventBridge;

  constructor(
    private readonly store: WorkflowGraphStore,
    private readonly runtime: WorkflowRuntimeStore,
    private readonly executor: WorkflowGraphActivityExecutor,
    private readonly interactions: WorkflowInteractionService,
    private readonly memory: WorkflowMemoryStore,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.eventBridge = new WorkflowInteractionEventBridge(runtime, interactions, now);
  }

  async advance(
    instance: WorkflowInstanceRecord,
    graph: WorkflowGraphIR,
    node: WorkflowWaitNode,
  ): Promise<'completed' | 'waiting' | 'failed'> {
    const step = this.store.getNodeStep(instance.instance_id, node.id);
    if (!step || (step.status !== 'pending' && step.status !== 'waiting')) return 'waiting';
    return node.interaction
      ? this.advanceInteraction(instance, graph, node, step)
      : this.advanceEvent(instance, node, step);
  }

  private advanceEvent(
    instance: WorkflowInstanceRecord,
    node: WorkflowWaitNode,
    step: WorkflowStepRecord,
  ): 'completed' | 'waiting' | 'failed' {
    const now = this.now();
    const nowIso = now.toISOString();
    let result: 'completed' | 'waiting' | 'failed' = 'waiting';
    this.store.transaction(() => {
      const currentInstance = this.store.getInstance(instance.instance_id);
      const current = this.store.getStep(step.step_id);
      if (!currentInstance || currentInstance.status !== 'running' || !current
        || (current.status !== 'pending' && current.status !== 'waiting')) return;
      if (current.timeout_at && current.timeout_at <= nowIso) {
        this.failWait(currentInstance, current, 'Workflow wait expired', nowIso);
        result = 'failed';
        return;
      }
      const event = this.runtime.claimedEvent(current.step_id)
        ?? this.runtime.claimEvent(
          instance.instance_id,
          current.step_id,
          node.event,
          nowIso,
        );
      if (!event) {
        const timeoutAt = current.timeout_at ?? (node.timeoutMs
          ? new Date(now.getTime() + node.timeoutMs).toISOString()
          : null);
        this.store.updateStep(current.step_id, {
          status: 'waiting',
          timeout_at: timeoutAt,
          started_at: current.started_at ?? nowIso,
          updated_at: nowIso,
        });
        return;
      }
      const validationError = waitPayloadError(node, event.payload);
      if (validationError) {
        this.failWait(currentInstance, current, validationError, nowIso);
        this.consumeEvent(current.step_id, event.eventId);
        result = 'failed';
        return;
      }
      this.completeWait(current, event.payload, nowIso);
      this.consumeEvent(current.step_id, event.eventId);
      result = 'completed';
    });
    return result;
  }

  private async advanceInteraction(
    instance: WorkflowInstanceRecord,
    graph: WorkflowGraphIR,
    node: WorkflowWaitNode,
    step: WorkflowStepRecord,
  ): Promise<'completed' | 'waiting' | 'failed'> {
    let interaction = this.interactions.getByStep(instance.instance_id, step.step_id);
    if (!interaction) {
      const now = this.now();
      const openedAt = now.toISOString();
      const context = this.expressionContext(instance, graph, node.id);
      const request = node.interaction!.request === undefined
        ? null
        : isWorkflowExpression(node.interaction!.request)
          ? evaluateWorkflowExpression(node.interaction!.request, context)
          : node.interaction!.request;
      const requestJson = serializeWorkflowRuntimeJson(request, {
        code: 'WORKFLOW_OUTPUT_INVALID', label: 'Workflow interaction request',
        invalidStatus: 500, limitStatus: 500,
      });
      this.store.transaction(() => {
        const currentInstance = this.store.getInstance(instance.instance_id);
        const current = this.store.getStep(step.step_id);
        if (!currentInstance || currentInstance.status !== 'running'
          || !current || current.status !== 'pending') return;
        interaction = this.interactions.open({
          instanceId: instance.instance_id,
          nodeId: node.id,
          stepId: step.step_id,
          safeLabel: node.label ?? node.id,
          responderPolicy: { type: 'starter' },
          responseSchema: node.inputSchema ?? null,
          validatorActivityId: node.interaction!.validator
            ? encodeWorkflowActivityReference(node.interaction!.validator)
            : undefined,
          openedAt,
          expiresAt: node.timeoutMs
            ? new Date(now.getTime() + node.timeoutMs).toISOString()
            : null,
          maxRejections: node.interaction!.maxRejections,
          request,
        });
        this.store.updateStep(step.step_id, {
          status: 'waiting',
          input: requestJson,
          started_at: current.started_at ?? openedAt,
          timeout_at: interaction.expiresAt,
          updated_at: openedAt,
        });
      });
      if (!interaction) return 'waiting';
    }
    this.ensureDeliverySteps(instance, node, step);

    interaction = await this.eventBridge.consume({
      instanceId: instance.instance_id,
      nodeId: node.id,
      stepId: step.step_id,
      eventName: node.event,
      interaction,
    });
    const terminal = this.settleInteraction(instance, step, interaction);
    if (terminal) return terminal;

    const delivered = await this.deliver(instance, graph, node, step, interaction);
    if (!delivered) return 'waiting';
    interaction = this.interactions.get(interaction.interactionId)!;
    return this.settleInteraction(instance, step, interaction) ?? 'waiting';
  }

  private settleInteraction(
    instance: WorkflowInstanceRecord,
    step: WorkflowStepRecord,
    interaction: NonNullable<ReturnType<WorkflowInteractionService['get']>>,
  ): 'completed' | 'failed' | null {
    if (interaction.status === 'accepted') {
      const accepted = this.interactions.getAcceptedValue(interaction.interactionId);
      const now = this.now().toISOString();
      this.store.transaction(() => {
        const currentInstance = this.store.getInstance(instance.instance_id);
        const current = this.store.getStep(step.step_id);
        if (!currentInstance || currentInstance.status !== 'running'
          || !current || current.status !== 'waiting') return;
        this.completeWait(current, accepted, now);
      });
      return 'completed';
    }
    if (interaction.status === 'expired'
      || interaction.status === 'rejection_limit'
      || interaction.status === 'cancelled') {
      const now = this.now().toISOString();
      this.store.transaction(() => {
        const current = this.store.getStep(step.step_id);
        const currentInstance = this.store.getInstance(instance.instance_id);
        if (current && currentInstance && currentInstance.status === 'running') {
          this.failWait(currentInstance, current, `Workflow interaction ${interaction.status}`, now);
        }
      });
      return 'failed';
    }
    return null;
  }

  private ensureDeliverySteps(
    instance: WorkflowInstanceRecord,
    node: WorkflowWaitNode,
    parent: WorkflowStepRecord,
  ): void {
    const deliveries = node.interaction?.delivery ?? [];
    if (deliveries.length === 0) return;
    const now = this.now().toISOString();
    this.store.transaction(() => {
      const existing = this.store.listSteps(instance.instance_id)
        .filter((child) => child.parent_step_id === parent.step_id);
      const expectedKeys = new Set(deliveries.map((_delivery, index) => `delivery:${index}`));
      if (existing.some((child) => !expectedKeys.has(String(child.activation_key)))) {
        throw new TypeError('Workflow interaction delivery steps do not match the pinned definition');
      }
      deliveries.forEach((delivery, index) => {
        const activationKey = `delivery:${index}`;
        const matches = existing.filter((child) => child.activation_key === activationKey);
        if (matches.length > 1) {
          throw new TypeError('Workflow interaction delivery step identity is duplicated');
        }
        if (matches.length === 1) {
          assertInteractionDeliveryStep(
            matches[0]!, instance.instance_id, parent, delivery, index,
          );
          return;
        }
        this.store.insertStep(createInteractionDeliveryStepRow(
          instance.instance_id,
          parent,
          index,
          now,
        ));
      });
    });
  }

  private async deliver(
    instance: WorkflowInstanceRecord,
    graph: WorkflowGraphIR,
    node: WorkflowWaitNode,
    parent: WorkflowStepRecord,
    interaction: NonNullable<ReturnType<WorkflowInteractionService['get']>>,
  ): Promise<boolean> {
    const deliveries = node.interaction?.delivery ?? [];
    if (deliveries.length === 0) return true;
    const children = this.store.listSteps(instance.instance_id)
      .filter((child) => child.parent_step_id === parent.step_id)
      .sort((a, b) => String(a.activation_key).localeCompare(String(b.activation_key)));
    for (const [index, delivery] of deliveries.entries()) {
      const child = children.find((candidate) => candidate.activation_key === `delivery:${index}`);
      if (!child) throw new TypeError('Workflow interaction delivery step is missing');
      if (child.status === 'completed') continue;
      if (child.status === 'failed' && child.retry_at === null) {
        this.failDelivery(instance, parent, child.error ?? 'Interaction delivery failed');
        return false;
      }
      const input = {
        interactionId: interaction.interactionId,
        request: this.interactions.getRequestValue(interaction.interactionId),
      };
      const result = await this.executor.execute(
        instance.instance_id,
        child.step_id,
        graph,
        interactionDeliveryActivityNode(node, delivery, index),
        {
          value: input,
          inputOverride: input,
          index,
          key: `delivery:${index}`,
          memoryScope: { instanceId: instance.instance_id, kind: 'instance' },
          interaction,
          exposeItem: false,
          persistInput: false,
          persistOutput: false,
        },
      );
      if (result !== 'completed') return false;
    }
    return true;
  }

  private expressionContext(instance: WorkflowInstanceRecord, graph: WorkflowGraphIR, nodeId: string) {
    const steps = this.store.listRootSteps(instance.instance_id);
    const workflowInput = parseJson(instance.input);
    return {
      input: workflowInput,
      previous: resolveWorkflowNodeInput(
        nodeId, graph, steps, this.store.listEdges(instance.instance_id),
        this.store.listDecisions(instance.instance_id), workflowInput,
      ),
      outputs: collectWorkflowNodeOutputs(steps),
      memory: Object.fromEntries(this.memory.list({
        instanceId: instance.instance_id, kind: 'instance',
      }).map((entry) => [entry.key, entry.value])),
    };
  }

  private completeWait(step: WorkflowStepRecord, output: unknown, now: string): void {
    this.store.updateStep(step.step_id, {
      status: 'completed', output: serializeWorkflowRuntimeJson(output, {
        code: 'WORKFLOW_OUTPUT_INVALID', label: 'Workflow wait output',
        invalidStatus: 500, limitStatus: 500,
      }), error: null,
      timeout_at: null, completed_at: now, updated_at: now,
    });
  }

  private consumeEvent(stepId: string, eventId: string): void {
    if (this.runtime.consumeClaimedEvent(stepId, eventId)) return;
    throw new WorkflowError(
      'Workflow event claim could not be consumed',
      'WORKFLOW_STATE_INVALID',
      500,
    );
  }

  private failDelivery(
    instance: WorkflowInstanceRecord,
    step: WorkflowStepRecord,
    error: string,
  ): void {
    this.store.transaction(() => this.failWait(instance, step, error, this.now().toISOString()));
  }

  private failWait(
    instance: WorkflowInstanceRecord,
    step: WorkflowStepRecord,
    error: string,
    now: string,
  ): void {
    this.store.updateStep(step.step_id, {
      status: 'failed', error, timeout_at: null, retry_at: null,
      completed_at: now, updated_at: now,
    });
    this.store.updateInstance(instance.instance_id, {
      status: 'failed', error, current_step: step.step_index,
      completed_at: now, updated_at: now,
    });
    this.interactions.cancelForInstance(instance.instance_id);
    this.executor.abortInstance(instance.instance_id, error);
    emitPlatformCode(OBS_CODES.WORKFLOW_INSTANCE_FAILED, {
      metadata: { instanceId: instance.instance_id, stepId: step.step_id, reason: 'wait' },
    });
  }
}

function parseJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new TypeError('Persisted workflow JSON must be text');
  return JSON.parse(value);
}

function waitPayloadError(node: WorkflowWaitNode, payload: unknown): string | null {
  if (node.inputSchema === undefined) return null;
  try {
    return validateWorkflowSchemaValue(node.inputSchema, payload)
      ? null
      : `Workflow wait "${node.id}" received an invalid event payload`;
  } catch {
    return `Workflow wait "${node.id}" has an invalid input schema`;
  }
}
