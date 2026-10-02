/**
 * Scheduler, startup recovery, and teardown coordination for workflows.
 *
 * Keeping these process-lifecycle responsibilities out of WorkflowService
 * leaves the service focused on the public command surface and frontier pump.
 */

import { OBS_CODES } from '../observability/codes';
import type { WorkflowClock, WorkflowExecutor } from './workflow-executor';
import { WorkflowError } from './workflow-error';
import { validateWorkflowPersistedState } from './workflow-persisted-state';
import type { WorkflowRepository } from './workflow-repository';
import type { WorkflowRegistry } from './workflow-registry';
import type { WorkflowRuntimeStore } from './workflow-runtime-store';
import type { WorkflowInstanceRecord, WorkflowStepRecord } from './types';
import {
  createWorkflowObservability,
  type WorkflowObservability,
} from './workflow-observability';
import type {
  WorkflowWake,
  WorkflowWakeCoordinator,
} from './workflow-wake-coordinator';

const TERMINAL_STEP_STATUSES = new Set(['completed', 'skipped']);

export type WorkflowDispatchPhase = 'retry' | 'recovery' | 'timeout';
export type WorkflowDispatch = (
  instanceId: string,
  phase: WorkflowDispatchPhase,
) => void;

export class WorkflowLifecycleCoordinator {
  private operationStarted = false;
  private recoveryState: 'idle' | 'running' | 'complete' = 'idle';

  constructor(
    private readonly repository: WorkflowRepository,
    private readonly registry: WorkflowRegistry,
    private readonly runtime: WorkflowRuntimeStore,
    private readonly executor: WorkflowExecutor,
    private readonly clock: WorkflowClock,
    private readonly wakes: WorkflowWakeCoordinator,
    private readonly observability: WorkflowObservability = createWorkflowObservability(),
  ) {}

  markOperationStarted(): void {
    if (this.recoveryState === 'running') {
      throw new WorkflowError(
        'Workflow recovery is in progress',
        'WORKFLOW_NOT_READY',
        503,
      );
    }
    this.operationStarted = true;
  }

  pollRetries(dispatch: WorkflowDispatch): number {
    this.markOperationStarted();
    const due = this.repository.listDueRetryInstanceIds(
      this.clock.now().toISOString(),
    );
    for (const instanceId of due) dispatch(instanceId, 'retry');
    return due.length;
  }

  pollTimeouts(): number {
    this.markOperationStarted();
    const now = this.clock.now().toISOString();
    const candidates = this.repository.listTimeoutCandidates(now);
    let count = 0;

    for (const candidate of candidates) {
      if (this.expireTimeout(candidate.instance_id, candidate.step_id, candidate.timeout_at!, now)) {
        count += 1;
      }
    }
    return count;
  }

  /** Apply one timer wake only if its exact durable frontier is still current. */
  handleTimeoutWake(wake: WorkflowWake): void {
    const now = this.clock.now().toISOString();
    if (wake.expectedAt > now) return;
    this.expireTimeout(wake.instanceId, wake.stepId, wake.expectedAt, now);
  }

  async recoverInFlight(
    dispatch: WorkflowDispatch,
    assertAvailable: () => void,
    onReady: () => void = () => undefined,
  ): Promise<number> {
    assertAvailable();
    if (this.operationStarted || this.recoveryState !== 'idle') {
      throw new WorkflowError(
        'Workflow recovery is an initialization-only operation',
        'WORKFLOW_STATE_INVALID',
        409,
      );
    }
    this.recoveryState = 'running';
    let normalizationCommitted = false;

    try {
      const nonterminalInstances = this.repository.listNonterminalInstances();
      const recoverable: RecoveryState[] = [];
      const now = this.clock.now().toISOString();
      for (const instance of nonterminalInstances) {
        const steps = this.repository.getSteps(instance.instance_id);
        try {
          this.runtime.validateEventUsage(instance.instance_id);
          this.runtime.validateLegacyEventState(instance.instance_id);
          this.repository.validateRuntimeBudget(instance.instance_id);
          const validated = validateWorkflowPersistedState(instance, steps);
          const expiredFrontier = instance.status === 'running'
            && validated.frontier?.timeout_at !== null
            && validated.frontier?.timeout_at !== undefined
            && validated.frontier.timeout_at <= now
            && isTimeoutEligible(validated.frontier)
              ? validated.frontier
              : null;
          recoverable.push({
            instance,
            steps,
            definitions: validated.definitions,
            expiredFrontier,
          });
        } catch (error) {
          if (error instanceof WorkflowError) throw error;
          this.observability.emitNow(OBS_CODES.WORKFLOW_ADVANCE_FAILED, {
            error,
            metadata: { instanceId: instance.instance_id, phase: 'recovery-preflight' },
          });
          throw new WorkflowError(
            `Cannot recover workflow "${instance.instance_id}": persisted state is invalid`,
            'WORKFLOW_STATE_INVALID',
            500,
          );
        }
      }
      for (const state of recoverable) {
        if (!state.expiredFrontier) {
          this.requireRecoveryHandlers(
            state.instance,
            state.steps,
            state.definitions,
          );
        }
      }

      const runningStates = recoverable
        .filter(({ instance }) => instance.status === 'running');
      const runningSteps = runningStates.flatMap(({ steps, expiredFrontier }) =>
        expiredFrontier
          ? []
          : steps.filter((step) => step.status === 'running')
      );
      this.repository.transaction(() => {
        this.runtime.clearAllAttempts();
        for (const { instance, expiredFrontier } of runningStates) {
          if (expiredFrontier) {
            this.failTimedOutStep(instance.instance_id, expiredFrontier, now);
          }
        }
        for (const step of runningSteps) {
          this.repository.updateStep(step.step_id, { status: 'pending' });
        }
      });
      normalizationCommitted = true;
      for (const state of runningStates) {
        if (!state.expiredFrontier) continue;
        this.wakes.disarmInstance(state.instance.instance_id);
        this.executor.abortStep(state.expiredFrontier.step_id, 'Workflow step timed out');
        emitTimeout(this.observability, state.expiredFrontier);
      }
      assertAvailable();

      this.recoveryState = 'complete';
      this.operationStarted = true;
      onReady();
      assertAvailable();
      for (const state of runningStates) {
        if (state.expiredFrontier) continue;
        const frontier = this.repository.getSteps(state.instance.instance_id)
          .find((step) => !TERMINAL_STEP_STATUSES.has(step.status));
        if (frontier) this.wakes.armStep(frontier);
        dispatch(state.instance.instance_id, 'recovery');
      }
      assertAvailable();
      return runningSteps.length;
    } catch (error) {
      this.recoveryState = normalizationCommitted ? 'complete' : 'idle';
      if (normalizationCommitted) this.operationStarted = true;
      throw error;
    }
  }

  async dispose(): Promise<void> {
    const errors: unknown[] = [];
    this.wakes.dispose();
    try {
      this.repository.transaction(() => {
        for (const step of this.repository.listRunningStepsForDisposal()) {
          this.runtime.finishAttempt(step.step_id);
          this.repository.updateStep(step.step_id, { status: 'pending' });
        }
      });
    } catch (error) {
      errors.push(error);
      if (!isRuntimeOwnershipError(error)) {
        try {
          this.runtime.clearAllAttempts();
        } catch (fenceError) {
          errors.push(fenceError);
        }
      }
    }
    try {
      await this.executor.dispose();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Workflow service disposal failed');
    }
  }

  /** Drain local execution after ownership loss without touching durable rows. */
  async disposeWithoutPersistence(): Promise<void> {
    this.wakes.dispose();
    await this.executor.dispose();
  }

  failTimedOutStep(
    instanceId: string,
    step: WorkflowStepRecord,
    now: string,
  ): void {
    this.runtime.finishAttempt(step.step_id);
    this.repository.updateStep(step.step_id, {
      status: 'failed',
      error: 'Step timed out',
      retry_at: null,
      timeout_at: null,
      completed_at: now,
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

  emitTimeout(step: WorkflowStepRecord): void {
    emitTimeout(this.observability, step);
  }

  private expireTimeout(
    instanceId: string,
    stepId: string,
    expectedAt: string,
    now: string,
  ): boolean {
    let expiredStep: WorkflowStepRecord | null = null;
    try {
      this.repository.transaction(() => {
        const instance = this.repository.getInstance(instanceId);
        const step = this.repository.getStep(stepId);
        if (!instance || instance.status !== 'running' || !step) return;
        const validated = validateWorkflowPersistedState(
          instance,
          this.repository.getSteps(instanceId),
        );
        if (validated.frontier?.step_id !== stepId
          || step.timeout_at !== expectedAt
          || step.timeout_at > now
          || !isTimeoutEligible(step)) return;
        this.failTimedOutStep(instanceId, step, now);
        expiredStep = step;
      });
    } catch (error) {
      this.observability.emitNow(OBS_CODES.WORKFLOW_ADVANCE_FAILED, {
        error,
        metadata: { instanceId, stepId, phase: 'timeout-validation' },
      });
      return false;
    }
    const expired = expiredStep as WorkflowStepRecord | null;
    if (!expired) return false;
    this.wakes.disarmInstance(instanceId);
    this.executor.abortStep(stepId, 'Workflow step timed out');
    emitTimeout(this.observability, expired);
    return true;
  }

  private requireRecoveryHandlers(
    instance: WorkflowInstanceRecord,
    steps: readonly WorkflowStepRecord[],
    definitions: readonly { handler: string }[],
  ): void {
    for (const step of steps) {
      if (!requiresRecoveryHandler(step)) continue;
      const definition = definitions[step.step_index]!;
      if (this.registry.getHandler(definition.handler)) continue;
      this.observability.emitNow(OBS_CODES.WORKFLOW_HANDLER_MISSING, {
        metadata: {
          instanceId: instance.instance_id,
          stepId: step.step_id,
          stepIndex: step.step_index,
          handler: definition.handler,
          phase: 'recovery',
        },
      });
      throw new WorkflowError(
        `Cannot recover workflow: handler "${definition.handler}" is not registered`,
        'WORKFLOW_HANDLER_NOT_REGISTERED',
        500,
      );
    }
  }
}

function isRuntimeOwnershipError(error: unknown): boolean {
  return error instanceof WorkflowError
    && (error.code === 'WORKFLOW_RUNTIME_OWNED'
      || error.code === 'WORKFLOW_RUNTIME_LEASE_LOST');
}

interface RecoveryState {
  instance: WorkflowInstanceRecord;
  steps: WorkflowStepRecord[];
  definitions: readonly { handler: string }[];
  expiredFrontier: WorkflowStepRecord | null;
}

function emitTimeout(
  observability: WorkflowObservability,
  step: WorkflowStepRecord,
): void {
  observability.emitAfterCommit(OBS_CODES.WORKFLOW_STEP_TIMED_OUT, {
    metadata: {
      instanceId: step.instance_id,
      stepId: step.step_id,
      stepIndex: step.step_index,
    },
  });
  observability.emitAfterCommit(OBS_CODES.WORKFLOW_INSTANCE_FAILED, {
    metadata: { instanceId: step.instance_id, reason: 'timeout' },
  });
}

function isTimeoutEligible(step: WorkflowStepRecord): boolean {
  return step.status === 'pending'
    || step.status === 'waiting'
    || step.status === 'running'
    || (step.status === 'failed' && step.retry_at !== null);
}

function requiresRecoveryHandler(step: WorkflowStepRecord): boolean {
  return step.status === 'pending'
    || step.status === 'running'
    || step.status === 'waiting'
    || (step.status === 'failed' && step.retry_at !== null);
}
