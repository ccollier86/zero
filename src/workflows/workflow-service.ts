/**
 * workflow-service.ts
 *
 * Part of: Workflows subsystem (service)
 *
 * Orchestrates workflow lifecycle: start, advance, sendEvent, cancel,
 * pause, resume, and polling for retries/timeouts. All writes go through
 * ReactiveDB for automatic WebSocket broadcast to connected clients.
 *
 * Dependencies:
 *   - ./types
 *   - ./workflow-registry
 *   - ./workflow-executor
 *   - ../sync/reactive-db (ReactiveDB)
 */

import type { ReactiveDB } from '../sync/reactive-db';
import type {
  StepDefinition,
  WorkflowDefinition,
  WorkflowInstanceRecord,
  WorkflowStepRecord,
} from './types';
import { WorkflowExecutor } from './workflow-executor';
import type { WorkflowRegistry } from './workflow-registry';

export class WorkflowService {
  private executor: WorkflowExecutor;

  constructor(
    private db: ReactiveDB,
    private registry: WorkflowRegistry,
  ) {
    this.executor = new WorkflowExecutor(db, registry);
  }

  // ─── Start ──────────────────────────────────────────

  /**
   * Start a new workflow instance. Creates instance + step rows
   * in a transaction, then immediately executes the first step.
   */
  async start(
    name: string,
    input?: unknown,
    startedBy?: string,
  ): Promise<string> {
    const definition = this.registry.getWorkflow(name);
    if (!definition) {
      throw new Error(`Workflow "${name}" not registered`);
    }

    const instanceId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Persist definition if not already stored
    this.ensureDefinitionPersisted(definition);

    // Create instance + steps atomically
    this.db.transaction(() => {
      this.db.insert('workflow_instances', {
        instance_id: instanceId,
        definition_id: this.getDefinitionId(definition.name),
        name: definition.name,
        status: 'running',
        current_step: 0,
        input: input !== undefined ? JSON.stringify(input) : null,
        output: null,
        error: null,
        started_by: startedBy ?? null,
        created_at: now,
        updated_at: now,
        completed_at: null,
        steps_json: JSON.stringify(definition.steps),
      });

      for (let i = 0; i < definition.steps.length; i++) {
        const step = definition.steps[i];
        this.db.insert('workflow_steps', {
          step_id: crypto.randomUUID(),
          instance_id: instanceId,
          step_index: i,
          step_name: step.handler,
          status: 'pending',
          input: null,
          output: null,
          error: null,
          retries: 0,
          max_retries: step.retries ?? 3,
          retry_at: null,
          wait_event: step.waitFor ?? null,
          timeout_at: null,
          started_at: null,
          completed_at: null,
          created_at: now,
        });
      }
    });

    // Execute first step (non-blocking — don't await in transaction)
    await this.advance(instanceId);

    return instanceId;
  }

  /** Canonical run alias for start(). */
  async run(
    name: string,
    input?: unknown,
    startedBy?: string,
  ): Promise<string> {
    return this.start(name, input, startedBy);
  }

  // ─── Advance ────────────────────────────────────────

  /**
   * Advance the workflow to the next pending step. Called after a step
   * completes or is skipped. Completes the workflow if all steps are done.
   */
  async advance(instanceId: string): Promise<void> {
    const instance = this.db.queryOne('workflow_instances', instanceId) as
      | (Record<string, unknown> & { status: string })
      | null;

    if (!instance || instance.status !== 'running') return;

    const steps = this.getSteps(instanceId);
    const nextStep = steps.find(
      s => s.status === 'pending' || s.status === 'waiting',
    );

    if (!nextStep) {
      // All steps completed/skipped — workflow is done
      const lastCompleted = steps
        .filter(s => s.status === 'completed')
        .sort((a, b) => b.step_index - a.step_index)[0];

      this.db.update('workflow_instances', instanceId, {
        status: 'completed',
        current_step: steps.length,
        output: lastCompleted?.output ?? null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return;
    }

    // Check if any step has permanently failed
    const failedStep = steps.find(
      s => s.status === 'failed' && !s.retry_at,
    );
    if (failedStep) {
      this.db.update('workflow_instances', instanceId, {
        status: 'failed',
        error: failedStep.error,
        current_step: failedStep.step_index,
        updated_at: new Date().toISOString(),
      });
      return;
    }

    // Execute next pending step
    if (nextStep.status === 'pending') {
      this.db.update('workflow_instances', instanceId, {
        current_step: nextStep.step_index,
        updated_at: new Date().toISOString(),
      });

      const completed = await this.executor.executeStep(instanceId, nextStep.step_id);
      if (completed) {
        // Step completed or skipped — advance to next
        await this.advance(instanceId);
      }
    }
    // If status is 'waiting', do nothing — sendEvent will resume
  }

  // ─── Events ─────────────────────────────────────────

  /**
   * Send an event to a workflow instance. If a step is waiting for
   * this event, it will be executed with the event payload.
   */
  async sendEvent(
    instanceId: string,
    eventName: string,
    payload?: unknown,
    sentBy?: string,
  ): Promise<boolean> {
    // Record the event
    this.db.insert('workflow_events', {
      event_id: crypto.randomUUID(),
      instance_id: instanceId,
      event_name: eventName,
      payload: payload !== undefined ? JSON.stringify(payload) : null,
      sent_by: sentBy ?? null,
      created_at: new Date().toISOString(),
    });

    // Find a waiting step that matches
    const steps = this.getSteps(instanceId);
    const waitingStep = steps.find(
      s => s.status === 'waiting' && s.wait_event === eventName,
    );

    if (!waitingStep) return false;

    const completed = await this.executor.executeStep(
      instanceId,
      waitingStep.step_id,
      { name: eventName, payload },
    );

    if (completed) {
      await this.advance(instanceId);
    }

    return true;
  }

  // ─── Lifecycle Control ──────────────────────────────

  cancel(instanceId: string): void {
    const instance = this.db.queryOne('workflow_instances', instanceId);
    if (!instance) throw new Error(`Instance ${instanceId} not found`);

    this.db.update('workflow_instances', instanceId, {
      status: 'cancelled',
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });
  }

  /** Canonical stop alias for cancel(). */
  stop(instanceId: string): void {
    this.cancel(instanceId);
  }

  pause(instanceId: string): void {
    const instance = this.db.queryOne('workflow_instances', instanceId);
    if (!instance) throw new Error(`Instance ${instanceId} not found`);
    if (instance.status !== 'running') {
      throw new Error(`Cannot pause workflow in status "${instance.status}"`);
    }

    this.db.update('workflow_instances', instanceId, {
      status: 'paused',
      updated_at: new Date().toISOString(),
    });
  }

  async resume(instanceId: string): Promise<void> {
    const instance = this.db.queryOne('workflow_instances', instanceId);
    if (!instance) throw new Error(`Instance ${instanceId} not found`);
    if (instance.status !== 'paused') {
      throw new Error(`Cannot resume workflow in status "${instance.status}"`);
    }

    this.db.update('workflow_instances', instanceId, {
      status: 'running',
      updated_at: new Date().toISOString(),
    });

    await this.advance(instanceId);
  }

  // ─── Polling ────────────────────────────────────────

  /**
   * Poll for failed steps with retry_at <= now. Re-execute them.
   * Called by the scheduler on a cron interval.
   */
  async pollRetries(): Promise<number> {
    const now = new Date().toISOString();
    const steps = this.db.query('workflow_steps')
      .filter(s =>
        s.status === 'failed' &&
        s.retry_at !== null &&
        (s.retry_at as string) <= now,
      ) as unknown as WorkflowStepRecord[];

    let count = 0;
    for (const step of steps) {
      // Check workflow is still running
      const instance = this.db.queryOne('workflow_instances', step.instance_id);
      if (!instance || instance.status !== 'running') continue;

      const completed = await this.executor.executeStep(step.instance_id, step.step_id);
      if (completed) {
        await this.advance(step.instance_id);
      }
      count++;
    }

    return count;
  }

  /**
   * Poll for steps that have exceeded their timeout. Mark them as failed.
   */
  pollTimeouts(): number {
    const now = new Date().toISOString();
    const steps = this.db.query('workflow_steps')
      .filter(s =>
        (s.status === 'running' || s.status === 'waiting') &&
        s.timeout_at !== null &&
        (s.timeout_at as string) <= now,
      ) as unknown as WorkflowStepRecord[];

    for (const step of steps) {
      this.db.update('workflow_steps', step.step_id, {
        status: 'failed',
        error: 'Step timed out',
        completed_at: now,
        retry_at: null,
      });

      // Fail the workflow
      this.db.update('workflow_instances', step.instance_id, {
        status: 'failed',
        error: `Step "${step.step_name}" timed out`,
        updated_at: now,
      });
    }

    return steps.length;
  }

  // ─── Crash Recovery ─────────────────────────────────

  /**
   * On startup, re-execute steps stuck in 'running' status
   * (indicates a crash during execution).
   */
  async recoverInFlight(): Promise<number> {
    const runningSteps = this.db.query('workflow_steps')
      .filter(s => s.status === 'running') as unknown as WorkflowStepRecord[];

    for (const step of runningSteps) {
      // Reset to pending and let advance() pick it up
      this.db.update('workflow_steps', step.step_id, {
        status: 'pending',
        started_at: null,
      });
    }

    // Re-advance all running workflows
    const runningInstances = this.db.query('workflow_instances')
      .filter(i => i.status === 'running') as unknown as Array<{ instance_id: string }>;

    for (const instance of runningInstances) {
      await this.advance(instance.instance_id);
    }

    return runningSteps.length;
  }

  // ─── Queries ────────────────────────────────────────

  getInstance(instanceId: string): Record<string, unknown> | null {
    return this.db.queryOne('workflow_instances', instanceId);
  }

  /** Canonical get alias for getInstance(). */
  get(instanceId: string): Record<string, unknown> | null {
    return this.getInstance(instanceId);
  }

  getSteps(instanceId: string): WorkflowStepRecord[] {
    return this.db.query('workflow_steps')
      .filter(s => s.instance_id === instanceId)
      .sort((a, b) => (a.step_index as number) - (b.step_index as number)) as unknown as WorkflowStepRecord[];
  }

  getEvents(instanceId: string): Record<string, unknown>[] {
    return this.db.query('workflow_events')
      .filter(e => e.instance_id === instanceId);
  }

  listInstances(filter?: {
    status?: string;
    name?: string;
    limit?: number;
  }): Record<string, unknown>[] {
    let results = this.db.query('workflow_instances');

    if (filter?.status) {
      results = results.filter(i => i.status === filter.status);
    }
    if (filter?.name) {
      results = results.filter(i => i.name === filter.name);
    }

    // Sort by created_at descending
    results.sort((a, b) =>
      (b.created_at as string).localeCompare(a.created_at as string),
    );

    if (filter?.limit) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  /** Canonical list alias for listInstances(). */
  list(filter?: Parameters<WorkflowService['listInstances']>[0]): Record<string, unknown>[] {
    return this.listInstances(filter);
  }

  // ─── Internal ───────────────────────────────────────

  private ensureDefinitionPersisted(definition: WorkflowDefinition): void {
    const existing = this.db.query('workflow_definitions')
      .find(d => d.name === definition.name);

    if (!existing) {
      this.db.insert('workflow_definitions', {
        definition_id: crypto.randomUUID(),
        name: definition.name,
        version: 1,
        steps_json: JSON.stringify(definition.steps),
        input_schema: definition.inputSchema ? JSON.stringify(definition.inputSchema) : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }

  private getDefinitionId(name: string): string {
    const def = this.db.query('workflow_definitions')
      .find(d => d.name === name);
    return (def?.definition_id as string) ?? name;
  }
}
