/**
 * workflow-executor.ts
 *
 * Part of: Workflows subsystem (executor)
 *
 * Executes a single workflow step: looks up the handler from the
 * registry, builds the StepContext with chained I/O, handles
 * waitFor/condition logic, and manages success/failure with retries.
 *
 * Dependencies:
 *   - ./types
 *   - ./workflow-registry
 *   - ../sync/reactive-db (ReactiveDB)
 */

import type { ReactiveDB } from '../sync/reactive-db';
import type { StepContext, WorkflowStepRecord } from './types';
import type { WorkflowRegistry } from './workflow-registry';

const MAX_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes

export class WorkflowExecutor {
  constructor(
    private db: ReactiveDB,
    private registry: WorkflowRegistry,
  ) {}

  /**
   * Execute a single step. Returns true if the step completed (or was skipped),
   * false if it entered waiting state or failed.
   */
  async executeStep(
    instanceId: string,
    stepId: string,
    eventPayload?: { name: string; payload: unknown },
  ): Promise<boolean> {
    const step = this.db.queryOne('workflow_steps', stepId) as WorkflowStepRecord | null;
    if (!step) throw new Error(`Step ${stepId} not found`);

    const instance = this.db.queryOne('workflow_instances', instanceId);
    if (!instance) throw new Error(`Instance ${instanceId} not found`);

    // Get handler
    const handler = this.registry.getHandler(step.step_name);
    if (!handler) {
      this.failStep(stepId, `Handler "${step.step_name}" not found in registry`);
      return false;
    }

    // Check waitFor — if step is waiting and no event provided, stay waiting
    if (step.wait_event && !eventPayload) {
      this.db.update('workflow_steps', stepId, { status: 'waiting' });
      return false;
    }

    // Check condition
    if (step.status === 'pending') {
      const stepDefs = JSON.parse(instance.steps_json as string ?? '[]');
      const stepDef = stepDefs[step.step_index];
      if (stepDef?.condition && !this.evaluateCondition(stepDef.condition, instance, step)) {
        this.db.update('workflow_steps', stepId, {
          status: 'skipped',
          completed_at: new Date().toISOString(),
        });
        return true;
      }
    }

    // Build step context
    const previousOutput = this.getPreviousStepOutput(instanceId, step.step_index);
    const ctx: StepContext = {
      input: previousOutput,
      workflowInput: instance.input ? JSON.parse(instance.input as string) : null,
      instanceId,
      stepIndex: step.step_index,
      attempt: step.retries,
      waitEvent: eventPayload,
    };

    // Mark step as running
    const now = new Date().toISOString();
    const timeoutAt = step.timeout_at ?? (
      (() => {
        const stepDefs = JSON.parse(instance.steps_json as string ?? '[]');
        const def = stepDefs[step.step_index];
        return def?.timeoutMs
          ? new Date(Date.now() + def.timeoutMs).toISOString()
          : null;
      })()
    );

    this.db.update('workflow_steps', stepId, {
      status: 'running',
      started_at: step.started_at ?? now,
      timeout_at: timeoutAt,
    });

    // Execute handler
    try {
      const output = await handler(ctx);
      this.db.update('workflow_steps', stepId, {
        status: 'completed',
        output: output !== undefined ? JSON.stringify(output) : null,
        completed_at: new Date().toISOString(),
        error: null,
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.handleStepFailure(stepId, step, message);
    }
  }

  private handleStepFailure(
    stepId: string,
    step: WorkflowStepRecord,
    error: string,
  ): boolean {
    const retries = step.retries + 1;

    if (retries < step.max_retries) {
      // Schedule retry with exponential backoff (capped at 5min)
      const stepDefs = this.getStepDefs(step.instance_id);
      const def = stepDefs[step.step_index];
      const baseBackoff = def?.backoffMs ?? 1000;
      const backoffMs = Math.min(baseBackoff * Math.pow(2, retries), MAX_BACKOFF_MS);
      const retryAt = new Date(Date.now() + backoffMs).toISOString();

      this.db.update('workflow_steps', stepId, {
        status: 'failed',
        error,
        retries,
        retry_at: retryAt,
      });
      return false;
    }

    // Max retries exceeded — permanent failure
    this.failStep(stepId, error);
    return false;
  }

  private failStep(stepId: string, error: string): void {
    this.db.update('workflow_steps', stepId, {
      status: 'failed',
      error,
      completed_at: new Date().toISOString(),
      retry_at: null,
    });
  }

  private getPreviousStepOutput(instanceId: string, currentIndex: number): unknown {
    if (currentIndex === 0) return null;

    const steps = this.db.query('workflow_steps')
      .filter(s => s.instance_id === instanceId && s.step_index === currentIndex - 1);

    if (steps.length === 0) return null;
    const prev = steps[0];
    return prev.output ? JSON.parse(prev.output as string) : null;
  }

  private evaluateCondition(
    condition: string,
    instance: Record<string, unknown>,
    _step: WorkflowStepRecord,
  ): boolean {
    try {
      const input = instance.input ? JSON.parse(instance.input as string) : {};
      // Simple condition evaluation — supports basic property access
      // e.g., "input.approved === true", "input.amount > 1000"
      const fn = new Function('input', `return Boolean(${condition})`);
      return fn(input);
    } catch {
      // If condition can't be evaluated, proceed (don't skip)
      return true;
    }
  }

  private getStepDefs(instanceId: string): Array<{ backoffMs?: number; timeoutMs?: number }> {
    const instance = this.db.queryOne('workflow_instances', instanceId);
    if (!instance) return [];
    try {
      return JSON.parse(instance.steps_json as string ?? '[]');
    } catch {
      return [];
    }
  }
}
