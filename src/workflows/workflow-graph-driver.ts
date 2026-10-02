/**
 * Strict-frontier graph execution driver.
 *
 * Coalesces triggers per instance, validates authority and persisted state at
 * each frontier, advances ready/waiting nodes, and owns terminal cleanup.
 */

import { OBS_CODES } from '../observability/codes';
import type { WorkflowEachController } from './workflow-each-controller';
import { WorkflowError } from './workflow-error';
import type { WorkflowExecutionAuthorityGate } from './workflow-execution-authority-gate';
import type { WorkflowGraphActivityExecutor } from './workflow-graph-activity-executor';
import type { WorkflowGraphDefinitionResolver } from './workflow-graph-definition-resolver';
import type { WorkflowGraphInstanceController } from './workflow-graph-instance-controller';
import type { WorkflowGraphInteractionValidator } from './workflow-graph-interaction-validator';
import { planWorkflowGraph } from './workflow-graph-planner';
import { WorkflowGraphPump } from './workflow-graph-pump';
import { readValidatedWorkflowGraphState } from './workflow-graph-state-reader';
import type { WorkflowGraphStore } from './workflow-graph-store';
import type { WorkflowStructuralNodeController } from './workflow-structural-node-controller';
import type { WorkflowGraphIR, WorkflowIRNode } from './workflow-ir';
import type { WorkflowInteractionService } from './workflow-interaction-service';
import type { WorkflowObservability } from './workflow-observability';
import type { WorkflowRuntimeStore } from './workflow-runtime-store';
import type { WorkflowInstanceRecord } from './types';
import type { WorkflowWaitController } from './workflow-wait-controller';

export interface WorkflowGraphDriverCollaborators {
  store: WorkflowGraphStore;
  runtime: WorkflowRuntimeStore;
  activityExecutor: WorkflowGraphActivityExecutor;
  interactionValidator: WorkflowGraphInteractionValidator;
  interactions: WorkflowInteractionService;
  structures: WorkflowStructuralNodeController;
  each: WorkflowEachController;
  waits: WorkflowWaitController;
  instances: WorkflowGraphInstanceController;
  definitions: WorkflowGraphDefinitionResolver;
  authority: WorkflowExecutionAuthorityGate;
  observability: WorkflowObservability;
}

export class WorkflowGraphDriver {
  private readonly pump: WorkflowGraphPump;
  private stopped = false;

  constructor(private readonly collaborators: WorkflowGraphDriverCollaborators) {
    this.pump = new WorkflowGraphPump((instanceId) => this.drive(instanceId));
  }

  advance(instanceId: string): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return this.pump.advance(instanceId);
  }

  dispatch(instanceId: string, phase: string): void {
    void this.advance(instanceId).catch((error) => this.collaborators.observability.emitNow(
      OBS_CODES.WORKFLOW_ADVANCE_FAILED,
      { error, metadata: { instanceId, phase } },
    ));
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.pump.stop();
  }

  drain(): Promise<void> {
    return this.pump.drain();
  }

  private async drive(instanceId: string): Promise<void> {
    const {
      store,
      instances,
      interactionValidator,
    } = this.collaborators;
    try {
      await this.run(instanceId);
    } catch (error) {
      // Pause/cancel can abort work while an awaited validator or activity is
      // unwinding. Only a still-running instance may be failed by that error;
      // paused state is revalidated and retried when resume explicitly drives it.
      if (store.getInstance(instanceId)?.status === 'running') {
        instances.fail(instanceId, error, 'runtime-state');
      }
    } finally {
      instances.cleanupTerminal(instanceId);
      const status = store.getInstance(instanceId)?.status;
      if (status && ['completed', 'failed', 'cancelled'].includes(status)) {
        interactionValidator.abortInstance(instanceId, 'Workflow reached a terminal state');
      }
    }
  }

  private async run(instanceId: string): Promise<void> {
    const {
      store,
      authority,
      definitions,
      instances,
      structures,
    } = this.collaborators;
    const initial = store.getInstance(instanceId);
    if (!initial || initial.status !== 'running') return;
    if (!authority.validateInstance(instanceId)) return;
    const graph = definitions.resolvePinned(initial);
    for (let pass = 0; pass < 10_000; pass += 1) {
      if (this.stopped) return;
      const instance = store.getInstance(instanceId);
      if (!instance || instance.status !== 'running') return;
      if (!authority.validateInstance(instanceId)) return;
      instances.promoteDueRetries(instanceId);
      readValidatedWorkflowGraphState(store, instance, graph);
      const before = this.signature(instanceId);
      await this.driveWaiting(instance, graph);
      if (!authority.validateInstance(instanceId)) return;
      const snapshot = readValidatedWorkflowGraphState(store, instance, graph);
      const plan = planWorkflowGraph(snapshot);
      for (const node of plan.unreachable) structures.skip(instanceId, node.id);
      await this.driveReady(instance, graph, plan.ready);
      if (!authority.validateInstance(instanceId)) return;
      if (instances.completeIfDone(instanceId, graph)) return;
      instances.armInstance(instanceId);
      if (before === this.signature(instanceId)) return;
    }
    if (this.stopped) return;
    throw new WorkflowError(
      'Workflow graph exceeded its transition limit',
      'WORKFLOW_RUNTIME_LIMIT_EXCEEDED',
      500,
    );
  }

  private async driveWaiting(
    instance: WorkflowInstanceRecord,
    graph: WorkflowGraphIR,
  ): Promise<void> {
    const { store, waits, each } = this.collaborators;
    for (const step of store.listRootSteps(instance.instance_id)) {
      if (step.status !== 'waiting' || typeof step.node_id !== 'string') continue;
      const node = graph.nodes.find((candidate) => candidate.id === step.node_id);
      if (node?.kind === 'wait') await waits.advance(instance, graph, node);
      if (node?.kind === 'each') await each.advance(instance, graph, node);
    }
  }

  private async driveReady(
    instance: WorkflowInstanceRecord,
    graph: WorkflowGraphIR,
    nodes: readonly WorkflowIRNode[],
  ): Promise<void> {
    const {
      store,
      structures,
      activityExecutor,
      waits,
      each,
    } = this.collaborators;
    const activities: Array<Promise<unknown>> = [];
    for (const node of nodes) {
      if (node.kind !== 'activity' && node.kind !== 'wait' && node.kind !== 'each') {
        structures.complete(instance, graph, node);
      }
    }
    for (const node of nodes) {
      const step = store.getNodeStep(instance.instance_id, node.id);
      if (!step) continue;
      if (node.kind === 'activity') {
        activities.push(activityExecutor.execute(instance.instance_id, step.step_id, graph, node));
      } else if (node.kind === 'wait') {
        activities.push(waits.advance(instance, graph, node));
      } else if (node.kind === 'each') {
        activities.push(each.advance(instance, graph, node));
      }
    }
    await Promise.all(activities);
  }

  private signature(instanceId: string): string {
    const { store, interactions, runtime } = this.collaborators;
    const steps = store.listSteps(instanceId).map((step) => [
      step.step_id, step.status, step.retries, step.retry_at, step.output, step.error,
    ]);
    const interactionSignature = interactions.list(instanceId).map((interaction) => [
      interaction.interactionId,
      interaction.status,
      interaction.rejectionCount,
      interaction.updatedAt,
    ]);
    return JSON.stringify([
      steps,
      interactionSignature,
      runtime.eventDeliverySignature(instanceId),
    ]);
  }
}
