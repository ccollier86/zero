/** Tracks physical handler invocations independently from logical attempts. */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';

interface ActiveExecution {
  readonly instanceId: string;
  readonly stepId: string;
  readonly attemptId: string;
  readonly controller: AbortController;
  physicalSettled: Promise<void>;
  physicalDone: boolean;
}

export class WorkflowExecutionTracker {
  private readonly activeByStep = new Map<string, ActiveExecution>();
  private disposed = false;
  private disposalPromise: Promise<void> | null = null;

  constructor(private readonly shutdownGraceMs: number) {}

  track(
    instanceId: string,
    stepId: string,
    attemptId: string,
    controller: AbortController,
    invocation: Promise<unknown>,
  ): void {
    if (this.disposed) return;
    const active = {
      instanceId,
      stepId,
      attemptId,
      controller,
      physicalDone: false,
      physicalSettled: Promise.resolve(),
    } as ActiveExecution;
    active.physicalSettled = invocation.then(
      () => undefined,
      () => undefined,
    ).then(() => {
      active.physicalDone = true;
      if (this.activeByStep.get(stepId)?.attemptId === attemptId) {
        this.activeByStep.delete(stepId);
      }
    });
    this.activeByStep.set(stepId, active);
  }

  isStepActive(stepId: string): boolean {
    return this.activeByStep.has(stepId);
  }

  isInstanceActive(instanceId: string): boolean {
    for (const active of this.activeByStep.values()) {
      if (active.instanceId === instanceId) return true;
    }
    return false;
  }

  abortInstance(instanceId: string, reason: string | Error): void {
    for (const active of this.activeByStep.values()) {
      if (active.instanceId === instanceId) this.abort(active, reason);
    }
  }

  abortStep(stepId: string, reason: string | Error): void {
    const active = this.activeByStep.get(stepId);
    if (active) this.abort(active, reason);
  }

  dispose(): Promise<void> {
    if (this.disposalPromise) return this.disposalPromise;
    this.disposed = true;
    const snapshot = [...this.activeByStep.values()];
    for (const active of snapshot) this.abort(active, 'Workflow executor stopped');
    this.disposalPromise = this.drainWithinGrace(snapshot);
    return this.disposalPromise;
  }

  private async drainWithinGrace(snapshot: readonly ActiveExecution[]): Promise<void> {
    if (snapshot.length === 0) return;
    const allSettled = Promise.all(snapshot.map((active) => active.physicalSettled));
    const drained = await settleWithin(allSettled, this.shutdownGraceMs);
    if (drained) return;

    const remaining = snapshot.filter((active) => !active.physicalDone);
    for (const active of remaining) {
      if (this.activeByStep.get(active.stepId)?.attemptId === active.attemptId) {
        this.activeByStep.delete(active.stepId);
      }
    }
    const instanceIds = [...new Set(remaining.map((active) => active.instanceId))];
    emitPlatformCode(OBS_CODES.WORKFLOWS_SHUTDOWN_GRACE_EXHAUSTED, {
      metadata: {
        shutdownGraceMs: this.shutdownGraceMs,
        executionCount: remaining.length,
        instanceCount: instanceIds.length,
        stepCount: new Set(remaining.map((active) => active.stepId)).size,
        instanceIdSample: instanceIds.slice(0, 10),
        stepIdSample: remaining.slice(0, 10).map((active) => active.stepId),
        sampleTruncated: remaining.length > 10,
      },
    });
  }

  private abort(active: ActiveExecution, reason: string | Error): void {
    if (!active.controller.signal.aborted) {
      active.controller.abort(reason instanceof Error ? reason : new Error(reason));
    }
  }
}

async function settleWithin(promise: Promise<unknown>, graceMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), graceMs);
    timer.unref?.();
  });
  const drained = await Promise.race([promise.then(() => true as const), timeout]);
  if (timer) clearTimeout(timer);
  return drained;
}
