/**
 * workflow-event-capacity-store.ts
 *
 * Owns constant-time, transactional capacity accounting for durable workflow
 * event delivery. It does not persist event payloads or execute wait nodes.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import { WorkflowError } from './workflow-error';

export const MAX_WORKFLOW_EVENT_QUEUE_SIZE = 1_000;
export const MAX_WORKFLOW_EVENT_QUEUE_BYTES = 16 * 1024 * 1024;
export const MAX_WORKFLOW_EVENT_TOTAL_COUNT = 10_000;
export const MAX_WORKFLOW_EVENT_TOTAL_BYTES = 64 * 1024 * 1024;
export const MAX_WORKFLOW_EVENT_NAME_LENGTH = 200;

interface WorkflowEventUsage {
  total_count: number;
  total_bytes: number;
  queued_count: number;
  queued_bytes: number;
  revision: number;
}

/** Accounting collaborator used inside the runtime store's write transactions. */
export class WorkflowEventCapacityStore {
  constructor(private readonly db: ReactiveDB) {}

  /** Create the zero counter in the same transaction as a new workflow run. */
  initializeInstance(instanceId: string): void {
    const usage = this.find(instanceId);
    if (usage) return;
    const existingInstance = this.db.prepare(`SELECT 1 AS present FROM workflow_instances
      WHERE instance_id = ? LIMIT 1`).get(instanceId) as { present: number } | null;
    if (existingInstance) throw invalidEventUsage();
    this.db.prepare(`INSERT INTO _workflow_event_usage (
      instance_id, total_count, total_bytes, queued_count, queued_bytes, revision
    ) VALUES (?, 0, 0, 0, 0, 0)`).run(instanceId);
  }

  reserve(instanceId: string, bytes: number): void {
    const usage = this.require(instanceId);
    if (usage.queued_count >= MAX_WORKFLOW_EVENT_QUEUE_SIZE
      || usage.queued_bytes + bytes > MAX_WORKFLOW_EVENT_QUEUE_BYTES) {
      throw new WorkflowError(
        'Workflow event queue capacity was reached for this instance',
        'WORKFLOW_EVENT_QUEUE_FULL',
        429,
        true,
      );
    }
    if (usage.total_count >= MAX_WORKFLOW_EVENT_TOTAL_COUNT
      || usage.total_bytes + bytes > MAX_WORKFLOW_EVENT_TOTAL_BYTES) {
      throw new WorkflowError(
        'Workflow event retention capacity was reached for this instance',
        'WORKFLOW_EVENT_LIMIT_EXCEEDED',
        409,
      );
    }
    const updated = this.db.prepare(`UPDATE _workflow_event_usage SET
      total_count = total_count + 1,
      total_bytes = total_bytes + ?,
      queued_count = queued_count + 1,
      queued_bytes = queued_bytes + ?,
      revision = revision + 1
      WHERE instance_id = ? AND total_count = ? AND total_bytes = ?
        AND queued_count = ? AND queued_bytes = ? AND revision = ?`).run(
      bytes,
      bytes,
      instanceId,
      usage.total_count,
      usage.total_bytes,
      usage.queued_count,
      usage.queued_bytes,
      usage.revision,
    );
    if (updated.changes !== 1) throw invalidEventUsage();
  }

  markClaimed(instanceId: string): void {
    const usage = this.require(instanceId);
    const updated = this.db.prepare(`UPDATE _workflow_event_usage
      SET revision = revision + 1
      WHERE instance_id = ? AND revision = ?`).run(instanceId, usage.revision);
    if (updated.changes !== 1) throw invalidEventUsage();
  }

  markConsumed(instanceId: string, bytes: number): void {
    const usage = this.require(instanceId);
    if (usage.queued_count < 1 || usage.queued_bytes < bytes) throw invalidEventUsage();
    const updated = this.db.prepare(`UPDATE _workflow_event_usage SET
      queued_count = queued_count - 1,
      queued_bytes = queued_bytes - ?,
      revision = revision + 1
      WHERE instance_id = ? AND queued_count = ? AND queued_bytes = ? AND revision = ?`)
      .run(bytes, instanceId, usage.queued_count, usage.queued_bytes, usage.revision);
    if (updated.changes !== 1) throw invalidEventUsage();
  }

  signature(instanceId: string): string {
    return String(this.require(instanceId).revision);
  }

  /** Recovery-only full scan that detects deleted or corrupted counter rows. */
  validate(instanceId: string): void {
    const accounted = this.require(instanceId);
    const actual = normalizeEventUsage(this.calculate(instanceId));
    if (accounted.total_count !== actual.total_count
      || accounted.total_bytes !== actual.total_bytes
      || accounted.queued_count !== actual.queued_count
      || accounted.queued_bytes !== actual.queued_bytes
      || accounted.revision !== actual.revision
      || actual.total_count > MAX_WORKFLOW_EVENT_TOTAL_COUNT
      || actual.total_bytes > MAX_WORKFLOW_EVENT_TOTAL_BYTES
      || actual.queued_count > MAX_WORKFLOW_EVENT_QUEUE_SIZE
      || actual.queued_bytes > MAX_WORKFLOW_EVENT_QUEUE_BYTES) {
      throw invalidEventUsage();
    }
  }

  private require(instanceId: string): WorkflowEventUsage {
    const row = this.find(instanceId);
    if (row) return normalizeEventUsage(row);
    throw invalidEventUsage();
  }

  private find(instanceId: string): WorkflowEventUsage | null {
    return this.db.prepare(`SELECT * FROM _workflow_event_usage
      WHERE instance_id = ? LIMIT 1`).get(instanceId) as WorkflowEventUsage | null;
  }

  private calculate(instanceId: string): WorkflowEventUsage {
    return this.db.prepare(`SELECT COUNT(*) AS total_count,
      COALESCE(SUM(payload_bytes + actor_bytes), 0) AS total_bytes,
      COALESCE(SUM(CASE WHEN claimed_by_step_id IS NULL
        OR (claimed_by_step_id NOT LIKE 'consumed:%'
          AND claimed_by_step_id NOT LIKE 'discarded:%')
        THEN 1 ELSE 0 END), 0) AS queued_count,
      COALESCE(SUM(CASE WHEN claimed_by_step_id IS NULL
        OR (claimed_by_step_id NOT LIKE 'consumed:%'
          AND claimed_by_step_id NOT LIKE 'discarded:%')
        THEN payload_bytes + actor_bytes ELSE 0 END), 0) AS queued_bytes,
      COUNT(*)
        + COALESCE(SUM(CASE WHEN claimed_by_step_id IS NOT NULL THEN 1 ELSE 0 END), 0)
        + COALESCE(SUM(CASE WHEN claimed_by_step_id LIKE 'consumed:%'
          OR claimed_by_step_id LIKE 'discarded:%' THEN 1 ELSE 0 END), 0)
        AS revision
      FROM _workflow_event_delivery WHERE instance_id = ?`)
      .get(instanceId) as WorkflowEventUsage;
  }
}

function normalizeEventUsage(row: WorkflowEventUsage): WorkflowEventUsage {
  return {
    total_count: Number(row.total_count),
    total_bytes: Number(row.total_bytes),
    queued_count: Number(row.queued_count),
    queued_bytes: Number(row.queued_bytes),
    revision: Number(row.revision),
  };
}

function invalidEventUsage(): WorkflowError {
  return new WorkflowError(
    'Workflow event capacity accounting is inconsistent',
    'WORKFLOW_STATE_INVALID',
    500,
  );
}
