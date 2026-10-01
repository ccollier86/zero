/**
 * Exact in-process wakeups for durable workflow retries and deadlines.
 *
 * SQLite remains authoritative. A wakeup only asks the service to reread and
 * apply the expected durable transition, so stale callbacks are harmless.
 * The minute scheduler remains the restart/process-failure safety net.
 */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { WorkflowClock } from './workflow-executor';
import type { WorkflowStepRecord } from './types';

const MAX_TIMER_DELAY_MS = 2_147_483_647;

export type WorkflowWakeKind = 'retry' | 'timeout';

export interface WorkflowWake {
  kind: WorkflowWakeKind;
  instanceId: string;
  stepId: string;
  expectedAt: string;
}

/** Injectable timer boundary for deterministic deadline tests. */
export interface WorkflowWakeTimer {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface WorkflowWakeCallbacks {
  retry(wake: WorkflowWake): void | Promise<void>;
  timeout(wake: WorkflowWake): void | Promise<void>;
}

interface ScheduledWake {
  wake: WorkflowWake;
  handle?: unknown;
}

export class WorkflowWakeCoordinator {
  private readonly scheduled = new Map<string, ScheduledWake>();
  private disposed = false;

  constructor(
    private readonly clock: WorkflowClock,
    private readonly timer: WorkflowWakeTimer | false,
    private readonly callbacks: WorkflowWakeCallbacks,
  ) {}

  armStep(step: WorkflowStepRecord): void {
    if (step.timeout_at) {
      this.arm('timeout', step.instance_id, step.step_id, step.timeout_at);
    } else {
      this.disarm('timeout', step.step_id);
    }
    if (step.status === 'failed' && step.retry_at) {
      this.arm('retry', step.instance_id, step.step_id, step.retry_at);
    } else {
      this.disarm('retry', step.step_id);
    }
  }

  armTimeout(instanceId: string, stepId: string, timeoutAt: string): void {
    this.arm('timeout', instanceId, stepId, timeoutAt);
  }

  armRetry(instanceId: string, stepId: string, retryAt: string): void {
    this.arm('retry', instanceId, stepId, retryAt);
  }

  disarmStep(stepId: string): void {
    this.disarm('timeout', stepId);
    this.disarm('retry', stepId);
  }

  disarmInstance(instanceId: string): void {
    for (const [key, scheduled] of this.scheduled) {
      if (scheduled.wake.instanceId === instanceId) this.clear(key, scheduled);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [key, scheduled] of this.scheduled) this.clear(key, scheduled);
  }

  private arm(
    kind: WorkflowWakeKind,
    instanceId: string,
    stepId: string,
    expectedAt: string,
  ): void {
    if (this.disposed || this.timer === false) return;
    const key = wakeKey(kind, stepId);
    const existing = this.scheduled.get(key);
    if (existing?.wake.expectedAt === expectedAt
      && existing.wake.instanceId === instanceId) return;
    if (existing) this.clear(key, existing);
    this.schedule({ kind, instanceId, stepId, expectedAt });
  }

  private schedule(wake: WorkflowWake): void {
    if (this.disposed || this.timer === false) return;
    const target = new Date(wake.expectedAt).getTime();
    const delay = Math.max(
      0,
      Math.min(MAX_TIMER_DELAY_MS, target - this.clock.now().getTime()),
    );
    const key = wakeKey(wake.kind, wake.stepId);
    const scheduled: ScheduledWake = { wake };
    this.scheduled.set(key, scheduled);
    try {
      scheduled.handle = this.timer.schedule(() => this.fire(key, scheduled), delay);
    } catch (error) {
      this.scheduled.delete(key);
      this.emitWakeFailure(wake, error);
    }
  }

  private fire(key: string, scheduled: ScheduledWake): void {
    if (this.disposed || this.scheduled.get(key) !== scheduled) return;
    this.scheduled.delete(key);
    if (new Date(scheduled.wake.expectedAt).getTime() > this.clock.now().getTime()) {
      this.schedule(scheduled.wake);
      return;
    }
    try {
      const result = this.callbacks[scheduled.wake.kind](scheduled.wake);
      void Promise.resolve(result).catch((error) => this.emitWakeFailure(scheduled.wake, error));
    } catch (error) {
      this.emitWakeFailure(scheduled.wake, error);
    }
  }

  private disarm(kind: WorkflowWakeKind, stepId: string): void {
    const key = wakeKey(kind, stepId);
    const scheduled = this.scheduled.get(key);
    if (scheduled) this.clear(key, scheduled);
  }

  private clear(key: string, scheduled: ScheduledWake): void {
    this.scheduled.delete(key);
    if (this.timer !== false && scheduled.handle !== undefined) {
      this.timer.cancel(scheduled.handle);
    }
  }

  private emitWakeFailure(wake: WorkflowWake, error: unknown): void {
    emitPlatformCode(OBS_CODES.WORKFLOW_ADVANCE_FAILED, {
      error,
      metadata: {
        instanceId: wake.instanceId,
        stepId: wake.stepId,
        phase: `${wake.kind}-wake`,
      },
    });
  }
}

export function createNativeWorkflowWakeTimer(): WorkflowWakeTimer {
  return {
    schedule(callback, delayMs) {
      const handle = setTimeout(callback, delayMs);
      if (handle && typeof handle === 'object' && 'unref' in handle) {
        (handle as { unref(): void }).unref();
      }
      return handle;
    },
    cancel(handle) {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
  };
}

function wakeKey(kind: WorkflowWakeKind, stepId: string): string {
  return `${kind}:${stepId}`;
}
