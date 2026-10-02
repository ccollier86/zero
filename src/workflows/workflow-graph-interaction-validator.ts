/** Execute interaction validators with the same safe activity context guarantees. */

import { createHash } from 'node:crypto';
import { decodeWorkflowActivityReference } from './workflow-activity-reference-codec';
import { WorkflowExecutionTracker } from './workflow-execution-tracker';
import {
  raceWorkflowActivityWithAbort,
  workflowAbortReason,
} from './workflow-graph-activity-values';
import type { WorkflowRegistry } from './workflow-registry';
import type { WorkflowGraphStore } from './workflow-graph-store';
import type { WorkflowMemoryStore } from './workflow-memory-store';
import { createWorkflowMemoryContext } from './workflow-memory-context';
import type {
  WorkflowInteractionValidationContext,
  WorkflowInteractionValidationResult,
} from './workflow-interaction-service';
import { parseWorkflowPersistedJson } from './workflow-graph-activity-values';
import { WorkflowError } from './workflow-error';
import type { StepContext } from './types';

export class WorkflowGraphInteractionValidator {
  private readonly tracker: WorkflowExecutionTracker;
  private disposed = false;

  constructor(
    private readonly registry: WorkflowRegistry,
    private readonly store: WorkflowGraphStore,
    private readonly memory: WorkflowMemoryStore,
    shutdownGraceMs: number,
  ) {
    this.tracker = new WorkflowExecutionTracker(shutdownGraceMs);
  }

  async validate(
    activityId: string,
    context: WorkflowInteractionValidationContext,
  ): Promise<WorkflowInteractionValidationResult | boolean> {
    if (this.disposed) throw unavailable();
    const { name, version } = decodeWorkflowActivityReference(activityId);
    const activity = this.registry.activities.validateInput(
      { name, version },
      context.payload,
    );
    const instance = this.store.getInstance(context.interaction.instanceId);
    const step = this.store.getStep(context.interaction.stepId);
    if (!instance || instance.status !== 'running'
      || !step || step.instance_id !== instance.instance_id || step.status !== 'waiting') {
      throw new WorkflowError(
        'Workflow interaction validator has no valid workflow context',
        'WORKFLOW_STATE_INVALID',
        500,
      );
    }
    const attemptId = `wvalidate_${crypto.randomUUID()}`;
    const memory = createWorkflowMemoryContext(this.memory, {
      scope: { instanceId: instance.instance_id, kind: 'instance' },
      stepId: step.step_id,
      attemptId,
    });
    const controller = new AbortController();
    const payloadHash = createHash('sha256')
      .update(JSON.stringify(context.payload))
      .digest('hex');
    const activityContext: StepContext = Object.freeze({
      input: context.payload,
      workflowInput: parseWorkflowPersistedJson(instance.input),
      instanceId: instance.instance_id,
      stepIndex: step.step_index,
      attempt: 0,
      attemptId,
      idempotencyKey: `workflow:${instance.instance_id}:interaction:${context.interaction.interactionId}:validator:${payloadHash}`,
      signal: controller.signal,
      memory: memory.memory,
      interaction: context.interaction,
    });
    try {
      const invocation = Promise.resolve().then(() => {
        if (controller.signal.aborted) throw workflowAbortReason(controller.signal);
        const currentInstance = this.store.getInstance(instance.instance_id);
        const currentStep = this.store.getStep(step.step_id);
        if (currentInstance?.status !== 'running'
          || currentStep?.status !== 'waiting') {
          throw new WorkflowError(
            'Workflow interaction validator cannot start unless its wait is running',
            currentInstance?.status === 'paused' ? 'WORKFLOW_DRAINING' : 'WORKFLOW_STATE_INVALID',
            409,
            currentInstance?.status === 'paused',
          );
        }
        return activity.handler(activityContext);
      });
      const trackingKey = `${step.step_id}:validator:${context.submissionId}`;
      this.tracker.track(instance.instance_id, trackingKey, attemptId, controller, invocation);
      let result: unknown;
      try {
        result = await raceWorkflowActivityWithAbort(invocation, controller.signal);
      } catch (error) {
        if (this.disposed) throw unavailable();
        throw error;
      }
      if (this.disposed) throw unavailable();
      const currentInstance = this.store.getInstance(instance.instance_id);
      const currentStep = this.store.getStep(step.step_id);
      if (currentInstance?.status !== 'running'
        || !currentStep || currentStep.status !== 'waiting') {
        throw new WorkflowError(
          'Workflow interaction validator completed after its wait closed',
          'WORKFLOW_STATE_INVALID',
          409,
        );
      }
      this.registry.activities.validateOutput({ name, version }, result);
      return result as WorkflowInteractionValidationResult | boolean;
    } finally {
      // Validation is observational. It must never mutate durable run memory.
      memory.discard();
    }
  }

  abortInstance(instanceId: string, reason: string): void {
    this.tracker.abortInstance(instanceId, reason);
  }

  isInstanceDraining(instanceId: string): boolean {
    return this.tracker.isInstanceActive(instanceId);
  }

  dispose(): Promise<void> {
    this.disposed = true;
    return this.tracker.dispose();
  }
}

function unavailable(): WorkflowError {
  return new WorkflowError(
    'Workflow interaction validation is not available',
    'WORKFLOW_NOT_READY',
    503,
  );
}
