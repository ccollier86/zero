/** Pause, resume, and cancellation transitions for graph workflow instances. */

import { OBS_CODES } from '../observability/codes';
import { WorkflowError, workflowNotFound } from './workflow-error';
import type { WorkflowGraphActivityExecutor } from './workflow-graph-activity-executor';
import type { WorkflowGraphStore } from './workflow-graph-store';
import type { WorkflowGraphWakeScheduler } from './workflow-graph-wake-scheduler';
import type { WorkflowInteractionService } from './workflow-interaction-service';
import type { WorkflowRuntimeStore } from './workflow-runtime-store';
import type { WorkflowStepRecord } from './types';
import {
  createWorkflowObservability,
  type WorkflowObservability,
} from './workflow-observability';

const TERMINAL_INSTANCES = new Set(['completed', 'failed', 'cancelled']);

export class WorkflowGraphTransitionController {
  constructor(
    private readonly store: WorkflowGraphStore,
    private readonly runtime: WorkflowRuntimeStore,
    private readonly executor: WorkflowGraphActivityExecutor,
    private readonly interactions: WorkflowInteractionService,
    private readonly wakes: WorkflowGraphWakeScheduler,
    private readonly expire: (instanceId: string, stepId: string, expectedAt: string) => void,
    private readonly now: () => Date,
    private readonly observability: WorkflowObservability = createWorkflowObservability(),
  ) {}

  cancel(instanceId: string, assertCurrentAuthority?: () => void): void {
    const now = this.now().toISOString();
    this.store.transaction(() => {
      assertCurrentAuthority?.();
      const instance = this.store.getInstance(instanceId);
      if (!instance) throw workflowNotFound();
      if (TERMINAL_INSTANCES.has(instance.status)) throw invalid('cancel', instance.status);
      this.runtime.finishInstanceAttempts(instanceId);
      this.runtime.clearPause(instanceId);
      for (const step of this.store.listSteps(instanceId)) {
        if (!isTerminalStep(step)) {
          this.store.updateStep(step.step_id, {
            status: 'skipped', error: 'Workflow cancelled', retry_at: null,
            timeout_at: null, completed_at: now, updated_at: now,
          });
        }
      }
      for (const item of this.store.listInstanceEachItems(instanceId)) {
        if (item.status === 'pending' || item.status === 'running') {
          this.store.updateEachItem(item.item_id, {
            status: 'cancelled', error: 'Workflow cancelled',
            completed_at: now, updated_at: now,
          });
        }
      }
      this.store.updateInstance(instanceId, {
        status: 'cancelled', completed_at: now, updated_at: now,
      });
      this.interactions.cancelForInstance(instanceId);
      this.runtime.discardInstanceQueue(instanceId, now);
    });
    this.wakes.disarmInstance(instanceId);
    this.executor.abortInstance(instanceId, 'Workflow cancelled');
    this.observability.emitAfterCommit(
      OBS_CODES.WORKFLOW_INSTANCE_CANCELLED,
      { metadata: { instanceId } },
    );
  }

  pause(instanceId: string, assertCurrentAuthority?: () => void): void {
    const now = this.now().toISOString();
    let expiredStep: WorkflowStepRecord | null = null;
    this.store.transaction(() => {
      assertCurrentAuthority?.();
      const instance = this.store.getInstance(instanceId);
      if (!instance) throw workflowNotFound();
      if (instance.status !== 'running') throw invalid('pause', instance.status);
      expiredStep = this.store.listSteps(instanceId).find((step) => (
        step.timeout_at !== null
        && step.timeout_at <= now
        && isTimeoutEligible(step)
      )) ?? null;
      if (expiredStep) return;
      this.runtime.finishInstanceAttempts(instanceId);
      this.runtime.markPaused(instanceId, now);
      for (const step of this.store.listSteps(instanceId)) {
        if (step.status === 'running') {
          this.store.updateStep(step.step_id, { status: 'pending', updated_at: now });
        }
      }
      for (const item of this.store.listInstanceEachItems(instanceId)) {
        if (item.status === 'running') {
          this.store.updateEachItem(item.item_id, { status: 'pending', updated_at: now });
        }
      }
      this.store.updateInstance(instanceId, { status: 'paused', updated_at: now });
    });
    const stepThatExpired = expiredStep as WorkflowStepRecord | null;
    if (stepThatExpired?.timeout_at) {
      this.expire(instanceId, stepThatExpired.step_id, stepThatExpired.timeout_at);
      throw new WorkflowError(
        'Cannot pause workflow because its step deadline has expired',
        'WORKFLOW_STATE_INVALID',
        409,
      );
    }
    this.wakes.disarmInstance(instanceId);
    this.executor.abortInstance(instanceId, 'Workflow paused');
    this.observability.emitAfterCommit(
      OBS_CODES.WORKFLOW_INSTANCE_PAUSED,
      { metadata: { instanceId } },
    );
  }

  async resume(
    instanceId: string,
    advance: (instanceId: string) => Promise<void>,
    assertCurrentAuthority?: () => void,
  ): Promise<void> {
    const before = this.store.getInstance(instanceId);
    if (!before) throw workflowNotFound();
    if (before.status !== 'paused') throw invalid('resume', before.status);
    if (this.executor.isInstanceDraining(instanceId)) {
      throw new WorkflowError(
        'Workflow is still draining its previous handler attempt; retry resume shortly',
        'WORKFLOW_DRAINING',
        409,
        true,
      );
    }
    const now = this.now();
    this.store.transaction(() => {
      assertCurrentAuthority?.();
      const instance = this.store.getInstance(instanceId);
      if (!instance) throw workflowNotFound();
      if (instance.status !== 'paused') throw invalid('resume', instance.status);
      const pausedAt = this.runtime.takePausedAt(instanceId) ?? instance.updated_at;
      const pausedMs = Math.max(0, now.getTime() - new Date(pausedAt).getTime());
      this.interactions.shiftOpenExpiries(instanceId, pausedMs);
      for (const step of this.store.listSteps(instanceId)) {
        if (!isTerminalStep(step)) {
          this.store.updateStep(step.step_id, {
            retry_at: shift(step.retry_at, pausedMs),
            timeout_at: shift(step.timeout_at, pausedMs),
            updated_at: now.toISOString(),
          });
        }
      }
      this.store.updateInstance(instanceId, { status: 'running', updated_at: now.toISOString() });
    });
    this.observability.emitAfterCommit(
      OBS_CODES.WORKFLOW_INSTANCE_RESUMED,
      { metadata: { instanceId } },
    );
    await advance(instanceId);
  }
}

function isTerminalStep(step: WorkflowStepRecord): boolean {
  return step.status === 'completed'
    || step.status === 'skipped'
    || (step.status === 'failed' && step.retry_at === null);
}

function isTimeoutEligible(step: WorkflowStepRecord): boolean {
  return step.status === 'pending'
    || step.status === 'waiting'
    || step.status === 'running'
    || (step.status === 'failed' && step.retry_at !== null);
}

function shift(value: string | null, milliseconds: number): string | null {
  return value ? new Date(new Date(value).getTime() + milliseconds).toISOString() : null;
}

function invalid(action: string, status: string): WorkflowError {
  return new WorkflowError(
    `Cannot ${action} workflow in status "${status}"`,
    'WORKFLOW_STATE_INVALID',
    409,
  );
}
