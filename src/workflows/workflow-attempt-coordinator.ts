/** Durable preparation and commit protocol for one workflow step attempt. */

import { OBS_CODES } from '../observability/codes';
import { compileWorkflowCondition } from './workflow-condition';
import { formatWorkflowError, WorkflowError } from './workflow-error';
import type { WorkflowClock, WorkflowExecutionResult } from './workflow-executor';
import { validateWorkflowPersistedState } from './workflow-persisted-state';
import type { WorkflowRepository } from './workflow-repository';
import type {
  ClaimedWorkflowEvent,
  WorkflowRuntimeStore,
} from './workflow-runtime-store';
import type { WorkflowWakeCoordinator } from './workflow-wake-coordinator';
import {
  createWorkflowObservability,
  type WorkflowObservability,
} from './workflow-observability';
import { parseWorkflowStepDefinitions } from './workflow-step-definition';
import type {
  StepDefinition,
  WorkflowInstanceRecord,
  WorkflowStepRecord,
} from './types';

const MAX_BACKOFF_MS = 5 * 60 * 1000;
export interface PreparedWorkflowExecution {
  attemptId: string;
  instanceId: string;
  step: WorkflowStepRecord;
  handlerName: string;
  workflowInput: unknown;
  input: unknown;
  waitEvent?: ClaimedWorkflowEvent;
}

export type WorkflowPreparationResult =
  | { kind: 'execute'; prepared: PreparedWorkflowExecution }
  | { kind: 'failed'; cause?: unknown }
  | {
      kind: Exclude<
        WorkflowExecutionResult,
        'completed' | 'retry-scheduled' | 'failed'
      >;
    };

export class WorkflowAttemptCoordinator {
  constructor(
    private readonly repository: WorkflowRepository,
    private readonly runtime: WorkflowRuntimeStore,
    private readonly clock: WorkflowClock,
    private readonly wakes: WorkflowWakeCoordinator,
    private readonly observability: WorkflowObservability = createWorkflowObservability(),
  ) {}

  prepare(instanceId: string, stepId: string): WorkflowPreparationResult {
    const attemptId = `wexec_${crypto.randomUUID()}`;
    let wakeStep: WorkflowStepRecord | null = null;
    const result = this.repository.transaction<WorkflowPreparationResult>(() => {
      const instance = this.repository.getInstance(instanceId);
      const step = this.repository.getStep(stepId);
      if (!instance || !step || step.instance_id !== instanceId) return { kind: 'stale' };

      const now = this.clock.now();
      const nowIso = now.toISOString();
      let definitions: readonly StepDefinition[], frontierStepId: string | null;
      try {
        const validated = validateWorkflowPersistedState(
          instance, this.repository.getSteps(instanceId));
        definitions = validated.definitions;
        frontierStepId = validated.frontier?.step_id ?? null;
      } catch (error) {
        this.failStepAndInstance(instanceId, step, formatWorkflowError(error), nowIso);
        return { kind: 'failed', cause: error };
      }
      if (instance.status !== 'running') return { kind: 'stale' };
      if (frontierStepId !== stepId) return { kind: 'stale' };
      if (step.timeout_at && step.timeout_at <= nowIso) {
        this.commitTimeout(instanceId, step, nowIso);
        return { kind: 'timed-out' };
      }

      const retryDue = step.status === 'failed'
        && step.retry_at !== null
        && step.retry_at <= nowIso;
      if (step.status !== 'pending' && step.status !== 'waiting' && !retryDue) {
        return { kind: 'stale' };
      }
      const definition = definitions[step.step_index];
      if (!definition) return { kind: 'stale' };

      let workflowInput: unknown;
      let stepInput: unknown;
      try {
        workflowInput = parsePersistedJson(instance.input, 'workflow input');
        stepInput = step.step_index === 0
          ? workflowInput
          : parsePersistedJson(
              this.repository.getPreviousStepOutput(instanceId, step.step_index),
              'previous step output',
            );
      } catch (error) {
        this.failStepAndInstance(
          instanceId,
          step,
          `Workflow persisted data is invalid: ${formatWorkflowError(error)}`,
          nowIso,
        );
        return { kind: 'failed', cause: error };
      }

      if (step.status === 'pending' && step.started_at === null && definition.condition) {
        let conditionMatches: boolean;
        try {
          conditionMatches = compileWorkflowCondition(definition.condition)(workflowInput);
        } catch (error) {
          this.failStepAndInstance(
            instanceId,
            step,
            `Workflow condition failed: ${formatWorkflowError(error)}`,
            nowIso,
          );
          return { kind: 'failed', cause: error };
        }
        if (!conditionMatches) {
          this.repository.updateStep(stepId, {
            status: 'skipped',
            completed_at: nowIso,
            retry_at: null,
            timeout_at: null,
            error: null,
          });
          return { kind: 'skipped' };
        }
      }

      let timeoutAt = step.timeout_at;
      if (timeoutAt === null && definition.timeoutMs) {
        const deadline = new Date(now.getTime() + definition.timeoutMs);
        if (!Number.isFinite(deadline.getTime())) {
          this.failStepAndInstance(
            instanceId,
            step,
            'Workflow step timeout is outside the supported date range',
            nowIso,
          );
          return { kind: 'failed' };
        }
        timeoutAt = deadline.toISOString();
      }

      let waitEvent: ClaimedWorkflowEvent | undefined;
      if (step.wait_event) {
        try {
          waitEvent = this.runtime.claimedEvent(stepId)
            ?? this.runtime.claimEvent(instanceId, stepId, step.wait_event, nowIso)
            ?? undefined;
        } catch (error) {
          this.failStepAndInstance(
            instanceId,
            step,
            `Workflow event payload is invalid: ${formatWorkflowError(error)}`,
            nowIso,
          );
          return { kind: 'failed', cause: error };
        }
        if (!waitEvent) {
          this.repository.updateStep(stepId, {
            status: 'waiting',
            started_at: step.started_at ?? nowIso,
            timeout_at: timeoutAt,
            retry_at: null,
          });
          wakeStep = this.repository.getStep(stepId);
          return { kind: 'waiting' };
        }
        if (waitEvent.authorityInvalid) {
          const error = new WorkflowError(
            'Workflow event authority is invalid',
            'WORKFLOW_STATE_INVALID',
            500,
          );
          this.failStepAndInstance(instanceId, step, error.message, nowIso);
          return { kind: 'failed', cause: error };
        }
      }

      this.runtime.beginAttempt(stepId, instanceId, attemptId, nowIso);
      this.repository.updateStep(stepId, {
        status: 'running',
        started_at: step.started_at ?? nowIso,
        timeout_at: timeoutAt,
        retry_at: null,
        error: null,
      });
      wakeStep = this.repository.getStep(stepId);
      return {
        kind: 'execute',
        prepared: {
          attemptId,
          instanceId,
          step,
          handlerName: definition.handler,
          workflowInput,
          input: stepInput,
          ...(waitEvent ? { waitEvent } : {}),
        },
      };
    });
    if (wakeStep) this.wakes.armStep(wakeStep);
    if (result.kind === 'timed-out' || result.kind === 'failed') {
      this.wakes.disarmInstance(instanceId);
    } else if (result.kind === 'skipped') {
      this.wakes.disarmStep(stepId);
    }
    return result;
  }
  commitSuccess(
    prepared: PreparedWorkflowExecution,
    output: string | null,
    beforeCommit: () => boolean = () => true,
  ): WorkflowExecutionResult {
    const result = this.repository.transaction(() => {
      const current = this.currentAttempt(prepared);
      if (!current) return 'stale';
      if (!beforeCommit()) return 'stale';
      const now = this.clock.now().toISOString();
      if (current.step.timeout_at && current.step.timeout_at <= now) {
        this.commitTimeout(prepared.instanceId, current.step, now);
        return 'timed-out';
      }
      this.repository.updateStep(current.step.step_id, {
        status: 'completed',
        output,
        completed_at: now,
        retry_at: null,
        timeout_at: null,
        error: null,
      });
      this.consumeClaimedWaitEvent(current.step.step_id);
      this.runtime.finishAttempt(current.step.step_id, prepared.attemptId);
      return 'completed';
    });
    if (result === 'completed') this.wakes.disarmStep(prepared.step.step_id);
    if (result === 'timed-out') this.wakes.disarmInstance(prepared.instanceId);
    return result;
  }
  commitFailure(
    prepared: PreparedWorkflowExecution,
    error: string,
    retryable = true,
    cause?: unknown,
    beforeCommit: () => boolean = () => true,
  ): WorkflowExecutionResult {
    let retryWake: { retryAt: string; timeoutAt: string | null } | null = null;
    const result = this.repository.transaction(() => {
      const current = this.currentAttempt(prepared);
      if (!current) return 'stale' as const;
      if (!beforeCommit()) return 'stale' as const;
      const now = this.clock.now();
      const nowIso = now.toISOString();
      if (current.step.timeout_at && current.step.timeout_at <= nowIso) {
        this.commitTimeout(prepared.instanceId, current.step, nowIso);
        return 'timed-out' as const;
      }

      const attemptsUsed = current.step.retries + 1;
      this.runtime.finishAttempt(current.step.step_id, prepared.attemptId);
      if (retryable && attemptsUsed < current.step.max_retries) {
        const definition = parseWorkflowStepDefinitions(
          current.instance.steps_json,
        )[current.step.step_index];
        const baseBackoff = definition?.backoffMs ?? 1000;
        const backoffMs = Math.min(
          baseBackoff * Math.pow(2, Math.max(0, attemptsUsed - 1)),
          MAX_BACKOFF_MS,
        );
        const retryAt = new Date(now.getTime() + backoffMs).toISOString();
        this.repository.updateStep(current.step.step_id, {
          status: 'failed',
          error,
          retries: attemptsUsed,
          retry_at: retryAt,
        });
        retryWake = { retryAt, timeoutAt: current.step.timeout_at };
        return 'retry-scheduled' as const;
      }

      this.failStepAndInstance(
        prepared.instanceId,
        current.step,
        error,
        nowIso,
        attemptsUsed,
      );
      return 'failed' as const;
    });

    if (result === 'retry-scheduled') {
      const wake = retryWake as unknown as { retryAt: string; timeoutAt: string | null };
      this.wakes.armRetry(prepared.instanceId, prepared.step.step_id, wake.retryAt);
      if (wake.timeoutAt) {
        this.wakes.armTimeout(prepared.instanceId, prepared.step.step_id, wake.timeoutAt);
      }
      this.observability.emitAfterCommit(OBS_CODES.WORKFLOW_STEP_RETRY_SCHEDULED, {
        error: cause,
        metadata: {
          instanceId: prepared.instanceId,
          stepId: prepared.step.step_id,
          stepIndex: prepared.step.step_index,
          attempt: prepared.step.retries + 1,
        },
      });
    } else if (result === 'failed') {
      this.wakes.disarmInstance(prepared.instanceId);
      this.observability.emitAfterCommit(OBS_CODES.WORKFLOW_INSTANCE_FAILED, {
        error: cause,
        metadata: {
          instanceId: prepared.instanceId,
          stepId: prepared.step.step_id,
          stepIndex: prepared.step.step_index,
        },
      });
    } else if (result === 'timed-out') this.wakes.disarmInstance(prepared.instanceId);
    return result;
  }

  isCurrent(prepared: PreparedWorkflowExecution): boolean {
    return this.currentAttempt(prepared) !== null;
  }

  release(prepared: PreparedWorkflowExecution): void {
    this.repository.transaction(() => {
      const current = this.currentAttempt(prepared);
      if (!current) return;
      this.runtime.finishAttempt(current.step.step_id, prepared.attemptId);
      this.repository.updateStep(current.step.step_id, { status: 'pending' });
    });
  }

  emitTimeout(instanceId: string, stepId: string): void {
    this.observability.emitAfterCommit(OBS_CODES.WORKFLOW_STEP_TIMED_OUT, {
      metadata: { instanceId, stepId },
    });
    this.observability.emitAfterCommit(OBS_CODES.WORKFLOW_INSTANCE_FAILED, {
      metadata: { instanceId, stepId, reason: 'timeout' },
    });
  }

  private currentAttempt(prepared: PreparedWorkflowExecution): {
    instance: WorkflowInstanceRecord;
    step: WorkflowStepRecord;
  } | null {
    const instance = this.repository.getInstance(prepared.instanceId);
    const step = this.repository.getStep(prepared.step.step_id);
    if (!instance
      || !step
      || instance.status !== 'running'
      || step.status !== 'running'
      || !this.runtime.isCurrentAttempt(step.step_id, prepared.attemptId)) return null;
    return { instance, step };
  }

  private commitTimeout(instanceId: string, step: WorkflowStepRecord, now: string): void {
    this.consumeClaimedWaitEvent(step.step_id);
    this.runtime.finishAttempt(step.step_id);
    this.repository.updateStep(step.step_id, {
      status: 'failed',
      error: 'Step timed out',
      completed_at: now,
      retry_at: null,
      timeout_at: null,
    });
    this.repository.updateInstance(instanceId, {
      status: 'failed',
      error: `Step "${step.step_name}" timed out`,
      current_step: step.step_index,
      updated_at: now,
      completed_at: now,
    });
    this.runtime.discardInstanceQueue(instanceId, now);
  }

  private failStepAndInstance(
    instanceId: string,
    step: WorkflowStepRecord,
    error: string,
    now: string,
    retries = step.retries,
  ): void {
    this.consumeClaimedWaitEvent(step.step_id);
    this.runtime.finishAttempt(step.step_id);
    this.repository.updateStep(step.step_id, {
      status: 'failed',
      error,
      retries,
      completed_at: now,
      retry_at: null,
      timeout_at: null,
    });
    this.repository.updateInstance(instanceId, {
      status: 'failed',
      error,
      current_step: step.step_index,
      updated_at: now,
      completed_at: now,
    });
    this.runtime.discardInstanceQueue(instanceId, now);
  }

  private consumeClaimedWaitEvent(stepId: string): void {
    const event = this.runtime.claimedEvent(stepId);
    if (!event) return;
    if (!this.runtime.consumeClaimedEvent(stepId, event.eventId)) {
      throw new WorkflowError(
        'Workflow wait event could not be consumed atomically',
        'WORKFLOW_STATE_INVALID',
        500,
      );
    }
  }
}

function parsePersistedJson(value: unknown, label: string): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new TypeError(`Persisted ${label} must be JSON text or null`);
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new TypeError(`Persisted ${label} contains malformed JSON`, { cause: error });
  }
}
