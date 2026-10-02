/** Atomic terminal cleanup for durable workflow inbox and interaction state. */

import type { ReactiveDB } from '../sync/reactive-db';
import { WorkflowError } from './workflow-error';
import { WorkflowRuntimeValueBudget } from './workflow-runtime-budget';

interface ProcessingEventResponse {
  response_id: string;
  interaction_id: string;
  payload_bytes: number;
}

interface QueuedEventUsage {
  queued_count: number;
  queued_bytes: number;
  revision_delta: number;
}

interface PersistedEventUsage {
  total_count: number;
  total_bytes: number;
  queued_count: number;
  queued_bytes: number;
  revision: number;
}

/**
 * Marks every remaining delivery terminal without deleting public audit rows.
 * Processing responses, interaction projections, and capacity ledgers move in
 * the caller's ReactiveDB transaction so a crash cannot strand partial state.
 */
export class WorkflowTerminalEventQueue {
  private readonly runtimeBudget: WorkflowRuntimeValueBudget;

  constructor(private readonly db: ReactiveDB) {
    this.runtimeBudget = new WorkflowRuntimeValueBudget(db);
  }

  discardInstanceQueue(instanceId: string, terminalAt: string): void {
    this.db.transaction(() => {
      this.releaseProcessingEventResponses(instanceId, terminalAt);
      this.supersedeProcessingResponses(instanceId, terminalAt);
      this.cancelOpenInteractions(instanceId, terminalAt);

      const queued = this.queuedUsage(instanceId);
      const usage = this.persistedUsage(instanceId);
      const queueAccountingMatches = usage.queued_count === queued.queued_count
        && usage.queued_bytes === queued.queued_bytes;
      if (queued.queued_count === 0 && queueAccountingMatches) return;

      if (queued.queued_count > 0) {
        const discarded = this.db.prepare(`UPDATE _workflow_event_delivery
          SET claimed_by_step_id = CASE
              WHEN claimed_by_step_id IS NULL THEN 'discarded:' || event_id
              ELSE 'consumed:' || event_id
            END,
            claimed_at = COALESCE(claimed_at,
              CASE WHEN created_at > ? THEN created_at ELSE ? END)
          WHERE instance_id = ?
            AND (claimed_by_step_id IS NULL OR (
              claimed_by_step_id != ('consumed:' || event_id)
              AND claimed_by_step_id != ('discarded:' || event_id)
            ))`)
          .run(terminalAt, terminalAt, instanceId);
        if (discarded.changes !== queued.queued_count) throw invalidTerminalQueue();
      }

      // Active workflows fail strict integrity checks. A terminal transition
      // may repair only its queue ledger so pre-fix crash state cannot prevent
      // the run from becoming terminal forever.
      const adjusted = queueAccountingMatches
        ? this.db.prepare(`UPDATE _workflow_event_usage SET
            queued_count = 0,
            queued_bytes = 0,
            revision = revision + ?
            WHERE instance_id = ? AND total_count = ? AND total_bytes = ?
              AND queued_count = ? AND queued_bytes = ? AND revision = ?`)
          .run(
            queued.revision_delta,
            instanceId,
            usage.total_count,
            usage.total_bytes,
            usage.queued_count,
            usage.queued_bytes,
            usage.revision,
          )
        : this.repairTerminalUsage(instanceId, usage);
      if (adjusted.changes !== 1) throw invalidTerminalQueue();
    });
  }

  /** Repair terminal state left by runtimes predating atomic cleanup. */
  reconcileTerminalInstances(terminalAt: string): void {
    const rows = this.db.prepare(`SELECT instance_id FROM workflow_instances
      WHERE status IN ('completed','failed','cancelled') ORDER BY rowid ASC`)
      .all() as Array<{ instance_id: string }>;
    for (const row of rows) this.discardInstanceQueue(row.instance_id, terminalAt);
  }

  private cancelOpenInteractions(instanceId: string, terminalAt: string): void {
    const rows = this.db.prepare(`SELECT interaction_id FROM workflow_interactions
      WHERE instance_id = ? AND status = 'open'
      ORDER BY created_at ASC, rowid ASC`).all(instanceId) as Array<{
        interaction_id: string;
      }>;
    for (const row of rows) {
      this.db.update('workflow_interactions', row.interaction_id, {
        status: 'cancelled',
        updated_at: terminalAt,
      });
    }
  }

  private supersedeProcessingResponses(instanceId: string, terminalAt: string): void {
    this.db.prepare(`UPDATE _workflow_interaction_responses
      SET status = 'superseded', decided_at = ?
      WHERE status = 'processing'
        AND response_id IN (
          SELECT response.response_id
          FROM _workflow_interaction_responses AS response
          INNER JOIN workflow_interactions AS interaction
            ON interaction.interaction_id = response.interaction_id
          WHERE interaction.instance_id = ?
        )`).run(terminalAt, instanceId);
  }

  /**
   * Zero 1.3 predates explicit response-origin columns. An event response is
   * recognized only when its internal channel/submission identity matches an
   * event envelope belonging to the same workflow instance.
   */
  private releaseProcessingEventResponses(instanceId: string, terminalAt: string): void {
    const responses = this.db.prepare(`SELECT response.response_id,
      response.interaction_id,
      length(CAST(response.payload_json AS BLOB)) AS payload_bytes
      FROM _workflow_interaction_responses AS response
      INNER JOIN workflow_interactions AS interaction
        ON interaction.interaction_id = response.interaction_id
      INNER JOIN _workflow_event_delivery AS delivery
        ON response.submission_id = ('event:' || delivery.event_id)
        AND delivery.instance_id = interaction.instance_id
      WHERE interaction.instance_id = ?
        AND response.status = 'processing'
        AND response.channel = 'event'
      ORDER BY response.rowid ASC`).all(instanceId) as ProcessingEventResponse[];
    let releasedRuntimeBytes = 0;
    for (const response of responses) {
      const bytes = Number(response.payload_bytes);
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw invalidTerminalQueue();
      const detail = this.db.prepare(`UPDATE _workflow_interaction_details SET
        response_count = response_count - 1,
        response_bytes = response_bytes - ?,
        updated_at = ?
        WHERE interaction_id = ? AND response_count >= 1 AND response_bytes >= ?`)
        .run(bytes, terminalAt, response.interaction_id, bytes);
      if (detail.changes !== 1) throw invalidTerminalQueue();
      const removed = this.db.prepare(`DELETE FROM _workflow_interaction_responses
        WHERE response_id = ? AND status = 'processing'
          AND channel = 'event'`)
        .run(response.response_id);
      if (removed.changes !== 1) throw invalidTerminalQueue();
      releasedRuntimeBytes += bytes;
    }
    if (releasedRuntimeBytes > 0) {
      this.runtimeBudget.reserveInteractionBytes(instanceId, -releasedRuntimeBytes);
    }
  }

  private queuedUsage(instanceId: string): QueuedEventUsage {
    const row = this.db.prepare(`SELECT COUNT(*) AS queued_count,
      COALESCE(SUM(payload_bytes + actor_bytes), 0) AS queued_bytes,
      COALESCE(SUM(CASE WHEN claimed_by_step_id IS NULL THEN 2 ELSE 1 END), 0)
        AS revision_delta
      FROM _workflow_event_delivery
      WHERE instance_id = ?
        AND (claimed_by_step_id IS NULL OR (
          claimed_by_step_id != ('consumed:' || event_id)
          AND claimed_by_step_id != ('discarded:' || event_id)
        ))`)
      .get(instanceId) as QueuedEventUsage;
    return normalizeQueuedUsage(row);
  }

  private persistedUsage(instanceId: string): PersistedEventUsage {
    const row = this.db.prepare(`SELECT total_count, total_bytes,
      queued_count, queued_bytes, revision
      FROM _workflow_event_usage WHERE instance_id = ? LIMIT 1`)
      .get(instanceId) as PersistedEventUsage | null;
    if (!row) throw invalidTerminalQueue();
    return normalizePersistedUsage(row);
  }

  private repairTerminalUsage(
    instanceId: string,
    previous: PersistedEventUsage,
  ): { changes: number } {
    const actual = this.db.prepare(`SELECT COUNT(*) AS total_count,
      COALESCE(SUM(payload_bytes + actor_bytes), 0) AS total_bytes,
      COALESCE(SUM(CASE WHEN claimed_by_step_id IS NULL OR (
        claimed_by_step_id != ('consumed:' || event_id)
        AND claimed_by_step_id != ('discarded:' || event_id)
      ) THEN 1 ELSE 0 END), 0) AS queued_count,
      COALESCE(SUM(CASE WHEN claimed_by_step_id IS NULL OR (
        claimed_by_step_id != ('consumed:' || event_id)
        AND claimed_by_step_id != ('discarded:' || event_id)
      ) THEN payload_bytes + actor_bytes ELSE 0 END), 0) AS queued_bytes,
      COUNT(*)
        + COALESCE(SUM(CASE WHEN claimed_by_step_id IS NOT NULL THEN 1 ELSE 0 END), 0)
        + COALESCE(SUM(CASE
          WHEN claimed_by_step_id = ('consumed:' || event_id)
            OR claimed_by_step_id = ('discarded:' || event_id)
          THEN 1 ELSE 0 END), 0) AS revision
      FROM _workflow_event_delivery WHERE instance_id = ?`)
      .get(instanceId) as PersistedEventUsage;
    const normalized = normalizePersistedUsage(actual);
    if (Object.values(normalized).some((value) => !Number.isSafeInteger(value) || value < 0)
      || normalized.queued_count !== 0 || normalized.queued_bytes !== 0) {
      throw invalidTerminalQueue();
    }
    return this.db.prepare(`UPDATE _workflow_event_usage SET
      total_count = ?, total_bytes = ?, queued_count = ?, queued_bytes = ?, revision = ?
      WHERE instance_id = ? AND total_count = ? AND total_bytes = ?
        AND queued_count = ? AND queued_bytes = ? AND revision = ?`).run(
      normalized.total_count,
      normalized.total_bytes,
      normalized.queued_count,
      normalized.queued_bytes,
      normalized.revision,
      instanceId,
      previous.total_count,
      previous.total_bytes,
      previous.queued_count,
      previous.queued_bytes,
      previous.revision,
    );
  }
}

function normalizeQueuedUsage(row: QueuedEventUsage): QueuedEventUsage {
  return {
    queued_count: Number(row.queued_count),
    queued_bytes: Number(row.queued_bytes),
    revision_delta: Number(row.revision_delta),
  };
}

function normalizePersistedUsage(row: PersistedEventUsage): PersistedEventUsage {
  return {
    total_count: Number(row.total_count),
    total_bytes: Number(row.total_bytes),
    queued_count: Number(row.queued_count),
    queued_bytes: Number(row.queued_bytes),
    revision: Number(row.revision),
  };
}

function invalidTerminalQueue(): WorkflowError {
  return new WorkflowError(
    'Workflow terminal event queue accounting is inconsistent',
    'WORKFLOW_STATE_INVALID',
    500,
  );
}
