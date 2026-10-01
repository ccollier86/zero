/** Durable pause, resume, and cancellation transitions for one workflow. */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { WorkflowClock, WorkflowExecutor } from './workflow-executor';
import { WorkflowError, workflowNotFound } from './workflow-error';
import type { WorkflowLifecycleCoordinator } from './workflow-lifecycle-coordinator';
import { validateWorkflowPersistedState } from './workflow-persisted-state';
import type { WorkflowRepository } from './workflow-repository';
import type { WorkflowRuntimeStore } from './workflow-runtime-store';
import type { WorkflowStepRecord } from './types';
import type { WorkflowWakeCoordinator } from './workflow-wake-coordinator';

const TERMINAL_INSTANCE_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const TERMINAL_STEP_STATUSES = new Set(['completed', 'skipped']);

export class WorkflowTransitionController {
  constructor(
    private readonly repository: WorkflowRepository,
    private readonly runtime: WorkflowRuntimeStore,
    private readonly executor: WorkflowExecutor,
    private readonly lifecycle: WorkflowLifecycleCoordinator,
    private readonly clock: WorkflowClock,
    private readonly wakes: WorkflowWakeCoordinator,
  ) {}

  cancel(instanceId: string): void {
    const now = this.clock.now().toISOString();
    this.repository.transaction(() => {
      const instance = this.repository.getInstance(instanceId);
      if (!instance) throw workflowNotFound();
      if (TERMINAL_INSTANCE_STATUSES.has(instance.status)) {
        throw invalidTransition('cancel', instance.status);
      }

      this.runtime.finishInstanceAttempts(instanceId);
      this.runtime.clearPause(instanceId);
      for (const step of this.repository.getSteps(instanceId)) {
        if (!TERMINAL_STEP_STATUSES.has(step.status)) {
          this.repository.updateStep(step.step_id, {
            status: 'skipped',
            error: 'Workflow cancelled',
            retry_at: null,
            timeout_at: null,
            completed_at: now,
          });
        }
      }
      this.repository.updateInstance(instanceId, {
        status: 'cancelled',
        updated_at: now,
        completed_at: now,
      });
    });
    this.wakes.disarmInstance(instanceId);
    this.executor.abortInstance(instanceId, 'Workflow cancelled');
    emitPlatformCode(OBS_CODES.WORKFLOW_INSTANCE_CANCELLED, {
      metadata: { instanceId },
    });
  }

  pause(instanceId: string): void {
    const now = this.clock.now().toISOString();
    let expiredStep: WorkflowStepRecord | null = null;
    this.repository.transaction(() => {
      const instance = this.repository.getInstance(instanceId);
      if (!instance) throw workflowNotFound();
      if (instance.status !== 'running') throw invalidTransition('pause', instance.status);

      const validated = this.validateState(instanceId, instance, 'pause');
      const frontier = validated.frontier;
      if (!frontier) {
        throw new WorkflowError(
          'Cannot pause workflow with no unfinished step',
          'WORKFLOW_STATE_INVALID',
          409,
        );
      }
      expiredStep = frontier.timeout_at !== null
        && frontier.timeout_at <= now
        && isTimeoutEligible(frontier)
          ? frontier
          : null;
      if (expiredStep) {
        this.lifecycle.failTimedOutStep(instanceId, expiredStep, now);
        return;
      }

      this.runtime.finishInstanceAttempts(instanceId);
      this.runtime.markPaused(instanceId, now);
      for (const step of this.repository.getSteps(instanceId)) {
        if (step.status === 'running') {
          this.repository.updateStep(step.step_id, { status: 'pending' });
        }
      }
      this.repository.updateInstance(instanceId, {
        status: 'paused',
        updated_at: now,
      });
    });

    const stepThatExpired = expiredStep as WorkflowStepRecord | null;
    if (stepThatExpired) {
      this.wakes.disarmInstance(instanceId);
      this.executor.abortStep(stepThatExpired.step_id, 'Workflow step timed out');
      this.lifecycle.emitTimeout(stepThatExpired);
      throw new WorkflowError(
        'Cannot pause workflow because its step deadline has expired',
        'WORKFLOW_STATE_INVALID',
        409,
      );
    }
    this.wakes.disarmInstance(instanceId);
    this.executor.abortInstance(instanceId, 'Workflow paused');
    emitPlatformCode(OBS_CODES.WORKFLOW_INSTANCE_PAUSED, {
      metadata: { instanceId },
    });
  }

  async resume(
    instanceId: string,
    assertAvailable: () => void,
    advance: (instanceId: string) => Promise<void>,
  ): Promise<void> {
    const beforeDrain = this.repository.getInstance(instanceId);
    if (!beforeDrain) throw workflowNotFound();
    if (beforeDrain.status !== 'paused') {
      throw invalidTransition('resume', beforeDrain.status);
    }
    if (this.executor.isInstanceDraining(instanceId)) {
      throw new WorkflowError(
        'Workflow is still draining its previous handler attempt; retry resume shortly',
        'WORKFLOW_DRAINING',
        409,
        true,
      );
    }
    assertAvailable();
    const now = this.clock.now();

    this.repository.transaction(() => {
      const instance = this.repository.getInstance(instanceId);
      if (!instance) throw workflowNotFound();
      if (instance.status !== 'paused') throw invalidTransition('resume', instance.status);

      this.validateState(instanceId, instance, 'resume');

      const pauseMarker = this.runtime.takePausedAt(instanceId);
      // Zero 1.3 persisted this boundary only on the instance row.
      const pausedAt = pauseMarker ?? (
        typeof instance.updated_at === 'string' ? instance.updated_at : null
      );
      const pausedTime = pausedAt ? new Date(pausedAt).getTime() : Number.NaN;
      const pauseMs = Number.isFinite(pausedTime)
        ? Math.max(0, now.getTime() - pausedTime)
        : 0;
      if (pauseMs > 0) {
        for (const step of this.repository.getSteps(instanceId)) {
          if (!TERMINAL_STEP_STATUSES.has(step.status)) {
            this.repository.updateStep(step.step_id, {
              timeout_at: shiftTimestamp(step.timeout_at, pauseMs),
              retry_at: shiftTimestamp(step.retry_at, pauseMs),
            });
          }
        }
      }
      // Zero 1.3 could persist paused + running. Normalize it before reopen.
      this.runtime.finishInstanceAttempts(instanceId);
      for (const step of this.repository.getSteps(instanceId)) {
        if (step.status === 'running') {
          this.repository.updateStep(step.step_id, { status: 'pending' });
        }
      }
      this.repository.updateInstance(instanceId, {
        status: 'running',
        updated_at: now.toISOString(),
      });
    });
    const frontier = this.repository.getSteps(instanceId)
      .find((step) => !TERMINAL_STEP_STATUSES.has(step.status));
    if (frontier) this.wakes.armStep(frontier);
    emitPlatformCode(OBS_CODES.WORKFLOW_INSTANCE_RESUMED, {
      metadata: { instanceId },
    });
    await advance(instanceId);
  }

  private validateState(
    instanceId: string,
    instance: Parameters<typeof validateWorkflowPersistedState>[0],
    phase: 'pause' | 'resume',
  ): ReturnType<typeof validateWorkflowPersistedState> {
    try {
      return validateWorkflowPersistedState(
        instance,
        this.repository.getSteps(instanceId),
      );
    } catch (error) {
      emitPlatformCode(OBS_CODES.WORKFLOW_ADVANCE_FAILED, {
        error,
        metadata: { instanceId, phase: `${phase}-validation` },
      });
      throw new WorkflowError(
        `Cannot ${phase} workflow: persisted state is invalid`,
        'WORKFLOW_STATE_INVALID',
        500,
      );
    }
  }
}

function invalidTransition(action: string, status: string): WorkflowError {
  return new WorkflowError(
    `Cannot ${action} workflow in status "${status}"`,
    'WORKFLOW_STATE_INVALID',
    409,
  );
}

function shiftTimestamp(value: string | null, deltaMs: number): string | null {
  return value ? new Date(new Date(value).getTime() + deltaMs).toISOString() : null;
}

function isTimeoutEligible(step: WorkflowStepRecord): boolean {
  return step.status === 'pending'
    || step.status === 'waiting'
    || step.status === 'running'
    || (step.status === 'failed' && step.retry_at !== null);
}
