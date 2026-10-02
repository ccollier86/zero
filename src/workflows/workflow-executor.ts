/**
 * Invokes workflow handlers and owns their in-memory cancellation lifecycle.
 * Durable attempt preparation and commits live in WorkflowAttemptCoordinator.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { StepContext } from './types';
import { WorkflowAttemptCoordinator } from './workflow-attempt-coordinator';
import { WorkflowExecutionTracker } from './workflow-execution-tracker';
import { formatWorkflowError, WorkflowError } from './workflow-error';
import { WorkflowRepository } from './workflow-repository';
import type { WorkflowRegistry } from './workflow-registry';
import { WorkflowRuntimeStore } from './workflow-runtime-store';
import {
  DEFAULT_WORKFLOW_SHUTDOWN_GRACE_MS,
  resolveWorkflowShutdownGraceMs,
} from './workflow-shutdown-policy';
import { WorkflowWakeCoordinator } from './workflow-wake-coordinator';
import { serializeWorkflowRuntimeJson } from './workflow-runtime-json';

export interface WorkflowClock {
  now(): Date;
}

const systemClock: WorkflowClock = { now: () => new Date() };

export type WorkflowExecutionResult =
  | 'completed'
  | 'skipped'
  | 'waiting'
  | 'retry-scheduled'
  | 'failed'
  | 'timed-out'
  | 'stale';

export class WorkflowExecutor {
  private readonly attempts: WorkflowAttemptCoordinator;
  private readonly executions: WorkflowExecutionTracker;
  private disposed = false;

  constructor(
    db: ReactiveDB,
    private readonly registry: WorkflowRegistry,
    runtime = new WorkflowRuntimeStore(db),
    clock: WorkflowClock = systemClock,
    private readonly repository = new WorkflowRepository(db),
    wakes = new WorkflowWakeCoordinator(clock, false, {
      retry: () => undefined,
      timeout: () => undefined,
    }),
    shutdownGraceMs = DEFAULT_WORKFLOW_SHUTDOWN_GRACE_MS,
  ) {
    this.attempts = new WorkflowAttemptCoordinator(repository, runtime, clock, wakes);
    this.executions = new WorkflowExecutionTracker(
      resolveWorkflowShutdownGraceMs(shutdownGraceMs),
    );
  }

  /** Execute one eligible step and return its durable outcome. */
  async executeStep(instanceId: string, stepId: string): Promise<WorkflowExecutionResult> {
    if (this.disposed) {
      throw new WorkflowError(
        'Workflow executor is not available',
        'WORKFLOW_NOT_READY',
        503,
      );
    }
    // A pause/cancel aborts the logical attempt immediately, but a handler can
    // ignore its signal. Never overlap a replacement with that physical call.
    if (this.executions.isStepActive(stepId)) return 'stale';
    const preparation = this.attempts.prepare(instanceId, stepId);
    if (preparation.kind !== 'execute') {
      if (preparation.kind === 'timed-out') {
        this.attempts.emitTimeout(instanceId, stepId);
      }
      if (preparation.kind === 'failed') {
        emitPlatformCode(OBS_CODES.WORKFLOW_INSTANCE_FAILED, {
          error: preparation.cause,
          metadata: { instanceId, stepId, reason: 'preparation' },
        });
      }
      return preparation.kind;
    }

    const prepared = preparation.prepared;
    const handler = this.registry.getHandler(prepared.handlerName);
    if (!handler) {
      this.attempts.release(prepared);
      emitPlatformCode(OBS_CODES.WORKFLOW_HANDLER_MISSING, {
        metadata: {
          instanceId,
          stepId,
          stepIndex: prepared.step.step_index,
          handler: prepared.handlerName,
        },
      });
      throw new WorkflowError(
        `Workflow handler "${prepared.handlerName}" is not registered`,
        'WORKFLOW_HANDLER_NOT_REGISTERED',
        500,
      );
    }
    if (this.disposed) {
      this.attempts.release(prepared);
      return 'stale';
    }
    // ReactiveDB listeners run synchronously as prepare commits. A listener
    // can pause/cancel/timeout before this attempt is registered in memory.
    if (!this.attempts.isCurrent(prepared)) return 'stale';
    const controller = new AbortController();

    const context: StepContext = Object.freeze({
      input: prepared.input,
      workflowInput: prepared.workflowInput,
      instanceId,
      stepIndex: prepared.step.step_index,
      attempt: prepared.step.retries,
      attemptId: prepared.attemptId,
      idempotencyKey: `workflow:${instanceId}:step:${prepared.step.step_index}`,
      signal: controller.signal,
      ...(prepared.waitEvent
        ? {
            waitEvent: Object.freeze({
              id: prepared.waitEvent.eventId,
              name: prepared.waitEvent.name,
              payload: prepared.waitEvent.payload,
            }),
          }
        : {}),
    });
    // Defer invocation by one microtask so physical tracking is published
    // before any synchronous handler prefix can reenter workflow controls.
    const invocation = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw abortReason(controller.signal);
      return handler(context);
    });
    this.executions.track(
      instanceId,
      stepId,
      prepared.attemptId,
      controller,
      invocation,
    );

    try {
      const output = await raceWithAbort(invocation, controller.signal);
      if (this.disposed) return 'stale';
      let serialized: string | null;
      try {
        serialized = serializeWorkflowRuntimeJson(output, {
          code: 'WORKFLOW_ACTIVITY_OUTPUT_INVALID',
          label: 'Workflow handler output',
          invalidStatus: 500,
          limitStatus: 500,
        });
      } catch (error) {
        return this.attempts.commitFailure(
          prepared,
          formatWorkflowError(error),
          false,
          error,
        );
      }
      const result = this.attempts.commitSuccess(prepared, serialized);
      if (result === 'timed-out') this.attempts.emitTimeout(instanceId, stepId);
      return result;
    } catch (error) {
      // Disposal already normalized durable running rows. The physical
      // invocation remains observed by the tracker, but must never touch the
      // repository after the teardown boundary begins.
      if (this.disposed) return 'stale';
      const result = this.attempts.commitFailure(
        prepared,
        formatWorkflowError(error),
        true,
        error,
      );
      if (result === 'timed-out') this.attempts.emitTimeout(instanceId, stepId);
      return result;
    }
  }

  abortInstance(instanceId: string, reason: string): void {
    this.executions.abortInstance(instanceId, reason);
  }

  abortStep(stepId: string, reason: string): void {
    this.executions.abortStep(stepId, reason);
  }

  isInstanceDraining(instanceId: string): boolean {
    return this.executions.isInstanceActive(instanceId);
  }

  dispose(): Promise<void> {
    this.disposed = true;
    return this.executions.dispose();
  }
}

async function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortReason(signal);
  let removeAbortListener: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener('abort', onAbort);
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    removeAbortListener();
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Workflow execution aborted');
}
