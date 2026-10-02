/** Durable instance-level lifecycle transitions for graph workflows. */

import { OBS_CODES } from '../observability/codes';
import { formatWorkflowError, WorkflowError } from './workflow-error';
import type { WorkflowGraphActivityExecutor } from './workflow-graph-activity-executor';
import type { WorkflowGraphStore } from './workflow-graph-store';
import type { WorkflowGraphWakeScheduler } from './workflow-graph-wake-scheduler';
import type { WorkflowGraphIR, WorkflowIRNode } from './workflow-ir';
import type { WorkflowInteractionService } from './workflow-interaction-service';
import type { WorkflowRuntimeStore } from './workflow-runtime-store';
import { serializeWorkflowRuntimeJson } from './workflow-runtime-json';
import type { WorkflowExecutionAuthorityGate } from './workflow-execution-authority-gate';
import {
  createWorkflowObservability,
  type WorkflowObservability,
} from './workflow-observability';

const SETTLED_STEPS = new Set(['completed', 'skipped', 'failed']);

export class WorkflowGraphInstanceController {
  constructor(
    private readonly store: WorkflowGraphStore,
    private readonly runtime: WorkflowRuntimeStore,
    private readonly executor: WorkflowGraphActivityExecutor,
    private readonly interactions: WorkflowInteractionService,
    private readonly wakes: WorkflowGraphWakeScheduler,
    private readonly dispatch: (instanceId: string, phase: string) => void,
    private readonly authority: Pick<WorkflowExecutionAuthorityGate, 'validateInstance'>,
    private readonly now: () => Date = () => new Date(),
    private readonly observability: WorkflowObservability = createWorkflowObservability(),
  ) {}

  normalizeAfterRestart(instanceId: string): number {
    let recovered = 0;
    this.store.transaction(() => {
      this.runtime.finishInstanceAttempts(instanceId);
      const now = this.now().toISOString();
      for (const step of this.store.listSteps(instanceId)) {
        if (step.status !== 'running') continue;
        this.store.updateStep(step.step_id, { status: 'pending', updated_at: now });
        recovered += 1;
      }
      for (const item of this.store.listInstanceEachItems(instanceId)) {
        if (item.status === 'running') {
          this.store.updateEachItem(item.item_id, { status: 'pending', updated_at: now });
        }
      }
    });
    return recovered;
  }

  promoteDueRetries(instanceId: string): void {
    const now = this.now().toISOString();
    this.store.transaction(() => {
      for (const step of this.store.listSteps(instanceId)) {
        if (step.status === 'failed' && step.retry_at && step.retry_at <= now) {
          this.store.updateStep(step.step_id, {
            status: 'pending', retry_at: null, updated_at: now,
          });
        }
      }
    });
  }

  armInstance(instanceId: string): void {
    if (this.store.getInstance(instanceId)?.status !== 'running') return;
    for (const step of this.store.listSteps(instanceId)) {
      this.wakes.disarmStep(step.step_id);
      if (step.retry_at) this.wakes.armRetry(instanceId, step.step_id, step.retry_at);
      if (step.timeout_at) this.wakes.armTimeout(instanceId, step.step_id, step.timeout_at);
    }
  }

  completeIfDone(instanceId: string, graph: WorkflowGraphIR): boolean {
    const steps = this.store.listRootSteps(instanceId);
    if (steps.some((step) => step.status !== 'completed' && step.status !== 'skipped')) {
      return false;
    }
    const exits = graph.nodes.filter((node) => !graph.edges.some((edge) => edge.from === node.id));
    const values = exits.map((node) => ({
      node: node.id,
      value: parseJson(steps.find((step) => step.node_id === node.id)?.output ?? null),
    }));
    const output = values.length === 1
      ? values[0]!.value
      : Object.fromEntries(values.map(({ node, value }) => [node, value]));
    const now = this.now().toISOString();
    const completed = this.store.transaction(() => {
      const instance = this.store.getInstance(instanceId);
      if (!instance || instance.status !== 'running') return false;
      if (!this.authority.validateInstance(instanceId)) return false;
      this.store.updateInstance(instanceId, {
        status: 'completed', current_step: steps.length,
        output: serializeWorkflowRuntimeJson(output, {
          code: 'WORKFLOW_OUTPUT_INVALID', label: 'Workflow output',
          invalidStatus: 500, limitStatus: 500,
        }),
        error: null, completed_at: now, updated_at: now,
      });
      this.runtime.discardInstanceQueue(instanceId, now);
      return true;
    });
    if (completed) {
      this.wakes.disarmInstance(instanceId);
      this.observability.emitAfterCommit(
        OBS_CODES.WORKFLOW_INSTANCE_COMPLETED,
        { metadata: { instanceId } },
      );
    }
    return completed;
  }

  expire(instanceId: string, stepId: string, expectedAt: string): void {
    const interaction = this.interactions.getByStep(instanceId, stepId);
    if (interaction) {
      const expired = this.interactions.expire(interaction.interactionId);
      if (expired.status === 'expired') this.dispatch(instanceId, 'interaction-timeout');
      return;
    }
    const now = this.now().toISOString();
    let expired = false;
    let isolated = false;
    this.store.transaction(() => {
      const instance = this.store.getInstance(instanceId);
      const step = this.store.getStep(stepId);
      if (!instance || instance.status !== 'running' || !step
        || step.timeout_at !== expectedAt || expectedAt > now
        || !['pending', 'running', 'waiting', 'failed'].includes(step.status)) return;
      this.runtime.finishAttempt(stepId);
      isolated = Boolean(step.parent_step_id);
      this.store.updateStep(stepId, {
        status: 'failed', error: 'Step timed out', retry_at: null,
        timeout_at: null, completed_at: now, updated_at: now,
      });
      if (isolated) this.failEachItem(instanceId, step, now);
      else this.store.updateInstance(instanceId, {
        status: 'failed', error: 'Workflow step timed out',
        current_step: step.step_index, completed_at: now, updated_at: now,
      });
      if (!isolated) this.runtime.discardInstanceQueue(instanceId, now);
      expired = true;
    });
    if (!expired) return;
    this.observability.emitAfterCommit(OBS_CODES.WORKFLOW_STEP_TIMED_OUT, {
      metadata: { instanceId, stepId },
    });
    if (!isolated) this.observability.emitAfterCommit(OBS_CODES.WORKFLOW_INSTANCE_FAILED, {
      metadata: { instanceId, stepId, reason: 'timeout' },
    });
    if (isolated) this.executor.abortStep(stepId, 'Workflow step timed out');
    else this.executor.abortInstance(instanceId, 'Workflow step timed out');
    this.dispatch(instanceId, 'timeout');
  }

  fail(instanceId: string, cause: unknown, reason: string): void {
    const error = formatWorkflowError(cause);
    const terminalAt = this.now().toISOString();
    const changed = this.store.transaction(() => {
      const instance = this.store.getInstance(instanceId);
      if (!instance || ['completed', 'failed', 'cancelled'].includes(instance.status)) return false;
      this.runtime.finishInstanceAttempts(instanceId);
      const now = terminalAt;
      const steps = this.store.listSteps(instanceId);
      const failure = steps.find((step) => !SETTLED_STEPS.has(step.status))
        ?? steps.find((step) => step.status === 'failed');
      for (const step of steps) {
        if (step.step_id === failure?.step_id) {
          this.store.updateStep(step.step_id, {
            status: 'failed', error, retry_at: null, timeout_at: null,
            completed_at: now, updated_at: now,
          });
        } else if (!SETTLED_STEPS.has(step.status)) {
          this.store.updateStep(step.step_id, {
            status: 'skipped', error: 'Workflow failed', retry_at: null,
            timeout_at: null, completed_at: now, updated_at: now,
          });
        }
      }
      this.cancelUnfinishedItems(instanceId, now);
      this.store.updateInstance(instanceId, {
        status: 'failed', error, completed_at: now, updated_at: now,
      });
      this.interactions.cancelForInstance(instanceId);
      this.runtime.discardInstanceQueue(instanceId, now);
      return true;
    });
    if (!changed) return;
    this.finishTerminal(instanceId, terminalAt);
    this.observability.emitAfterCommit(OBS_CODES.WORKFLOW_INSTANCE_FAILED, {
      error: cause,
      metadata: { instanceId, reason },
    });
  }

  cleanupTerminal(instanceId: string): void {
    const instance = this.store.getInstance(instanceId);
    if (!instance || !['completed', 'failed', 'cancelled'].includes(instance.status)) return;
    const terminalAt = this.now().toISOString();
    if (instance.status !== 'completed') {
      this.store.transaction(() => {
        const now = terminalAt;
        this.runtime.finishInstanceAttempts(instanceId);
        for (const step of this.store.listSteps(instanceId)) {
          if (!SETTLED_STEPS.has(step.status)) this.store.updateStep(step.step_id, {
            status: 'skipped', error: instance.status === 'cancelled'
              ? 'Workflow cancelled' : 'Workflow failed',
            retry_at: null, timeout_at: null, completed_at: now, updated_at: now,
          });
        }
        this.cancelUnfinishedItems(instanceId, now);
      });
    }
    this.finishTerminal(instanceId, terminalAt);
  }

  private failEachItem(instanceId: string, step: { parent_step_id?: string | null; item_key?: string | null }, now: string): void {
    if (!step.parent_step_id || !step.item_key) return;
    const parent = this.store.getStep(step.parent_step_id);
    if (!parent?.node_id) return;
    const item = this.store.listEachItems(instanceId, parent.node_id)
      .find((candidate) => candidate.item_key === step.item_key);
    if (item) this.store.updateEachItem(item.item_id, {
      status: 'failed', error: 'Step timed out', completed_at: now, updated_at: now,
    });
  }

  private cancelUnfinishedItems(instanceId: string, now: string): void {
    for (const item of this.store.listInstanceEachItems(instanceId)) {
      if (item.status === 'pending' || item.status === 'running') {
        this.store.updateEachItem(item.item_id, {
          status: 'cancelled', error: 'Workflow ended before the item completed',
          completed_at: now, updated_at: now,
        });
      }
    }
  }

  private finishTerminal(instanceId: string, terminalAt: string): void {
    this.runtime.discardInstanceQueue(instanceId, terminalAt);
    this.interactions.abortInstance(instanceId, new WorkflowError(
      'Workflow interaction cannot be processed after its workflow stopped',
      'WORKFLOW_STATE_INVALID',
      409,
    ));
    this.interactions.cancelForInstance(instanceId);
    this.wakes.disarmInstance(instanceId);
    this.executor.abortInstance(instanceId, 'Workflow reached a terminal state');
  }
}

function parseJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new TypeError('Persisted workflow JSON must be text');
  return JSON.parse(value);
}
