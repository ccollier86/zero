/**
 * Executes one durable graph activity attempt and atomically commits its result.
 *
 * Owns handler lifecycle, retry/timeout fencing, scratch-memory commit, and
 * activity observability. DAG planning and instance lifecycle live elsewhere.
 */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { WorkflowActivityCatalog } from './workflow-activity-catalog';
import { evaluateWorkflowExpression } from './workflow-expression';
import { WorkflowExecutionTracker } from './workflow-execution-tracker';
import { WorkflowError } from './workflow-error';
import { emitWorkflowGraphActivityFailure } from './workflow-graph-activity-observability';
import {
  parseWorkflowPersistedJson,
  raceWorkflowActivityWithAbort,
  serializeWorkflowActivityInput,
  serializeWorkflowActivityOutput,
  workflowAbortReason,
} from './workflow-graph-activity-values';
import type {
  WorkflowGraphActivityExecutorOptions,
  WorkflowGraphActivityItemContext,
  WorkflowGraphActivityResult,
} from './workflow-graph-activity-types';
import {
  collectWorkflowNodeOutputs,
  resolveWorkflowNodeInput,
} from './workflow-graph-planner';
import type { WorkflowGraphStore } from './workflow-graph-store';
import type { WorkflowActivityNode, WorkflowGraphIR } from './workflow-ir';
import { createWorkflowMemoryContext } from './workflow-memory-context';
import type { WorkflowMemoryStore } from './workflow-memory-store';
import type { WorkflowRuntimeStore } from './workflow-runtime-store';
import type { StepContext, WorkflowInstanceRecord, WorkflowStepRecord } from './types';
import { formatWorkflowError } from './workflow-error';

export type { WorkflowGraphActivityExecutorOptions,
  WorkflowGraphActivityItemContext, WorkflowGraphActivityResult,
} from './workflow-graph-activity-types';
const MAX_BACKOFF_MS = 5 * 60 * 1000;

interface PreparedActivity {
  instance: WorkflowInstanceRecord;
  step: WorkflowStepRecord;
  node: WorkflowActivityNode;
  attemptId: string;
  input: unknown;
  workflowInput: unknown;
  item?: WorkflowGraphActivityItemContext;
}

export class WorkflowGraphActivityExecutor {
  private readonly tracker: WorkflowExecutionTracker;
  private readonly now: () => Date;
  private disposed = false;

  constructor(
    private readonly store: WorkflowGraphStore,
    private readonly runtime: WorkflowRuntimeStore,
    private readonly activities: WorkflowActivityCatalog,
    private readonly memory: WorkflowMemoryStore,
    private readonly options: WorkflowGraphActivityExecutorOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.tracker = new WorkflowExecutionTracker(options.shutdownGraceMs);
  }

  async execute(
    instanceId: string,
    stepId: string,
    graph: WorkflowGraphIR,
    node: WorkflowActivityNode,
    item?: WorkflowGraphActivityItemContext,
  ): Promise<WorkflowGraphActivityResult> {
    if (this.disposed) return 'stale';
    if (this.tracker.isStepActive(stepId)) return 'stale';
    const prepared = this.prepare(instanceId, stepId, graph, node, item);
    if (!prepared) return 'stale';

    let activity;
    try {
      activity = this.activities.validateInput(node.activity, prepared.input);
    } catch (error) {
      return this.commitFailure(prepared, error, false);
    }
    const memoryAttempt = createWorkflowMemoryContext(this.memory, {
      scope: item?.memoryScope ?? { instanceId, kind: 'instance' },
      stepId,
      attemptId: prepared.attemptId,
    });
    const controller = new AbortController();
    const context = Object.freeze({
      input: prepared.input,
      workflowInput: prepared.workflowInput,
      instanceId,
      stepIndex: prepared.step.step_index,
      attempt: prepared.step.retries,
      attemptId: prepared.attemptId,
      idempotencyKey: item
        ? `workflow:${instanceId}:step:${stepId}:item:${item.key}`
        : `workflow:${instanceId}:step:${stepId}`,
      signal: controller.signal,
      memory: memoryAttempt.memory,
      ...(item && item.exposeItem !== false ? {
        item: Object.freeze({ value: item.value, index: item.index, key: item.key }),
      } : {}),
      ...(item?.interaction !== undefined ? { interaction: item.interaction } : {}),
    }) as StepContext;
    const invocation = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw workflowAbortReason(controller.signal);
      return activity.handler(context);
    });
    this.tracker.track(instanceId, stepId, prepared.attemptId, controller, invocation);

    let output: unknown;
    try {
      output = await raceWorkflowActivityWithAbort(invocation, controller.signal);
    } catch (error) {
      memoryAttempt.discard();
      if (this.disposed) return 'stale';
      return this.commitFailure(
        prepared,
        error,
        !(error instanceof WorkflowError && error.code === 'WORKFLOW_RUNTIME_LIMIT_EXCEEDED'),
      );
    }
    if (this.disposed) {
      memoryAttempt.discard();
      return 'stale';
    }

    let serialized: string | null;
    try {
      this.activities.validateOutput(node.activity, output);
      serialized = serializeWorkflowActivityOutput(output);
    } catch (error) {
      memoryAttempt.discard();
      return this.commitFailure(prepared, error, false);
    }

    try {
      const committed = this.store.transaction(() => {
        const current = this.current(prepared);
        if (!current) return 'stale' as const;
        const now = this.now().toISOString();
        if (current.step.timeout_at && current.step.timeout_at <= now) {
          memoryAttempt.discard();
          this.failTimedOut(current.instance, current.step, now, Boolean(prepared.item));
          return 'timed-out' as const;
        }
        memoryAttempt.commit(() => Boolean(this.current(prepared)));
        this.store.updateStep(stepId, {
          status: 'completed',
          output: prepared.item?.persistOutput === false ? null : serialized,
          error: null,
          retry_at: null,
          timeout_at: null,
          completed_at: now,
          updated_at: now,
        });
        this.runtime.finishAttempt(stepId, prepared.attemptId);
        return 'completed' as const;
      });
      if (committed === 'completed') {
        emitPlatformCode(OBS_CODES.WORKFLOW_NODE_COMPLETED, {
          metadata: { instanceId, stepId, nodeId: node.id },
        });
      }
      return committed;
    } catch (error) {
      memoryAttempt.discard();
      if (this.disposed) return 'stale';
      return this.commitFailure(
        prepared,
        error,
        !(error instanceof WorkflowError && error.code === 'WORKFLOW_RUNTIME_LIMIT_EXCEEDED'),
      );
    }
  }

  abortInstance(instanceId: string, reason: string): void {
    this.tracker.abortInstance(instanceId, reason);
  }

  abortStep(stepId: string, reason: string): void {
    this.tracker.abortStep(stepId, reason);
  }

  isInstanceDraining(instanceId: string): boolean {
    return this.tracker.isInstanceActive(instanceId);
  }

  dispose(): Promise<void> {
    this.disposed = true;
    return this.tracker.dispose();
  }

  private prepare(
    instanceId: string,
    stepId: string,
    graph: WorkflowGraphIR,
    node: WorkflowActivityNode,
    item?: WorkflowGraphActivityItemContext,
  ): PreparedActivity | null {
    const attemptId = `wexec_${crypto.randomUUID()}`;
    let prepared: PreparedActivity | null = null;
    this.store.transaction(() => {
      const instance = this.store.getInstance(instanceId);
      const step = this.store.getStep(stepId);
      const nowDate = this.now();
      const now = nowDate.toISOString();
      if (!instance || instance.status !== 'running' || !step || step.instance_id !== instanceId) return;
      const retryDue = step.status === 'failed' && step.retry_at !== null && step.retry_at <= now;
      if (step.status !== 'pending' && !retryDue) return;
      if (step.timeout_at && step.timeout_at <= now) {
        this.failTimedOut(instance, step, now, Boolean(item));
        return;
      }
      const steps = this.store.listRootSteps(instanceId);
      const workflowInput = parseWorkflowPersistedJson(instance.input);
      const previous = item?.inputOverride ?? item?.value ?? resolveWorkflowNodeInput(
        node.id,
        graph,
        steps,
        this.store.listEdges(instanceId),
        this.store.listDecisions(instanceId),
        workflowInput,
      );
      const memory = Object.fromEntries(this.memory.list(
        item?.memoryScope ?? { instanceId, kind: 'instance' },
      ).map((entry) => [entry.key, entry.value]));
      const input = node.input
        ? evaluateWorkflowExpression(node.input, {
            input: workflowInput,
            previous,
            outputs: collectWorkflowNodeOutputs(steps),
            memory,
            item: item?.value,
            itemIndex: item?.index,
          })
        : previous;
      const timeoutAt = step.timeout_at ?? (node.timeoutMs
        ? new Date(nowDate.getTime() + node.timeoutMs).toISOString()
        : null);
      this.runtime.beginAttempt(stepId, instanceId, attemptId, now);
      this.store.updateStep(stepId, {
        status: 'running',
        input: item?.persistInput === false ? null : serializeWorkflowActivityInput(input),
        error: null,
        retry_at: null,
        timeout_at: timeoutAt,
        started_at: step.started_at ?? now,
        updated_at: now,
      });
      this.store.updateInstance(instanceId, {
        current_step: step.step_index,
        updated_at: now,
      });
      prepared = { instance, step, node, attemptId, input, workflowInput, ...(item ? { item } : {}) };
      if (timeoutAt) this.options.onTimeoutScheduled?.(instanceId, stepId, timeoutAt);
    });
    return prepared;
  }

  private commitFailure(
    prepared: PreparedActivity,
    cause: unknown,
    retryable: boolean,
  ): WorkflowGraphActivityResult {
    let retryAt: string | null = null;
    const result = this.store.transaction(() => {
      const current = this.current(prepared);
      if (!current) return 'stale' as const;
      const nowDate = this.now();
      const now = nowDate.toISOString();
      if (current.step.timeout_at && current.step.timeout_at <= now) {
        this.failTimedOut(current.instance, current.step, now, Boolean(prepared.item));
        return 'timed-out' as const;
      }
      const attempts = current.step.retries + 1;
      this.runtime.finishAttempt(current.step.step_id, prepared.attemptId);
      if (retryable && attempts < current.step.max_retries) {
        const backoff = Math.min(
          (prepared.node.backoffMs ?? 1_000) * Math.pow(2, Math.max(0, attempts - 1)),
          MAX_BACKOFF_MS,
        );
        retryAt = new Date(nowDate.getTime() + backoff).toISOString();
        this.store.updateStep(current.step.step_id, {
          status: 'failed',
          error: formatWorkflowError(cause),
          retries: attempts,
          retry_at: retryAt,
          updated_at: now,
        });
        return 'retry-scheduled' as const;
      }
      if (prepared.item) {
        this.store.updateStep(current.step.step_id, {
          status: 'failed',
          error: formatWorkflowError(cause),
          retries: attempts,
          retry_at: null,
          timeout_at: null,
          completed_at: now,
          updated_at: now,
        });
      } else {
        this.failInstance(current.instance, current.step, formatWorkflowError(cause), attempts, now);
      }
      return 'failed' as const;
    });
    if (result === 'retry-scheduled') {
      this.options.onRetryScheduled?.(
        prepared.instance.instance_id,
        prepared.step.step_id,
        retryAt!,
      );
      emitPlatformCode(OBS_CODES.WORKFLOW_STEP_RETRY_SCHEDULED, {
        metadata: {
          instanceId: prepared.instance.instance_id,
          stepId: prepared.step.step_id,
          nodeId: prepared.node.id,
          attempt: prepared.step.retries + 1,
        },
      });
    } else if (result === 'failed' || result === 'timed-out') {
      if (!prepared.item) {
        this.abortInstance(prepared.instance.instance_id, 'Workflow activity failed');
      }
      emitWorkflowGraphActivityFailure({
        instanceId: prepared.instance.instance_id,
        stepId: prepared.step.step_id,
        nodeId: prepared.node.id,
        ...(prepared.item ? { itemIndex: prepared.item.index } : {}),
        result,
        cause,
      });
    }
    return result;
  }

  private current(prepared: PreparedActivity): {
    instance: WorkflowInstanceRecord;
    step: WorkflowStepRecord;
  } | null {
    const instance = this.store.getInstance(prepared.instance.instance_id);
    const step = this.store.getStep(prepared.step.step_id);
    if (!instance || instance.status !== 'running' || !step || step.status !== 'running'
      || !this.runtime.isCurrentAttempt(step.step_id, prepared.attemptId)) return null;
    return { instance, step };
  }

  private failTimedOut(
    instance: WorkflowInstanceRecord,
    step: WorkflowStepRecord,
    now: string,
    isolated = false,
  ): void {
    this.runtime.finishAttempt(step.step_id);
    if (isolated) {
      this.store.updateStep(step.step_id, {
        status: 'failed',
        error: 'Step timed out',
        retries: step.retries + 1,
        retry_at: null,
        timeout_at: null,
        completed_at: now,
        updated_at: now,
      });
      return;
    }
    this.failInstance(instance, step, 'Step timed out', step.retries + 1, now);
  }

  private failInstance(
    instance: WorkflowInstanceRecord,
    step: WorkflowStepRecord,
    error: string,
    attempts: number,
    now: string,
  ): void {
    this.store.updateStep(step.step_id, {
      status: 'failed',
      error,
      retries: attempts,
      retry_at: null,
      timeout_at: null,
      completed_at: now,
      updated_at: now,
    });
    for (const sibling of this.store.listSteps(instance.instance_id)) {
      if (sibling.step_id === step.step_id
        || sibling.status === 'completed'
        || sibling.status === 'skipped'
        || sibling.status === 'failed') continue;
      this.runtime.finishAttempt(sibling.step_id);
      this.store.updateStep(sibling.step_id, {
        status: 'skipped',
        error: 'Workflow failed',
        retry_at: null,
        timeout_at: null,
        completed_at: now,
        updated_at: now,
      });
    }
    this.store.updateInstance(instance.instance_id, {
      status: 'failed',
      error,
      current_step: step.step_index,
      completed_at: now,
      updated_at: now,
    });
    this.runtime.discardInstanceQueue(instance.instance_id, now);
  }
}
