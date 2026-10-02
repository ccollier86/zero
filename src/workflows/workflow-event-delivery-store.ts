/**
 * workflow-event-delivery-store.ts
 *
 * Owns durable workflow event inbox delivery, claims, authority envelopes,
 * capacity accounting, terminal cleanup, and recovery validation. It consumes
 * ReactiveDB persistence but does not manage step-attempt or pause records.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import {
  MAX_WORKFLOW_EVENT_NAME_LENGTH,
  WorkflowEventCapacityStore,
} from './workflow-event-capacity-store';
import {
  validateWorkflowGraphEventState,
  validateWorkflowLegacyEventState,
} from './workflow-event-persisted-state';
import type { WorkflowInteractionActor } from './workflow-interaction-authority';
import { WorkflowError } from './workflow-error';
import { parseWorkflowEventActor } from './workflow-event-actor';
import { WorkflowEventAuthorityStore } from './workflow-event-authority-store';
import {
  type WorkflowExecutionAuthorityStore,
  type WorkflowPersistedExecutionAuthority,
} from './workflow-execution-authority';
import { WorkflowTerminalEventQueue } from './workflow-terminal-event-queue';
import {
  workflowRuntimeTransaction,
  type WorkflowRuntimeFence,
} from './workflow-runtime-fence';

/** Trusted event value claimed by one durable workflow step. */
export interface ClaimedWorkflowEvent {
  eventId: string;
  name: string;
  payload: unknown;
  actor: WorkflowInteractionActor | null;
  /** Exact request authority sealed when the event entered the inbox. */
  authority: WorkflowPersistedExecutionAuthority | null;
  authorityKind: 'legacy-untrusted' | 'actor' | 'system';
  /** A durable authority row existed but failed its MAC/identity checks. */
  authorityInvalid: boolean;
}

interface WorkflowEventRow {
  event_id: string;
  tenant_id: string | null;
  instance_id: string;
  event_name: string;
  payload: string | null;
  sent_by: string | null;
  created_at: string;
  actor_json: string | null;
  authority_kind: 'legacy-untrusted' | 'actor' | 'system';
}

/** Persist and validate the private event delivery queue for workflow runs. */
export class WorkflowEventDeliveryStore {
  private readonly capacity: WorkflowEventCapacityStore;
  private readonly authorities: WorkflowEventAuthorityStore;
  private readonly terminal: WorkflowTerminalEventQueue;

  constructor(
    private readonly db: ReactiveDB,
    authorityStore: WorkflowExecutionAuthorityStore,
    now: () => Date,
    private readonly runtimeFence: WorkflowRuntimeFence | null = null,
  ) {
    this.capacity = new WorkflowEventCapacityStore(db);
    this.authorities = new WorkflowEventAuthorityStore(db, authorityStore);
    this.terminal = new WorkflowTerminalEventQueue(db);
    this.transaction(() => this.terminal.reconcileTerminalInstances(now().toISOString()));
  }

  recordDeliverableEvent(
    eventId: string,
    instanceId: string,
    eventName: string,
    createdAt: string,
    tenantId: string | null,
    payloadJson: string | null,
    sentBy: string | null,
    actorJson: string | null = null,
    payloadBytes = 0,
    actorBytes = 0,
    eventAuthority: WorkflowPersistedExecutionAuthority | null = null,
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
      throw new WorkflowError(
        'Workflow event byte accounting is invalid',
        'WORKFLOW_STATE_INVALID',
        500,
      );
    }
    if (eventAuthority && actorJson === null) {
      throw new WorkflowError(
        'Authenticated workflow events require an actor snapshot',
        'WORKFLOW_STATE_INVALID',
        500,
      );
    }
    const preparedAuthority = eventAuthority && actorJson
      ? this.authorities.prepare({
          eventId,
          tenantId,
          instanceId,
          eventName,
          payloadJson,
          sentBy,
          createdAt,
          actorJson,
        }, eventAuthority)
      : null;
    const authorityKind = eventAuthority?.kind ?? 'legacy-untrusted';
    const persistedActorBytes = actorBytes + (preparedAuthority?.bytes ?? 0);
    const nextBytes = payloadBytes + persistedActorBytes;
    this.transaction(() => {
      this.capacity.reserve(instanceId, nextBytes);
      this.db.prepare(`
        INSERT INTO _workflow_event_delivery (
          event_id, instance_id, event_name, claimed_by_step_id, claimed_at,
          actor_json, authority_kind, payload_bytes, actor_bytes, created_at
        ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)
      `).run(
        eventId, instanceId, eventName, actorJson, authorityKind, payloadBytes,
        persistedActorBytes, createdAt,
      );
      if (preparedAuthority) {
        this.authorities.insert(eventId, preparedAuthority, createdAt);
      }
    });
  }

  claimEvent(
    instanceId: string,
    stepId: string,
    eventName: string,
    claimedAt: string,
  ): ClaimedWorkflowEvent | null {
    this.runtimeFence?.assertCurrent();
    const existing = this.claimedEvent(stepId);
    if (existing) return existing;

    this.assertPendingEventIdentity(instanceId, eventName);
    const claim = this.transaction<
      | { ok: true; event: ClaimedWorkflowEvent | null }
      | { ok: false; error: unknown }
    >(() => {
      const candidate = this.db.prepare(`
        SELECT e.event_id, e.tenant_id, e.instance_id, e.event_name, e.payload,
          e.sent_by, e.created_at, delivery.actor_json,
          delivery.authority_kind
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

      // Decode before changing delivery/accounting state. ReactiveDB marks a
      // transaction rollback-only whenever a nested transaction callback
      // throws, even if its caller catches the error. Returning the decode
      // failure as data lets the enclosing workflow transaction fail the run
      // durably without first poisoning that transaction.
      let event: ClaimedWorkflowEvent;
      try {
        event = this.deserializeEvent(candidate);
      } catch (error) {
        return { ok: false, error };
      }

      const result = this.db.prepare(`
        UPDATE _workflow_event_delivery
        SET claimed_by_step_id = ?, claimed_at = ?
        WHERE event_id = ? AND claimed_by_step_id IS NULL
      `).run(stepId, claimedAt, candidate.event_id);
      if (result.changes !== 1) return { ok: true, event: null };
      this.capacity.markClaimed(instanceId);
      return { ok: true, event };
    });
    if (!claim.ok) throw claim.error;
    return claim.event;
  }

  claimedEvent(stepId: string): ClaimedWorkflowEvent | null {
    this.runtimeFence?.assertCurrent();
    const row = this.db.prepare(`
      SELECT e.event_id, e.tenant_id, e.instance_id, e.event_name, e.payload,
        e.sent_by, e.created_at, delivery.actor_json,
        delivery.authority_kind
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
    if (row) return this.deserializeEvent(row);
    const delivery = this.db.prepare(`
      SELECT event_id FROM _workflow_event_delivery
      WHERE claimed_by_step_id = ? LIMIT 1
    `).get(stepId) as { event_id: string } | null;
    if (delivery) throw invalidEventDelivery();
    return null;
  }

  isEventClaimed(eventId: string): boolean {
    this.runtimeFence?.assertCurrent();
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
      this.capacity.markConsumed(row.instance_id, bytes);
      return true;
    });
  }

  /** Read the authenticated actor identifier attached to one event, if any. */
  getEventSender(eventId: string): string | null {
    this.runtimeFence?.assertCurrent();
    const row = this.db.prepare(`
      SELECT sent_by FROM workflow_events WHERE event_id = ? LIMIT 1
    `).get(eventId) as { sent_by: string | null } | null;
    return row?.sent_by ?? null;
  }

  isInstanceRunning(instanceId: string): boolean {
    this.runtimeFence?.assertCurrent();
    const row = this.db.prepare(`
      SELECT status FROM workflow_instances WHERE instance_id = ? LIMIT 1
    `).get(instanceId) as { status: string } | null;
    return row?.status === 'running';
  }

  /** Include private delivery progress in the graph pump's lost-wakeup fence. */
  signature(instanceId: string): string {
    this.runtimeFence?.assertCurrent();
    return this.capacity.signature(instanceId);
  }

  /** Atomically release event submissions and terminalize every queued delivery. */
  discardInstanceQueue(instanceId: string, terminalAt: string): void {
    this.transaction(() => this.terminal.discardInstanceQueue(instanceId, terminalAt));
  }

  /** Recovery-only integrity check for O(1) event-capacity accounting. */
  validateUsage(instanceId: string): void {
    this.runtimeFence?.assertCurrent();
    this.capacity.validate(instanceId);
  }

  /** Recovery-only graph audit/private envelope integrity check. */
  validateGraphState(instanceId: string): void {
    this.runtimeFence?.assertCurrent();
    validateWorkflowGraphEventState(this.db, instanceId);
  }

  /** Recovery-only legacy audit validation with pre-runtime history support. */
  validateLegacyState(instanceId: string): void {
    this.runtimeFence?.assertCurrent();
    validateWorkflowLegacyEventState(this.db, instanceId);
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

  private transaction<T>(operation: () => T): T {
    return workflowRuntimeTransaction(this.db, this.runtimeFence, operation);
  }

  private deserializeEvent(row: WorkflowEventRow): ClaimedWorkflowEvent {
    const authority = this.authorities.read({
      eventId: row.event_id,
      tenantId: row.tenant_id,
      instanceId: row.instance_id,
      eventName: row.event_name,
      payloadJson: row.payload,
      sentBy: row.sent_by,
      createdAt: row.created_at,
      actorJson: row.actor_json,
    });
    let actor: WorkflowInteractionActor | null;
    try {
      actor = parseWorkflowEventActor(row.actor_json);
    } catch (error) {
      if (row.authority_kind === 'legacy-untrusted' && authority.state === 'none') throw error;
      actor = null;
    }
    const authorityCoherent = row.authority_kind === 'legacy-untrusted'
      ? authority.state === 'none'
      : authority.state === 'valid' && authority.authority.kind === row.authority_kind;
    if (!authorityCoherent) return this.invalidAuthorityEvent(row);
    if (authority.state === 'valid') {
      const expectedActorId = authority.authority.kind === 'actor'
        ? authority.authority.identity.userId
        : workflowSystemEventActorId(authority.authority.identity.principal);
      if (!actor
        || actor.actorId !== expectedActorId
        || (actor.tenantId ?? null) !== authority.authority.identity.tenantId) {
        return this.invalidAuthorityEvent(row);
      }
      actor = authority.authority.kind === 'actor'
        ? Object.freeze({
            ...actor,
            actorId: authority.authority.identity.userId,
            tenantId: authority.authority.identity.tenantId,
            roles: Object.freeze([...authority.authority.identity.roles]),
          })
        : Object.freeze({
            ...actor,
            actorId: expectedActorId,
            tenantId: authority.authority.identity.tenantId,
            roles: Object.freeze([]),
          });
    }
    return {
      eventId: row.event_id,
      name: row.event_name,
      payload: parseEventPayload(row.payload),
      actor,
      authority: authority.state === 'valid' ? authority.authority : null,
      authorityKind: row.authority_kind,
      authorityInvalid: false,
    };
  }

  private invalidAuthorityEvent(row: WorkflowEventRow): ClaimedWorkflowEvent {
    return {
      eventId: row.event_id,
      name: row.event_name,
      // The MAC is checked over the exact persisted payload text before this
      // branch. Once that check fails, neither decode nor expose attacker-
      // controlled bytes: callers only need the durable event identity to
      // consume the claim and fail the run closed.
      payload: undefined,
      actor: null,
      authority: null,
      authorityKind: row.authority_kind,
      authorityInvalid: true,
    };
  }
}

/** Stable actor identifier for an explicitly privileged system event. */
export function workflowSystemEventActorId(principal: string): string {
  return `system:${principal}`;
}

function parseEventPayload(payload: string | null): unknown {
  return payload === null ? undefined : JSON.parse(payload);
}

function invalidEventDelivery(): WorkflowError {
  return new WorkflowError(
    'Workflow event delivery identity is invalid',
    'WORKFLOW_STATE_INVALID',
    500,
  );
}
