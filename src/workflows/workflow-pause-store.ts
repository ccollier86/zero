/**
 * workflow-pause-store.ts
 *
 * Owns durable pause timestamps used to shift retry and timeout deadlines on
 * resume. It does not decide whether a workflow may pause or resume.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import {
  workflowRuntimeTransaction,
  type WorkflowRuntimeFence,
} from './workflow-runtime-fence';

/** Persist, consume, and clear one workflow instance's pause timestamp. */
export class WorkflowPauseStore {
  constructor(
    private readonly db: ReactiveDB,
    private readonly runtimeFence: WorkflowRuntimeFence | null = null,
  ) {}

  mark(instanceId: string, pausedAt: string): void {
    workflowRuntimeTransaction(this.db, this.runtimeFence, () => {
      this.db.prepare(`
        INSERT OR REPLACE INTO _workflow_pauses (instance_id, paused_at)
        VALUES (?, ?)
      `).run(instanceId, pausedAt);
    });
  }

  take(instanceId: string): string | null {
    return workflowRuntimeTransaction(this.db, this.runtimeFence, () => {
      const row = this.db.prepare(`
        SELECT paused_at FROM _workflow_pauses WHERE instance_id = ?
      `).get(instanceId) as { paused_at: string } | null;
      this.db.prepare('DELETE FROM _workflow_pauses WHERE instance_id = ?').run(instanceId);
      return row?.paused_at ?? null;
    });
  }

  clear(instanceId: string): void {
    workflowRuntimeTransaction(this.db, this.runtimeFence, () => {
      this.db.prepare('DELETE FROM _workflow_pauses WHERE instance_id = ?').run(instanceId);
    });
  }
}
