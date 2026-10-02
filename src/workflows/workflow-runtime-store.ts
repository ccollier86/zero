/**
 * Durable, internal coordination state for workflow execution.
 *
 * These underscore-prefixed tables never enter ReactiveDB Sync. They let the
 * public workflow tables retain their 1.3 shape while event claims and attempt
 * fences survive process restarts. Existing workflow_events rows deliberately
 * have no delivery row, so upgrading cannot replay historical audit events.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import {
  MAX_WORKFLOW_EVENT_NAME_LENGTH,
  WorkflowEventCapacityStore,
} from './workflow-event-capacity-store';
import { validateWorkflowGraphEventState } from './workflow-event-persisted-state';
import type { WorkflowInteractionActor } from './workflow-interaction-authority';
import { WorkflowError } from './workflow-error';
import { parseWorkflowEventActor } from './workflow-event-actor';
import { ensureWorkflowRuntimeSchema } from './workflow-runtime-schema';

export {
  MAX_WORKFLOW_EVENT_NAME_LENGTH,
  MAX_WORKFLOW_EVENT_QUEUE_BYTES,
  MAX_WORKFLOW_EVENT_QUEUE_SIZE,
  MAX_WORKFLOW_EVENT_TOTAL_BYTES,
  MAX_WORKFLOW_EVENT_TOTAL_COUNT,
} from './workflow-event-capacity-store';

export interface ClaimedWorkflowEvent {
  eventId: string;
  name: string;
  payload: unknown;
  actor: WorkflowInteractionActor | null;
}

interface WorkflowEventRow {
  event_id: string;
  event_name: string;
  payload: string | null;
  actor_json: string | null;
}

export class WorkflowRuntimeStore {
  private readonly eventCapacity: WorkflowEventCapacityStore;

  constructor(private readonly db: ReactiveDB) {
    this.defineTables();
    this.eventCapacity = new WorkflowEventCapacityStore(db);
  }

  /** Ensure internal tables exist for both migrated and pre-migration apps. */
  defineTables(): void {
    ensureWorkflowRuntimeSchema(this.db);
  }

  recordDeliverableEvent(
    eventId: string,
    instanceId: string,
    eventName: string,
    createdAt: string,
    actorJson: string | null = null,
    payloadBytes = 0,
    actorBytes = 0,
  ): void {
    if (!eventName || eventName.length > MAX_WORKFLOW_EVENT_NAME_LENGTH) {
      throw new WorkflowError(
        `Event name must be 1-${MAX_WORKFLOW_EVENT_NAME_LENGTH} characters`,
        'WORKFLOW_EVENT_INVALID',
        422,
      );
    }
    if (!Number.isSafeInteger(payloadBytes) || payloadBytes < 0
      || !Number.isSafeInteger(actorBytes) || actorBytes < 0) {
      throw new WorkflowError('Workflow event byte accounting is invalid', 'WORKFLOW_STATE_INVALID', 500);
    }
    const nextBytes = payloadBytes + actorBytes;
    this.db.transaction(() => {
      this.eventCapacity.reserve(instanceId, nextBytes);
      this.db.prepare(`
        INSERT INTO _workflow_event_delivery (
          event_id, instance_id, event_name, claimed_by_step_id, claimed_at,
          actor_json, payload_bytes, actor_bytes, created_at
        ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?)
      `).run(eventId, instanceId, eventName, actorJson, payloadBytes, actorBytes, createdAt);
    });
  }

  claimEvent(
    instanceId: string,
    stepId: string,
    eventName: string,
    claimedAt: string,
  ): ClaimedWorkflowEvent | null {
    const existing = this.claimedEvent(stepId);
    if (existing) return existing;

    this.assertPendingEventIdentity(instanceId, eventName);
    return this.db.transaction(() => {
      const candidate = this.db.prepare(`
        SELECT e.event_id, e.event_name, e.payload, delivery.actor_json
        FROM _workflow_event_delivery AS delivery
        INNER JOIN workflow_events AS e ON e.event_id = delivery.event_id
          AND e.instance_id = delivery.instance_id
          AND e.event_name = delivery.event_name
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
      this.eventCapacity.markClaimed(instanceId);
      return deserializeEvent(candidate);
    });
  }

  claimedEvent(stepId: string): ClaimedWorkflowEvent | null {
    const row = this.db.prepare(`
      SELECT e.event_id, e.event_name, e.payload, delivery.actor_json
      FROM _workflow_event_delivery AS delivery
      INNER JOIN workflow_events AS e ON e.event_id = delivery.event_id
        AND e.instance_id = delivery.instance_id
        AND e.event_name = delivery.event_name
      INNER JOIN workflow_steps AS step
        ON step.step_id = delivery.claimed_by_step_id
        AND step.instance_id = delivery.instance_id
        AND (step.wait_event IS NULL OR step.wait_event = delivery.event_name)
      WHERE delivery.claimed_by_step_id = ?
      LIMIT 1
    `).get(stepId) as WorkflowEventRow | null;
    if (row) return deserializeEvent(row);
    const delivery = this.db.prepare(`
      SELECT event_id FROM _workflow_event_delivery
      WHERE claimed_by_step_id = ? LIMIT 1
    `).get(stepId) as { event_id: string } | null;
    if (delivery) throw invalidEventDelivery();
    return null;
  }

  isEventClaimed(eventId: string): boolean {
    const row = this.db.prepare(`
      SELECT claimed_by_step_id
      FROM _workflow_event_delivery
      WHERE event_id = ?
    `).get(eventId) as { claimed_by_step_id: string | null } | null;
    return Boolean(row?.claimed_by_step_id);
  }

  /** Consume one interaction-event claim after its idempotent submission is durable. */
  consumeClaimedEvent(stepId: string, eventId: string): boolean {
    return this.db.transaction(() => {
      const row = this.db.prepare(`SELECT instance_id, payload_bytes, actor_bytes
        FROM _workflow_event_delivery
        WHERE event_id = ? AND claimed_by_step_id = ? LIMIT 1`)
        .get(eventId, stepId) as {
          instance_id: string; payload_bytes: number; actor_bytes: number;
        } | null;
      if (!row) return false;
      const bytes = Number(row.payload_bytes) + Number(row.actor_bytes);
      const result = this.db.prepare(`UPDATE _workflow_event_delivery
        SET claimed_by_step_id = ?
        WHERE event_id = ? AND claimed_by_step_id = ?`)
        .run(`consumed:${eventId}`, eventId, stepId);
      if (result.changes !== 1) return false;
      this.eventCapacity.markConsumed(row.instance_id, bytes);
      return true;
    });
  }

  /** Read the authenticated actor identifier attached to one event, if any. */
  getEventSender(eventId: string): string | null {
    const row = this.db.prepare(`
      SELECT sent_by FROM workflow_events WHERE event_id = ? LIMIT 1
    `).get(eventId) as { sent_by: string | null } | null;
    return row?.sent_by ?? null;
  }

  isInstanceRunning(instanceId: string): boolean {
    const row = this.db.prepare(`
      SELECT status FROM workflow_instances WHERE instance_id = ? LIMIT 1
    `).get(instanceId) as { status: string } | null;
    return row?.status === 'running';
  }

  /** Include private delivery progress in the graph pump's lost-wakeup fence. */
  eventDeliverySignature(instanceId: string): string {
    return this.eventCapacity.signature(instanceId);
  }

  /** Recovery-only integrity check for O(1) event-capacity accounting. */
  validateEventUsage(instanceId: string): void {
    this.eventCapacity.validate(instanceId);
  }

  /** Recovery-only graph audit/private envelope integrity check. */
  validateGraphEventState(instanceId: string): void {
    validateWorkflowGraphEventState(this.db, instanceId);
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

  private assertPendingEventIdentity(instanceId: string, eventName: string): void {
    const corrupt = this.db.prepare(`
      SELECT delivery.event_id
      FROM _workflow_event_delivery AS delivery
      LEFT JOIN workflow_events AS event
        ON event.event_id = delivery.event_id
        AND event.instance_id = delivery.instance_id
        AND event.event_name = delivery.event_name
      WHERE delivery.instance_id = ? AND delivery.event_name = ?
        AND delivery.claimed_by_step_id IS NULL
        AND event.event_id IS NULL
      LIMIT 1
    `).get(instanceId, eventName) as { event_id: string } | null;
    if (corrupt) throw invalidEventDelivery();
  }

}

function invalidEventDelivery(): WorkflowError {
  return new WorkflowError(
    'Workflow event delivery identity is invalid',
    'WORKFLOW_STATE_INVALID',
    500,
  );
}

function deserializeEvent(row: WorkflowEventRow): ClaimedWorkflowEvent {
  return {
    eventId: row.event_id,
    name: row.event_name,
    payload: row.payload === null ? undefined : JSON.parse(row.payload),
    actor: parseWorkflowEventActor(row.actor_json),
  };
}
