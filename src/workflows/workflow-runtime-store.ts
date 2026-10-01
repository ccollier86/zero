/**
 * Durable, internal coordination state for workflow execution.
 *
 * These underscore-prefixed tables never enter ReactiveDB Sync. They let the
 * public workflow tables retain their 1.3 shape while event claims and attempt
 * fences survive process restarts. Existing workflow_events rows deliberately
 * have no delivery row, so upgrading cannot replay historical audit events.
 */

import type { ReactiveDB } from '../sync/reactive-db';

export interface ClaimedWorkflowEvent {
  eventId: string;
  name: string;
  payload: unknown;
}

interface WorkflowEventRow {
  event_id: string;
  event_name: string;
  payload: string | null;
}

export class WorkflowRuntimeStore {
  constructor(private readonly db: ReactiveDB) {
    this.defineTables();
  }

  /** Ensure internal tables exist for both migrated and pre-migration apps. */
  defineTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _workflow_event_delivery (
        event_id TEXT PRIMARY KEY,
        instance_id TEXT NOT NULL,
        event_name TEXT NOT NULL,
        claimed_by_step_id TEXT UNIQUE,
        claimed_at TEXT,
        created_at TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_workflow_event_delivery_pending
      ON _workflow_event_delivery(instance_id, event_name, claimed_by_step_id, created_at, event_id)
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _workflow_step_attempts (
        step_id TEXT PRIMARY KEY,
        instance_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL UNIQUE,
        started_at TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_workflow_step_attempts_instance
      ON _workflow_step_attempts(instance_id)
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _workflow_pauses (
        instance_id TEXT PRIMARY KEY,
        paused_at TEXT NOT NULL
      )
    `);
  }

  recordDeliverableEvent(
    eventId: string,
    instanceId: string,
    eventName: string,
    createdAt: string,
  ): void {
    this.db.prepare(`
      INSERT INTO _workflow_event_delivery (
        event_id, instance_id, event_name, claimed_by_step_id, claimed_at, created_at
      ) VALUES (?, ?, ?, NULL, NULL, ?)
    `).run(eventId, instanceId, eventName, createdAt);
  }

  claimEvent(
    instanceId: string,
    stepId: string,
    eventName: string,
    claimedAt: string,
  ): ClaimedWorkflowEvent | null {
    const existing = this.claimedEvent(stepId);
    if (existing) return existing;

    const candidate = this.db.prepare(`
      SELECT e.event_id, e.event_name, e.payload
      FROM _workflow_event_delivery AS delivery
      INNER JOIN workflow_events AS e ON e.event_id = delivery.event_id
      WHERE delivery.instance_id = ?
        AND delivery.event_name = ?
        AND delivery.claimed_by_step_id IS NULL
      ORDER BY delivery.created_at ASC, delivery.rowid ASC
      LIMIT 1
    `).get(instanceId, eventName) as WorkflowEventRow | null;
    if (!candidate) return null;

    const result = this.db.prepare(`
      UPDATE _workflow_event_delivery
      SET claimed_by_step_id = ?, claimed_at = ?
      WHERE event_id = ? AND claimed_by_step_id IS NULL
    `).run(stepId, claimedAt, candidate.event_id);
    if (result.changes !== 1) return null;
    return deserializeEvent(candidate);
  }

  claimedEvent(stepId: string): ClaimedWorkflowEvent | null {
    const row = this.db.prepare(`
      SELECT e.event_id, e.event_name, e.payload
      FROM _workflow_event_delivery AS delivery
      INNER JOIN workflow_events AS e ON e.event_id = delivery.event_id
      WHERE delivery.claimed_by_step_id = ?
      LIMIT 1
    `).get(stepId) as WorkflowEventRow | null;
    return row ? deserializeEvent(row) : null;
  }

  isEventClaimed(eventId: string): boolean {
    const row = this.db.prepare(`
      SELECT claimed_by_step_id
      FROM _workflow_event_delivery
      WHERE event_id = ?
    `).get(eventId) as { claimed_by_step_id: string | null } | null;
    return Boolean(row?.claimed_by_step_id);
  }

  beginAttempt(
    stepId: string,
    instanceId: string,
    attemptId: string,
    startedAt: string,
  ): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO _workflow_step_attempts (
        step_id, instance_id, attempt_id, started_at
      ) VALUES (?, ?, ?, ?)
    `).run(stepId, instanceId, attemptId, startedAt);
  }

  isCurrentAttempt(stepId: string, attemptId: string): boolean {
    const row = this.db.prepare(`
      SELECT attempt_id FROM _workflow_step_attempts WHERE step_id = ?
    `).get(stepId) as { attempt_id: string } | null;
    return row?.attempt_id === attemptId;
  }

  finishAttempt(stepId: string, attemptId?: string): boolean {
    const result = attemptId
      ? this.db.prepare(`
          DELETE FROM _workflow_step_attempts WHERE step_id = ? AND attempt_id = ?
        `).run(stepId, attemptId)
      : this.db.prepare(`
          DELETE FROM _workflow_step_attempts WHERE step_id = ?
        `).run(stepId);
    return result.changes > 0;
  }

  finishInstanceAttempts(instanceId: string): void {
    this.db.prepare(`
      DELETE FROM _workflow_step_attempts WHERE instance_id = ?
    `).run(instanceId);
  }

  clearAllAttempts(): void {
    this.db.prepare('DELETE FROM _workflow_step_attempts').run();
  }

  markPaused(instanceId: string, pausedAt: string): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO _workflow_pauses (instance_id, paused_at)
      VALUES (?, ?)
    `).run(instanceId, pausedAt);
  }

  takePausedAt(instanceId: string): string | null {
    const row = this.db.prepare(`
      SELECT paused_at FROM _workflow_pauses WHERE instance_id = ?
    `).get(instanceId) as { paused_at: string } | null;
    this.db.prepare('DELETE FROM _workflow_pauses WHERE instance_id = ?').run(instanceId);
    return row?.paused_at ?? null;
  }

  clearPause(instanceId: string): void {
    this.db.prepare('DELETE FROM _workflow_pauses WHERE instance_id = ?').run(instanceId);
  }
}

function deserializeEvent(row: WorkflowEventRow): ClaimedWorkflowEvent {
  return {
    eventId: row.event_id,
    name: row.event_name,
    payload: row.payload === null ? undefined : JSON.parse(row.payload),
  };
}
