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
import { WorkflowTerminalEventQueue } from './workflow-terminal-event-queue';
import {
  createUnmanagedWorkflowRuntimeFence,
  workflowRuntimeTransaction,
  type WorkflowRuntimeFence,
} from './workflow-runtime-fence';

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

const runtimeDatabases = new WeakMap<WorkflowRuntimeStore, ReactiveDB>();

export class WorkflowRuntimeStore {
  private readonly eventCapacity: WorkflowEventCapacityStore;
  private readonly runtimeFence: WorkflowRuntimeFence;
  private readonly terminalQueue: WorkflowTerminalEventQueue;

  constructor(
    private readonly db: ReactiveDB,
    runtimeFence: WorkflowRuntimeFence | null = null,
    now: () => Date = () => new Date(),
  ) {
    runtimeDatabases.set(this, db);
    this.runtimeFence = runtimeFence ?? createUnmanagedWorkflowRuntimeFence(db);
    this.defineTables();
    this.eventCapacity = new WorkflowEventCapacityStore(db);
    this.terminalQueue = new WorkflowTerminalEventQueue(db);
    this.transaction(() => this.terminalQueue.reconcileTerminalInstances(now().toISOString()));
  }

  /** Build stores closed over one exact managed owner generation. */
  static createOwnerFenced(
    db: ReactiveDB,
    runtimeFence: WorkflowRuntimeFence,
    template?: WorkflowRuntimeStore,
    now: () => Date = () => new Date(),
  ): WorkflowRuntimeStore {
    if (template && runtimeDatabases.get(template) !== db) {
      throw new WorkflowError(
        'Injected workflow runtime must use the WorkflowService database',
        'WORKFLOW_CONFIG_INVALID',
        500,
      );
    }
    return new WorkflowRuntimeStore(db, runtimeFence, now);
  }

  /** Ensure internal tables exist for both migrated and pre-migration apps. */
  defineTables(): void {
    this.transaction(() => ensureWorkflowRuntimeSchema(this.db));
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
    this.transaction(() => {
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
    const claim = this.transaction<
      | { ok: true; event: ClaimedWorkflowEvent | null }
      | { ok: false; error: unknown }
    >(() => {
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
      if (!candidate) return { ok: true, event: null };

      // Decode before mutating delivery/accounting state. A caller may catch
      // this error inside a wider workflow transaction to persist a terminal
      // failure, so throwing from a nested transaction after claiming would
      // otherwise leave a poisoned or partially claimed envelope.
      let event: ClaimedWorkflowEvent;
      try {
        event = deserializeEvent(candidate);
      } catch (error) {
        return { ok: false, error };
      }

      const result = this.db.prepare(`
        UPDATE _workflow_event_delivery
        SET claimed_by_step_id = ?, claimed_at = ?
        WHERE event_id = ? AND claimed_by_step_id IS NULL
      `).run(stepId, claimedAt, candidate.event_id);
      if (result.changes !== 1) return { ok: true, event: null };
      this.eventCapacity.markClaimed(instanceId);
      return { ok: true, event };
    });
    if (!claim.ok) throw claim.error;
    return claim.event;
  }

  claimedEvent(stepId: string): ClaimedWorkflowEvent | null {
    this.assertCurrent();
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
    this.assertCurrent();
    const row = this.db.prepare(`
      SELECT claimed_by_step_id
      FROM _workflow_event_delivery
      WHERE event_id = ?
    `).get(eventId) as { claimed_by_step_id: string | null } | null;
    return Boolean(row?.claimed_by_step_id
      && !row.claimed_by_step_id.startsWith('discarded:'));
  }

  /** Consume one interaction-event claim after its idempotent submission is durable. */
  consumeClaimedEvent(stepId: string, eventId: string): boolean {
    return this.transaction(() => {
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

  /**
   * Recover or finish the event half of an accepted interaction response.
   * This is called inside the wait-completion transaction so a crash can
   * leave neither an unconsumed accepted event nor a completed wait without
   * its exact event-accounting transition.
   */
  consumeAcceptedInteractionEvent(
    stepId: string,
    instanceId: string,
    eventId: string,
  ): void {
    this.transaction(() => {
      const row = this.db.prepare(`
        SELECT delivery.instance_id, delivery.event_name,
          delivery.claimed_by_step_id, delivery.claimed_at,
          delivery.payload_bytes, delivery.actor_bytes,
          event.instance_id AS event_instance_id,
          event.event_name AS event_event_name,
          step.instance_id AS step_instance_id,
          step.wait_event AS step_wait_event,
          step.status AS step_status
        FROM _workflow_event_delivery AS delivery
        INNER JOIN workflow_events AS event
          ON event.event_id = delivery.event_id
          AND event.instance_id = delivery.instance_id
          AND event.event_name = delivery.event_name
        INNER JOIN workflow_steps AS step ON step.step_id = ?
        WHERE delivery.event_id = ?
        LIMIT 1
      `).get(stepId, eventId) as {
        instance_id: string;
        event_name: string;
        claimed_by_step_id: string | null;
        claimed_at: string | null;
        payload_bytes: number;
        actor_bytes: number;
        event_instance_id: string;
        event_event_name: string;
        step_instance_id: string;
        step_wait_event: string | null;
        step_status: string;
      } | null;
      const payloadBytes = Number(row?.payload_bytes);
      const actorBytes = Number(row?.actor_bytes);
      if (!row
        || row.instance_id !== instanceId
        || row.event_instance_id !== instanceId
        || row.event_event_name !== row.event_name
        || row.step_instance_id !== instanceId
        || (row.step_wait_event !== null && row.step_wait_event !== row.event_name)
        || row.step_status !== 'waiting'
        || row.claimed_at === null
        || !Number.isSafeInteger(payloadBytes)
        || payloadBytes < 0
        || !Number.isSafeInteger(actorBytes)
        || actorBytes < 0) {
        throw invalidEventDelivery();
      }
      if (row.claimed_by_step_id === `consumed:${eventId}`) return;
      if (row.claimed_by_step_id !== stepId) throw invalidEventDelivery();
      const result = this.db.prepare(`UPDATE _workflow_event_delivery
        SET claimed_by_step_id = ?
        WHERE event_id = ? AND instance_id = ? AND claimed_by_step_id = ?`)
        .run(`consumed:${eventId}`, eventId, instanceId, stepId);
      if (result.changes !== 1) throw invalidEventDelivery();
      this.eventCapacity.markConsumed(
        instanceId,
        payloadBytes + actorBytes,
      );
    });
  }

  /** Read the authenticated actor identifier attached to one event, if any. */
  getEventSender(eventId: string): string | null {
    this.assertCurrent();
    const row = this.db.prepare(`
      SELECT sent_by FROM workflow_events WHERE event_id = ? LIMIT 1
    `).get(eventId) as { sent_by: string | null } | null;
    return row?.sent_by ?? null;
  }

  isInstanceRunning(instanceId: string): boolean {
    this.assertCurrent();
    const row = this.db.prepare(`
      SELECT status FROM workflow_instances WHERE instance_id = ? LIMIT 1
    `).get(instanceId) as { status: string } | null;
    return row?.status === 'running';
  }

  /** Include private delivery progress in the graph pump's lost-wakeup fence. */
  eventDeliverySignature(instanceId: string): string {
    this.assertCurrent();
    return this.eventCapacity.signature(instanceId);
  }

  /** Recovery-only integrity check for O(1) event-capacity accounting. */
  validateEventUsage(instanceId: string): void {
    this.assertCurrent();
    this.eventCapacity.validate(instanceId);
  }

  /** Recovery-only graph audit/private envelope integrity check. */
  validateGraphEventState(instanceId: string): void {
    this.assertCurrent();
    validateWorkflowGraphEventState(this.db, instanceId);
  }

  /** Atomically make every remaining inbox and interaction row terminal. */
  discardInstanceQueue(instanceId: string, terminalAt: string): void {
    this.transaction(() => this.terminalQueue.discardInstanceQueue(instanceId, terminalAt));
  }

  beginAttempt(
    stepId: string,
    instanceId: string,
    attemptId: string,
    startedAt: string,
  ): void {
    this.transaction(() => {
      this.db.prepare(`
        INSERT OR REPLACE INTO _workflow_step_attempts (
          step_id, instance_id, attempt_id, started_at
        ) VALUES (?, ?, ?, ?)
      `).run(stepId, instanceId, attemptId, startedAt);
    });
  }

  isCurrentAttempt(stepId: string, attemptId: string): boolean {
    this.assertCurrent();
    const row = this.db.prepare(`
      SELECT attempt_id FROM _workflow_step_attempts WHERE step_id = ?
    `).get(stepId) as { attempt_id: string } | null;
    return row?.attempt_id === attemptId;
  }

  finishAttempt(stepId: string, attemptId?: string): boolean {
    return this.transaction(() => {
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

  finishInstanceAttempts(instanceId: string): void {
    this.transaction(() => {
      this.db.prepare(`
        DELETE FROM _workflow_step_attempts WHERE instance_id = ?
      `).run(instanceId);
    });
  }

  clearAllAttempts(): void {
    this.transaction(() => {
      this.db.prepare('DELETE FROM _workflow_step_attempts').run();
    });
  }

  markPaused(instanceId: string, pausedAt: string): void {
    this.transaction(() => {
      this.db.prepare(`
        INSERT OR REPLACE INTO _workflow_pauses (instance_id, paused_at)
        VALUES (?, ?)
      `).run(instanceId, pausedAt);
    });
  }

  takePausedAt(instanceId: string): string | null {
    return this.transaction(() => {
      const row = this.db.prepare(`
        SELECT paused_at FROM _workflow_pauses WHERE instance_id = ?
      `).get(instanceId) as { paused_at: string } | null;
      this.db.prepare('DELETE FROM _workflow_pauses WHERE instance_id = ?').run(instanceId);
      return row?.paused_at ?? null;
    });
  }

  clearPause(instanceId: string): void {
    this.transaction(() => {
      this.db.prepare('DELETE FROM _workflow_pauses WHERE instance_id = ?').run(instanceId);
    });
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

  private assertCurrent(): void {
    this.runtimeFence.assertCurrent();
  }

  private transaction<T>(operation: () => T): T {
    return workflowRuntimeTransaction(this.db, this.runtimeFence, operation);
  }

}

/** @internal Validate low-level collaborator composition without exposing its database. */
export function workflowRuntimeStoreUsesDatabase(
  runtime: WorkflowRuntimeStore,
  db: ReactiveDB,
): boolean {
  return runtimeDatabases.get(runtime) === db;
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
