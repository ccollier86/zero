/**
 * Durable graph-runtime composition and orchestration boundary.
 *
 * Owns runtime collaborators, pump sequencing, recovery, and public lifecycle
 * methods. Node execution, persistence details, validation, and transitions
 * remain in their focused services.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { CompiledWorkflowDefinition } from './workflow-compiler';
import { WorkflowDefinitionVersionStore } from './workflow-definition-version-store';
import type { ResolvedWorkflowDefinitionVersion } from './workflow-definition-version-types';
import { WorkflowEachController } from './workflow-each-controller';
import { WorkflowError } from './workflow-error';
import { WorkflowGraphActivityExecutor } from './workflow-graph-activity-executor';
import {
  WorkflowGraphDefinitionResolver,
  type StartWorkflowGraphOptions,
} from './workflow-graph-definition-resolver';
import { WorkflowGraphInstanceController } from './workflow-graph-instance-controller';
import { createWorkflowGraphInteractionAuthority } from './workflow-graph-interaction-authority';
import { WorkflowGraphInteractionValidator } from './workflow-graph-interaction-validator';
import { WorkflowGraphPump } from './workflow-graph-pump';
import { planWorkflowGraph } from './workflow-graph-planner';
import { WorkflowGraphRecoveryCoordinator } from './workflow-graph-recovery';
import { readValidatedWorkflowGraphState } from './workflow-graph-state-reader';
import { WorkflowGraphStore } from './workflow-graph-store';
import { WorkflowGraphTransitionController } from './workflow-graph-transitions';
import { WorkflowGraphWakeScheduler } from './workflow-graph-wake-scheduler';
import type { WorkflowGraphIR, WorkflowIRNode } from './workflow-ir';
import { WorkflowInteractionAuthority } from './workflow-interaction-authority';
import { WorkflowInteractionService } from './workflow-interaction-service';
import type {
  SubmitWorkflowInteractionInput,
  WorkflowInteractionSubmissionResult,
} from './workflow-interaction-service';
import { WorkflowInteractionStore } from './workflow-interaction-store';
import type { WorkflowInteractionRecord } from './workflow-interaction-store';
import { validateWorkflowGraphIR } from './workflow-ir-validator';
import { WorkflowMemoryStore } from './workflow-memory-store';
import type { WorkflowRegistry } from './workflow-registry';
import { WorkflowRuntimeStore } from './workflow-runtime-store';
import { resolveWorkflowShutdownGraceMs } from './workflow-shutdown-policy';
import { WorkflowStructuralNodeController } from './workflow-structural-node-controller';
import type { WorkflowInstanceRecord, WorkflowStepRecord } from './types';
import { WorkflowWaitController } from './workflow-wait-controller';
import type { WorkflowWakeTimer } from './workflow-wake-coordinator';
import { serializeWorkflowRuntimeJson } from './workflow-runtime-json';
export interface WorkflowGraphRuntimeOptions {
  now?: () => Date;
  shutdownGraceMs?: number;
  interactionAuthority?: WorkflowInteractionAuthority;
  wakeTimer?: WorkflowWakeTimer | false;
}
export type { StartWorkflowGraphOptions } from './workflow-graph-definition-resolver';
export class WorkflowGraphRuntime {
  readonly versions: WorkflowDefinitionVersionStore;
  readonly interactions: WorkflowInteractionService;
  readonly memory: WorkflowMemoryStore;
  private readonly store: WorkflowGraphStore;
  private readonly runtime: WorkflowRuntimeStore;
  private readonly activityExecutor: WorkflowGraphActivityExecutor;
  private readonly interactionValidator: WorkflowGraphInteractionValidator;
  private readonly structures: WorkflowStructuralNodeController;
  private readonly each: WorkflowEachController;
  private readonly waits: WorkflowWaitController;
  private readonly transitions: WorkflowGraphTransitionController;
  private readonly wakes: WorkflowGraphWakeScheduler;
  private readonly instances: WorkflowGraphInstanceController;
  private readonly pump: WorkflowGraphPump;
  private readonly definitions: WorkflowGraphDefinitionResolver;
  private readonly recovery: WorkflowGraphRecoveryCoordinator;
  private readonly now: () => Date;
  private disposed = false;

  constructor(
    db: ReactiveDB,
    private readonly registry: WorkflowRegistry,
    options: WorkflowGraphRuntimeOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.store = new WorkflowGraphStore(db);
    this.runtime = new WorkflowRuntimeStore(db);
    this.versions = new WorkflowDefinitionVersionStore(db, () => this.now().toISOString());
    this.definitions = new WorkflowGraphDefinitionResolver(this.versions, registry);
    this.memory = new WorkflowMemoryStore(db, { clock: this.now });
    const interactionStore = new WorkflowInteractionStore(db);
    const shutdownGraceMs = resolveWorkflowShutdownGraceMs(options.shutdownGraceMs);
    this.interactionValidator = new WorkflowGraphInteractionValidator(
      registry,
      this.store,
      this.memory,
      shutdownGraceMs,
    );
    this.interactions = new WorkflowInteractionService(interactionStore, {
      authority: options.interactionAuthority
        ?? createWorkflowGraphInteractionAuthority(this.store),
      clock: this.now,
      shutdownGraceMs,
      requireRunningInstance: true,
      validateActivity: (activityId, context) => this.interactionValidator.validate(activityId, context),
    });
    this.wakes = new WorkflowGraphWakeScheduler({
      retry: (instanceId) => this.dispatch(instanceId, 'retry'),
      timeout: (instanceId, stepId, expectedAt) => {
        this.instances.expire(instanceId, stepId, expectedAt);
      },
    }, this.now, options.wakeTimer ?? false);
    this.activityExecutor = new WorkflowGraphActivityExecutor(
      this.store,
      this.runtime,
      registry.activities,
      this.memory,
      {
        now: this.now,
        shutdownGraceMs,
        onRetryScheduled: (instanceId, stepId, at) => this.wakes.armRetry(instanceId, stepId, at),
        onTimeoutScheduled: (instanceId, stepId, at) => this.wakes.armTimeout(instanceId, stepId, at),
      },
    );
    this.structures = new WorkflowStructuralNodeController(this.store, this.memory, this.now);
    this.each = new WorkflowEachController(this.store, this.activityExecutor, this.memory, this.now);
    this.waits = new WorkflowWaitController(
      this.store,
      this.runtime,
      this.activityExecutor,
      this.interactions,
      this.memory,
      this.now,
    );
    this.transitions = new WorkflowGraphTransitionController(
      this.store,
      this.runtime,
      this.activityExecutor,
      this.interactions,
      this.wakes,
      this.now,
    );
    this.instances = new WorkflowGraphInstanceController(
      this.store,
      this.runtime,
      this.activityExecutor,
      this.interactions,
      this.wakes,
      (instanceId, phase) => this.dispatch(instanceId, phase),
      this.now,
    );
    this.recovery = new WorkflowGraphRecoveryCoordinator(
      this.store,
      this.definitions,
      this.instances,
      (instanceId, phase) => this.dispatch(instanceId, phase),
    );
    this.pump = new WorkflowGraphPump((instanceId) => this.drive(instanceId));
    this.store.transaction(() => this.definitions.publishRegisteredDefinitions());
  }

  async startRegistered(
    definition: CompiledWorkflowDefinition,
    input: unknown,
    startedBy: string | null,
    options: StartWorkflowGraphOptions = {},
  ): Promise<string> {
    this.assertAvailable();
    const resolved = this.definitions.resolveRegistered(definition, input, options);
    return this.createAndAdvance(resolved, input, startedBy);
  }

  async startPersisted(
    name: string,
    input: unknown,
    startedBy: string | null,
    options: StartWorkflowGraphOptions = {},
  ): Promise<string> {
    this.assertAvailable();
    const resolved = this.definitions.resolvePersisted(name, input, options);
    return this.createAndAdvance(resolved, input, startedBy);
  }

  async advance(instanceId: string): Promise<void> {
    if (this.disposed) return;
    return this.pump.advance(instanceId);
  }

  prepareRecovery(): number {
    this.assertAvailable();
    for (const instance of this.store.listNonterminalInstances()) {
      this.runtime.validateEventUsage(instance.instance_id);
      this.runtime.validateGraphEventState(instance.instance_id);
    }
    return this.recovery.prepare();
  }

  activateRecovery(): void {
    this.assertAvailable();
    this.recovery.activate();
  }

  pollRetries(): number {
    const ids = this.store.listDueInstanceIds(this.now().toISOString());
    for (const id of ids) this.dispatch(id, 'retry-poll');
    return ids.length;
  }

  pollTimeouts(): number {
    const steps = this.store.listExpiredSteps(this.now().toISOString());
    for (const step of steps) {
      this.instances.expire(step.instance_id, step.step_id, step.timeout_at!);
    }
    const interactions = this.interactions.expireDue();
    interactions.forEach((interaction) => this.dispatch(
      interaction.instanceId,
      'interaction-expiry',
    ));
    return steps.length + interactions.length;
  }

  getInstance(instanceId: string): WorkflowInstanceRecord | null {
    return this.store.getInstance(instanceId);
  }

  isGraphInstance(instanceId: string): boolean {
    return typeof this.store.getInstance(instanceId)?.graph_json === 'string';
  }

  getSteps(instanceId: string): WorkflowStepRecord[] {
    return this.store.listSteps(instanceId);
  }

  listInteractions(instanceId: string): WorkflowInteractionRecord[] {
    return this.interactions.list(instanceId);
  }

  async submitInteraction(
    input: SubmitWorkflowInteractionInput,
  ): Promise<WorkflowInteractionSubmissionResult> {
    this.assertAvailable();
    const result = await this.interactions.submit(input);
    const instance = this.store.getInstance(result.interaction.instanceId);
    if (instance?.status === 'running' && result.interaction.status !== 'open') {
      await this.advance(instance.instance_id);
    }
    return result;
  }

  cancel(instanceId: string): void {
    this.transitions.cancel(instanceId);
    this.interactions.abortInstance(instanceId, new WorkflowError(
      'Workflow interaction cannot be processed after its workflow stopped',
      'WORKFLOW_STATE_INVALID',
      409,
    ));
    this.interactionValidator.abortInstance(instanceId, 'Workflow cancelled');
  }

  pause(instanceId: string): void {
    this.transitions.pause(instanceId);
    this.interactions.abortInstance(instanceId, new WorkflowError(
      'Workflow is paused; retry the interaction response after resume',
      'WORKFLOW_DRAINING',
      409,
      true,
    ));
    this.interactionValidator.abortInstance(instanceId, 'Workflow paused');
  }

  resume(instanceId: string): Promise<void> {
    if (this.interactionValidator.isInstanceDraining(instanceId)
      || this.interactions.isInstanceDraining(instanceId)) {
      throw new WorkflowError(
        'Workflow is still draining interaction work; retry resume shortly',
        'WORKFLOW_DRAINING',
        409,
        true,
      );
    }
    return this.transitions.resume(instanceId, (id) => this.advance(id));
  }

  abortInstance(instanceId: string, reason: string): void {
    this.activityExecutor.abortInstance(instanceId, reason);
    this.interactionValidator.abortInstance(instanceId, reason);
  }

  isInstanceDraining(instanceId: string): boolean {
    return this.activityExecutor.isInstanceDraining(instanceId)
      || this.interactionValidator.isInstanceDraining(instanceId)
      || this.interactions.isInstanceDraining(instanceId);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.pump.stop();
    this.wakes.dispose();
    const executor = this.activityExecutor.dispose();
    const validators = this.interactionValidator.dispose();
    const interactions = this.interactions.dispose();
    await Promise.allSettled([this.pump.drain(), executor, validators, interactions]);
  }

  private async createAndAdvance(
    definition: ResolvedWorkflowDefinitionVersion,
    input: unknown,
    startedBy: string | null,
  ): Promise<string> {
    const graph = definition.graph as WorkflowGraphIR;
    validateWorkflowGraphIR(graph, {
      allowLegacyCompatibility: definition.version.graph_format === 'legacy',
    });
    const instanceId = crypto.randomUUID();
    this.store.createInstance({
      instanceId,
      definitionId: definition.catalog.definition_id,
      definitionVersionId: definition.version.version_id,
      definitionVersion: definition.version.version_number,
      name: definition.catalog.name,
      graph,
      graphJson: definition.version.graph_json,
      graphFingerprint: definition.version.fingerprint,
      inputJson: serializeWorkflowRuntimeJson(input, {
        code: 'WORKFLOW_INPUT_INVALID', label: 'Workflow input',
      }),
      startedBy,
      now: this.now().toISOString(),
    });
    emitPlatformCode(OBS_CODES.WORKFLOW_INSTANCE_STARTED, {
      metadata: {
        instanceId,
        name: definition.catalog.name,
        version: definition.version.version_number,
        startedBy,
      },
    });
    await this.advance(instanceId);
    return instanceId;
  }

  private async drive(instanceId: string): Promise<void> {
    try {
      await this.run(instanceId);
    } catch (error) {
      // Pause/cancel can abort work while an awaited validator or activity is
      // unwinding. Only a still-running instance may be failed by that error;
      // paused state is revalidated and retried when resume explicitly drives it.
      if (this.store.getInstance(instanceId)?.status === 'running') {
        this.instances.fail(instanceId, error, 'runtime-state');
      }
    } finally {
      this.instances.cleanupTerminal(instanceId);
      const status = this.store.getInstance(instanceId)?.status;
      if (status && ['completed', 'failed', 'cancelled'].includes(status)) {
        this.interactionValidator.abortInstance(instanceId, 'Workflow reached a terminal state');
      }
    }
  }

  private async run(instanceId: string): Promise<void> {
    const initial = this.store.getInstance(instanceId);
    if (!initial || initial.status !== 'running') return;
    const graph = this.loadValidatedGraph(initial);
    for (let pass = 0; pass < 10_000; pass += 1) {
      if (this.disposed) return;
      const instance = this.store.getInstance(instanceId);
      if (!instance || instance.status !== 'running') return;
      this.instances.promoteDueRetries(instanceId);
      readValidatedWorkflowGraphState(this.store, instance, graph);
      const before = this.signature(instanceId);
      await this.driveWaiting(instance, graph);
      const snapshot = readValidatedWorkflowGraphState(this.store, instance, graph);
      const plan = planWorkflowGraph(snapshot);
      for (const node of plan.unreachable) this.structures.skip(instanceId, node.id);
      await this.driveReady(instance, graph, plan.ready);
      if (this.instances.completeIfDone(instanceId, graph)) return;
      this.instances.armInstance(instanceId);
      if (before === this.signature(instanceId)) return;
    }
    if (this.disposed) return;
    throw new WorkflowError('Workflow graph exceeded its transition limit', 'WORKFLOW_GRAPH_INVALID', 500);
  }

  private async driveWaiting(instance: WorkflowInstanceRecord, graph: WorkflowGraphIR): Promise<void> {
    for (const step of this.store.listRootSteps(instance.instance_id)) {
      if (step.status !== 'waiting' || typeof step.node_id !== 'string') continue;
      const node = graph.nodes.find((candidate) => candidate.id === step.node_id);
      if (node?.kind === 'wait') await this.waits.advance(instance, graph, node);
      if (node?.kind === 'each') await this.each.advance(instance, graph, node);
    }
  }

  private async driveReady(
    instance: WorkflowInstanceRecord,
    graph: WorkflowGraphIR,
    nodes: readonly WorkflowIRNode[],
  ): Promise<void> {
    const activities: Array<Promise<unknown>> = [];
    for (const node of nodes) {
      if (node.kind !== 'activity' && node.kind !== 'wait' && node.kind !== 'each') {
        this.structures.complete(instance, graph, node);
      }
    }
    for (const node of nodes) {
      const step = this.store.getNodeStep(instance.instance_id, node.id);
      if (!step) continue;
      if (node.kind === 'activity') {
        activities.push(this.activityExecutor.execute(instance.instance_id, step.step_id, graph, node));
      } else if (node.kind === 'wait') {
        activities.push(this.waits.advance(instance, graph, node));
      } else if (node.kind === 'each') {
        activities.push(this.each.advance(instance, graph, node));
      }
    }
    await Promise.all(activities);
  }

  private loadValidatedGraph(instance: WorkflowInstanceRecord): WorkflowGraphIR {
    return this.definitions.resolvePinned(instance);
  }
  private signature(instanceId: string): string {
    const steps = this.store.listSteps(instanceId).map((step) => [
      step.step_id, step.status, step.retries, step.retry_at, step.output, step.error,
    ]);
    const interactions = this.interactions.list(instanceId).map((interaction) => [
      interaction.interactionId,
      interaction.status,
      interaction.rejectionCount,
      interaction.updatedAt,
    ]);
    return JSON.stringify([
      steps,
      interactions,
      this.runtime.eventDeliverySignature(instanceId),
    ]);
  }

  private dispatch(instanceId: string, phase: string): void {
    void this.advance(instanceId).catch((error) => emitPlatformCode(
      OBS_CODES.WORKFLOW_ADVANCE_FAILED,
      { error, metadata: { instanceId, phase } },
    ));
  }

  private assertAvailable(): void {
    if (this.disposed) throw new WorkflowError('Workflow graph runtime is not available', 'WORKFLOW_NOT_READY', 503);
  }
}
