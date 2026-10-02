/**
 * Per-instance strict-frontier execution and terminal-state projection.
 *
 * Triggers for one workflow instance are coalesced while different instances
 * remain independent. The pump owns its in-flight promises so shutdown can
 * stop new work and drain every already-running execution deterministically.
 */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { WorkflowStepRecord } from './types';
import type { WorkflowClock, WorkflowExecutor } from './workflow-executor';
import { validateWorkflowPersistedState } from './workflow-persisted-state';
import type { WorkflowRepository } from './workflow-repository';
import type { WorkflowRuntimeStore } from './workflow-runtime-store';
import type { WorkflowWakeCoordinator } from './workflow-wake-coordinator';

const TERMINAL_STEP_STATUSES = new Set(['completed', 'skipped']);

export class WorkflowFrontierPump {
  private readonly pumps = new Map<string, Promise<void>>();
  private readonly kickVersions = new Map<string, number>();
  private stopped = false;

  constructor(
    private readonly repository: WorkflowRepository,
    private readonly runtime: WorkflowRuntimeStore,
    private readonly executor: WorkflowExecutor,
    private readonly clock: WorkflowClock,
    private readonly wakes: WorkflowWakeCoordinator,
  ) {}

  /** Coalesce concurrent triggers into one per-instance frontier pump. */
  async advance(
    instanceId: string,
    restart: () => Promise<void>,
  ): Promise<void> {
    if (this.stopped) return;
    this.kickVersions.set(
      instanceId,
      (this.kickVersions.get(instanceId) ?? 0) + 1,
    );
    const existing = this.pumps.get(instanceId);
    if (existing) {
      // A trigger can arrive after runPump's final version check but before its
      // finally handler removes the mapped promise. Wait through that cleanup,
      // then hand the trigger to a successor pump instead of losing it.
      await existing;
      const successor = this.pumps.get(instanceId);
      if (successor) return successor;
      return restart();
    }

    let pump!: Promise<void>;
    pump = this.run(instanceId).finally(() => {
      if (this.pumps.get(instanceId) === pump) this.pumps.delete(instanceId);
      this.kickVersions.delete(instanceId);
    });
    this.pumps.set(instanceId, pump);
    return pump;
  }

  /** Prevent new work and make active pumps observe shutdown at their frontier. */
  stop(): void {
    this.stopped = true;
  }

  /** Wait for work that was already executing when stop() was called. */
  async drain(): Promise<void> {
    await Promise.allSettled(this.pumps.values());
    this.pumps.clear();
    this.kickVersions.clear();
  }

  private async run(instanceId: string): Promise<void> {
    let observedVersion: number;
    do {
      observedVersion = this.kickVersions.get(instanceId) ?? 0;
      await this.runUntilBlocked(instanceId);
    } while ((this.kickVersions.get(instanceId) ?? 0) !== observedVersion);
  }

  private async runUntilBlocked(instanceId: string): Promise<void> {
    while (true) {
      if (this.stopped) return;
      const instance = this.repository.getInstance(instanceId);
      if (!instance || instance.status !== 'running') return;

      const steps = this.repository.getSteps(instanceId);
      try {
        validateWorkflowPersistedState(instance, steps);
      } catch (error) {
        this.failCorruptInstance(instanceId, error);
        return;
      }
      const frontier = steps.find((step) => !TERMINAL_STEP_STATUSES.has(step.status));
      if (!frontier) {
        if (this.completeIfFinished(instanceId)) {
          this.wakes.disarmInstance(instanceId);
          emitPlatformCode(OBS_CODES.WORKFLOW_INSTANCE_COMPLETED, {
            metadata: { instanceId, name: instance.name },
          });
        }
        return;
      }

      if (frontier.status === 'running') return;
      if (frontier.status === 'failed' && !frontier.retry_at) {
        this.failFromFrontier(instanceId, frontier);
        return;
      }
      if (
        frontier.status === 'failed'
        && frontier.retry_at! > this.clock.now().toISOString()
      ) {
        return;
      }

      this.updateCurrentStep(instanceId, frontier.step_index);
      const result = await this.executor.executeStep(instanceId, frontier.step_id);
      if (result === 'completed' || result === 'skipped' || result === 'retry-scheduled') {
        continue;
      }
      if (result === 'failed' || result === 'timed-out' || result === 'stale') return;
      if (result === 'waiting') return;
    }
  }

  private updateCurrentStep(instanceId: string, stepIndex: number): void {
    const instance = this.repository.getInstance(instanceId);
    if (instance?.status === 'running' && instance.current_step !== stepIndex) {
      this.repository.updateInstance(instanceId, {
        current_step: stepIndex,
        updated_at: this.clock.now().toISOString(),
      });
    }
  }

  private completeIfFinished(instanceId: string): boolean {
    return this.repository.transaction(() => {
      const instance = this.repository.getInstance(instanceId);
      if (!instance || instance.status !== 'running') return false;
      const steps = this.repository.getSteps(instanceId);
      if (steps.some((step) => !TERMINAL_STEP_STATUSES.has(step.status))) return false;
      const lastCompleted = [...steps]
        .reverse()
        .find((step) => step.status === 'completed');
      const now = this.clock.now().toISOString();
      this.repository.updateInstance(instanceId, {
        status: 'completed',
        current_step: steps.length,
        output: lastCompleted?.output ?? null,
        error: null,
        completed_at: now,
        updated_at: now,
      });
      this.runtime.discardInstanceQueue(instanceId, now);
      return true;
    });
  }

  private failFromFrontier(instanceId: string, frontier: WorkflowStepRecord): void {
    const changed = this.repository.transaction(() => {
      const instance = this.repository.getInstance(instanceId);
      const step = this.repository.getStep(frontier.step_id);
      if (
        !instance
        || instance.status !== 'running'
        || !step
        || step.status !== 'failed'
        || step.retry_at !== null
      ) return false;
      const now = this.clock.now().toISOString();
      this.repository.updateInstance(instanceId, {
        status: 'failed',
        error: step.error,
        current_step: step.step_index,
        completed_at: now,
        updated_at: now,
      });
      this.runtime.discardInstanceQueue(instanceId, now);
      return true;
    });
    if (changed) {
      this.wakes.disarmInstance(instanceId);
      emitPlatformCode(OBS_CODES.WORKFLOW_INSTANCE_FAILED, {
        metadata: {
          instanceId,
          stepId: frontier.step_id,
          stepIndex: frontier.step_index,
        },
      });
    }
  }

  private failCorruptInstance(instanceId: string, cause: unknown): void {
    const message = boundedStateError(cause);
    const changed = this.repository.transaction(() => {
      const instance = this.repository.getInstance(instanceId);
      if (!instance || instance.status !== 'running') return false;
      this.runtime.finishInstanceAttempts(instanceId);
      const frontier = this.repository.getSteps(instanceId)
        .find((step) => !TERMINAL_STEP_STATUSES.has(step.status));
      const now = this.clock.now().toISOString();
      if (frontier) {
        this.repository.updateStep(frontier.step_id, {
          status: 'failed',
          error: message,
          retry_at: null,
          timeout_at: null,
          completed_at: now,
        });
      }
      this.repository.updateInstance(instanceId, {
        status: 'failed',
        error: message,
        updated_at: now,
        completed_at: now,
      });
      this.runtime.discardInstanceQueue(instanceId, now);
      return true;
    });
    if (changed) {
      this.wakes.disarmInstance(instanceId);
      emitPlatformCode(OBS_CODES.WORKFLOW_INSTANCE_FAILED, {
        error: cause,
        metadata: { instanceId, reason: 'persisted-state' },
      });
    }
  }
}

function boundedStateError(error: unknown): string {
  try {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, 2_000);
  } catch {
    return 'Workflow persisted state is invalid';
  }
}
