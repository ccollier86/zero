/**
 * Stable public graph-runtime facade.
 *
 * Delegates dependency assembly, atomic starts, and frontier driving to focused
 * collaborators while preserving the framework's graph lifecycle API.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import type { CompiledWorkflowDefinition } from './workflow-compiler';
import type { WorkflowAccessPrincipal } from './workflow-access';
import { WorkflowError } from './workflow-error';
import type { WorkflowPersistedExecutionAuthority } from './workflow-execution-authority';
import type { StartWorkflowGraphOptions } from './workflow-graph-definition-resolver';
import type {
  SubmitWorkflowInteractionInput,
  WorkflowInteractionSubmissionResult,
} from './workflow-interaction-service';
import type { WorkflowInteractionRecord } from './workflow-interaction-store';
import {
  toPublicWorkflowGraphTopology,
  type WorkflowPublicTopology,
} from './workflow-public-topology';
import type { WorkflowRegistry } from './workflow-registry';
import {
  createWorkflowGraphRuntimeComposition,
  type WorkflowGraphRuntimeComposition,
  type WorkflowGraphRuntimeCompositionOptions,
} from './workflow-graph-runtime-composition';
import type { WorkflowInstanceRecord, WorkflowStepRecord } from './types';

export interface WorkflowGraphRuntimeOptions
  extends WorkflowGraphRuntimeCompositionOptions {}
export type { StartWorkflowGraphOptions } from './workflow-graph-definition-resolver';
export class WorkflowGraphRuntime {
  readonly versions: WorkflowGraphRuntimeComposition['versions'];
  readonly interactions: WorkflowGraphRuntimeComposition['interactions'];
  readonly memory: WorkflowGraphRuntimeComposition['memory'];
  private readonly store: WorkflowGraphRuntimeComposition['store'];
  private readonly runtime: WorkflowGraphRuntimeComposition['runtime'];
  private readonly activityExecutor: WorkflowGraphRuntimeComposition['activityExecutor'];
  private readonly interactionValidator: WorkflowGraphRuntimeComposition['interactionValidator'];
  private readonly transitions: WorkflowGraphRuntimeComposition['transitions'];
  private readonly wakes: WorkflowGraphRuntimeComposition['wakes'];
  private readonly instances: WorkflowGraphRuntimeComposition['instances'];
  private readonly driver: WorkflowGraphRuntimeComposition['driver'];
  private readonly starts: WorkflowGraphRuntimeComposition['starts'];
  private readonly definitions: WorkflowGraphRuntimeComposition['definitions'];
  private readonly recovery: WorkflowGraphRuntimeComposition['recovery'];
  private readonly authority: WorkflowGraphRuntimeComposition['authority'];
  private readonly now: WorkflowGraphRuntimeComposition['now'];
  private disposed = false;

  constructor(
    db: ReactiveDB,
    registry: WorkflowRegistry,
    options: WorkflowGraphRuntimeOptions,
  ) {
    const composition = createWorkflowGraphRuntimeComposition(db, registry, options, {
      advance: (instanceId) => this.advance(instanceId),
      dispatch: (instanceId, phase) => this.dispatch(instanceId, phase),
    });
    this.now = composition.now;
    this.authority = composition.authority;
    this.store = composition.store;
    this.runtime = composition.runtime;
    this.versions = composition.versions;
    this.definitions = composition.definitions;
    this.memory = composition.memory;
    this.interactionValidator = composition.interactionValidator;
    this.interactions = composition.interactions;
    this.wakes = composition.wakes;
    this.activityExecutor = composition.activityExecutor;
    this.transitions = composition.transitions;
    this.instances = composition.instances;
    this.driver = composition.driver;
    this.recovery = composition.recovery;
    this.starts = composition.starts;
  }

  async startRegistered(
    definition: CompiledWorkflowDefinition,
    input: unknown,
    startedBy: string | null,
    authority: WorkflowPersistedExecutionAuthority,
    principal: WorkflowAccessPrincipal,
    options: StartWorkflowGraphOptions = {},
    assertCurrentAuthority?: () => void,
  ): Promise<string> {
    this.assertAvailable();
    return this.starts.startRegistered(
      definition,
      input,
      startedBy,
      authority,
      principal,
      options,
      assertCurrentAuthority,
    );
  }

  async startPersisted(
    name: string,
    input: unknown,
    startedBy: string | null,
    authority: WorkflowPersistedExecutionAuthority,
    principal: WorkflowAccessPrincipal,
    options: StartWorkflowGraphOptions = {},
    assertCurrentAuthority?: () => void,
  ): Promise<string> {
    this.assertAvailable();
    return this.starts.startPersisted(
      name,
      input,
      startedBy,
      authority,
      principal,
      options,
      assertCurrentAuthority,
    );
  }

  /** Test tenant namespace ownership before applying global-code fallback. */
  hasPersistedDefinition(
    name: string,
    authority: WorkflowPersistedExecutionAuthority,
  ): boolean {
    return this.starts.hasPersistedDefinition(name, authority);
  }

  /** Final tenant-namespace fence for registered legacy-code starts. */
  assertRegisteredNamespaceCurrent(
    name: string,
    authority: WorkflowPersistedExecutionAuthority,
  ): void {
    this.starts.assertRegisteredNamespaceCurrent(name, authority);
  }

  async advance(instanceId: string): Promise<void> {
    if (this.disposed) return;
    return this.driver.advance(instanceId);
  }

  prepareRecovery(): number {
    this.assertAvailable();
    for (const instance of this.store.listNonterminalInstances()) {
      // Authority must fail closed before normalization or publication. A
      // failed validation terminalizes the instance, so recovery.prepare()
      // will exclude it when it obtains its fresh candidate set below.
      if (!this.authority.validateRecoveryInstance(instance.instance_id)) continue;
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

  /** Resolve and sanitize the immutable version pinned to this exact run. */
  getPublicTopology(instance: WorkflowInstanceRecord): WorkflowPublicTopology {
    try {
      return toPublicWorkflowGraphTopology(instance, this.definitions.resolvePinned(instance));
    } catch (error) {
      if (error instanceof WorkflowError
        && error.code === 'WORKFLOW_STATE_INVALID'
        && error.status === 500) throw error;
      throw new WorkflowError(
        'Workflow run topology is invalid',
        'WORKFLOW_STATE_INVALID',
        500,
      );
    }
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

  cancel(instanceId: string, assertCurrentAuthority?: () => void): void {
    this.transitions.cancel(instanceId, assertCurrentAuthority);
    this.interactions.abortInstance(instanceId, new WorkflowError(
      'Workflow interaction cannot be processed after its workflow stopped',
      'WORKFLOW_STATE_INVALID',
      409,
    ));
    this.interactionValidator.abortInstance(instanceId, 'Workflow cancelled');
  }

  pause(instanceId: string, assertCurrentAuthority?: () => void): void {
    this.transitions.pause(instanceId, assertCurrentAuthority);
    this.interactions.abortInstance(instanceId, new WorkflowError(
      'Workflow is paused; retry the interaction response after resume',
      'WORKFLOW_DRAINING',
      409,
      true,
    ));
    this.interactionValidator.abortInstance(instanceId, 'Workflow paused');
  }

  resume(instanceId: string, assertCurrentAuthority?: () => void): Promise<void> {
    if (this.interactionValidator.isInstanceDraining(instanceId)
      || this.interactions.isInstanceDraining(instanceId)) {
      throw new WorkflowError(
        'Workflow is still draining interaction work; retry resume shortly',
        'WORKFLOW_DRAINING',
        409,
        true,
      );
    }
    return this.transitions.resume(
      instanceId,
      (id) => this.advance(id),
      assertCurrentAuthority,
    );
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
    this.driver.stop();
    this.wakes.dispose();
    const executor = this.activityExecutor.dispose();
    const validators = this.interactionValidator.dispose();
    const interactions = this.interactions.dispose();
    const settlements = await Promise.allSettled([
      this.driver.drain(),
      executor,
      validators,
      interactions,
    ]);
    const failures = settlements.flatMap((settlement) => (
      settlement.status === 'rejected' ? [settlement.reason] : []
    ));
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Workflow graph runtime failed to dispose');
    }
  }

  private dispatch(instanceId: string, phase: string): void {
    this.driver.dispatch(instanceId, phase);
  }

  private assertAvailable(): void {
    if (this.disposed) throw new WorkflowError('Workflow graph runtime is not available', 'WORKFLOW_NOT_READY', 503);
  }

}
