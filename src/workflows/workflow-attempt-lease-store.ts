/**
 * workflow-attempt-lease-store.ts
 *
 * Owns the durable physical-attempt lease rows used to reject stale handler
 * completions. It does not execute handlers or transition workflow state.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import {
  workflowRuntimeTransaction,
  type WorkflowRuntimeFence,
} from './workflow-runtime-fence';

/** Persist and retire the current physical attempt for workflow steps. */
export class WorkflowAttemptLeaseStore {
  constructor(
    private readonly db: ReactiveDB,
    private readonly runtimeFence: WorkflowRuntimeFence | null = null,
  ) {}

  begin(stepId: string, instanceId: string, attemptId: string, startedAt: string): void {
    workflowRuntimeTransaction(this.db, this.runtimeFence, () => {
      this.db.prepare(`
        INSERT OR REPLACE INTO _workflow_step_attempts (
          step_id, instance_id, attempt_id, started_at
        ) VALUES (?, ?, ?, ?)
      `).run(stepId, instanceId, attemptId, startedAt);
    });
  }

  isCurrent(stepId: string, attemptId: string): boolean {
    this.runtimeFence?.assertCurrent();
    const row = this.db.prepare(`
      SELECT attempt_id FROM _workflow_step_attempts WHERE step_id = ?
    `).get(stepId) as { attempt_id: string } | null;
    return row?.attempt_id === attemptId;
  }

  finish(stepId: string, attemptId?: string): boolean {
    return workflowRuntimeTransaction(this.db, this.runtimeFence, () => {
      const result = attemptId
        ? this.db.prepare(`
            DELETE FROM _workflow_step_attempts WHERE step_id = ? AND attempt_id = ?
          `).run(stepId, attemptId)
        : this.db.prepare(`
            DELETE FROM _workflow_step_attempts WHERE step_id = ?
          `).run(stepId);
      return result.changes > 0;
    });
  }

  finishInstance(instanceId: string): void {
    workflowRuntimeTransaction(this.db, this.runtimeFence, () => {
      this.db.prepare(`
        DELETE FROM _workflow_step_attempts WHERE instance_id = ?
      `).run(instanceId);
    });
  }

  clear(): void {
    workflowRuntimeTransaction(this.db, this.runtimeFence, () => {
      this.db.prepare('DELETE FROM _workflow_step_attempts').run();
    });
  }
}
