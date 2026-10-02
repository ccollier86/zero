/** Exact in-process graph retry/deadline wakes with restart-safe rearming. */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { WorkflowError } from './workflow-error';
import type { WorkflowWakeTimer } from './workflow-wake-coordinator';

const MAX_TIMER_DELAY_MS = 2_147_483_647;

export interface WorkflowGraphWakeHandlers {
  retry(instanceId: string, stepId: string, expectedAt: string): void | Promise<void>;
  timeout(instanceId: string, stepId: string, expectedAt: string): void | Promise<void>;
}

interface ScheduledWake {
  instanceId: string;
  stepId: string;
  expectedAt: string;
  kind: 'retry' | 'timeout';
  handle?: unknown;
}

export class WorkflowGraphWakeScheduler {
  private readonly wakes = new Map<string, ScheduledWake>();
  private disposed = false;

  constructor(
    private readonly handlers: WorkflowGraphWakeHandlers,
    private readonly now: () => Date = () => new Date(),
    private readonly timer: WorkflowWakeTimer | false = false,
  ) {}

  armRetry(instanceId: string, stepId: string, expectedAt: string): void {
    this.arm('retry', instanceId, stepId, expectedAt);
  }

  armTimeout(instanceId: string, stepId: string, expectedAt: string): void {
    this.arm('timeout', instanceId, stepId, expectedAt);
  }

  disarmStep(stepId: string): void {
    this.clear(`retry:${stepId}`);
    this.clear(`timeout:${stepId}`);
  }

  disarmInstance(instanceId: string): void {
    for (const [key, wake] of this.wakes) {
      if (wake.instanceId === instanceId) this.clear(key);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const key of [...this.wakes.keys()]) this.clear(key);
  }

  private arm(
    kind: ScheduledWake['kind'],
    instanceId: string,
    stepId: string,
    expectedAt: string,
  ): void {
    const target = requireWakeTimestamp(expectedAt);
    if (this.disposed || this.timer === false) return;
    const key = `${kind}:${stepId}`;
    const existing = this.wakes.get(key);
    if (existing?.expectedAt === expectedAt && existing.instanceId === instanceId) return;
    this.clear(key);
    const delay = Math.min(
      MAX_TIMER_DELAY_MS,
      Math.max(0, target - this.now().getTime()),
    );
    const wake: ScheduledWake = { kind, instanceId, stepId, expectedAt };
    this.wakes.set(key, wake);
    try {
      wake.handle = this.timer.schedule(() => this.fire(key), delay);
    } catch (error) {
      this.wakes.delete(key);
      this.emitWakeFailure(wake, error);
    }
  }

  private fire(key: string): void {
    const wake = this.wakes.get(key);
    if (!wake || this.disposed) return;
    this.wakes.delete(key);
    const target = new Date(wake.expectedAt).getTime();
    if (target > this.now().getTime()) {
      this.arm(wake.kind, wake.instanceId, wake.stepId, wake.expectedAt);
      return;
    }
    try {
      const result = this.handlers[wake.kind](
        wake.instanceId,
        wake.stepId,
        wake.expectedAt,
      );
      void Promise.resolve(result).catch((error) => this.emitWakeFailure(wake, error));
    } catch (error) {
      this.emitWakeFailure(wake, error);
    }
  }

  private clear(key: string): void {
    const wake = this.wakes.get(key);
    if (!wake) return;
    if (this.timer !== false && wake.handle !== undefined) this.timer.cancel(wake.handle);
    this.wakes.delete(key);
  }

  private emitWakeFailure(wake: ScheduledWake, error: unknown): void {
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

function requireWakeTimestamp(expectedAt: string): number {
  const target = new Date(expectedAt).getTime();
  if (Number.isFinite(target) && new Date(target).toISOString() === expectedAt) return target;
  throw new WorkflowError(
    'Persisted workflow wake timestamp is invalid',
    'WORKFLOW_STATE_INVALID',
    500,
  );
}
