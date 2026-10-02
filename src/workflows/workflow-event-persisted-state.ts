/**
 * workflow-event-persisted-state.ts
 *
 * Performs recovery-only integrity validation of graph event audit rows and
 * their private delivery envelopes. It does not mutate or dispatch events.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import { parseWorkflowEventActor, serializeWorkflowEventActor } from './workflow-event-actor';
import { WorkflowError } from './workflow-error';
import { MAX_WORKFLOW_EVENT_NAME_LENGTH } from './workflow-event-capacity-store';
import { parsePersistedWorkflowJson, persistedWorkflowTimestamp } from './workflow-persisted-state-values';
import { WorkflowExecutionAuthorityStore } from './workflow-execution-authority';
import { WorkflowEventAuthorityStore } from './workflow-event-authority-store';

interface PersistedEventEnvelope {
  event_id: string;
  tenant_id: string | null;
  instance_id: string;
  event_name: string;
  payload: string | null;
  sent_by: string | null;
  event_created_at: string;
  delivery_event_id: string | null;
  delivery_instance_id: string | null;
  delivery_event_name: string | null;
  claimed_by_step_id: string | null;
  claimed_at: string | null;
  actor_json: string | null;
  authority_kind: 'legacy-untrusted' | 'actor' | 'system' | null;
  payload_bytes: number | null;
  actor_bytes: number | null;
  delivery_created_at: string | null;
  authority_event_id: string | null;
  authority_json: string | null;
  authority_mac: string | null;
}

/** Every graph event must retain exactly one coherent private delivery row. */
export function validateWorkflowGraphEventState(db: ReactiveDB, instanceId: string): void {
  validateWorkflowEventState(db, instanceId, false);
}

/**
 * Validate legacy event state while preserving pre-runtime-schema audit rows.
 * Those public-only rows are historical and deliberately remain non-deliverable.
 */
export function validateWorkflowLegacyEventState(db: ReactiveDB, instanceId: string): void {
  validateWorkflowEventState(db, instanceId, true);
}

function validateWorkflowEventState(
  db: ReactiveDB,
  instanceId: string,
  allowHistoricalPublicOnly: boolean,
): void {
  const instance = db.prepare(`SELECT tenant_id FROM workflow_instances
    WHERE instance_id = ? LIMIT 1`).get(instanceId) as { tenant_id: string | null } | null;
  if (!instance) throw invalidEventState('event parent instance is missing');
  const eventAuthorities = new WorkflowEventAuthorityStore(
    db,
    new WorkflowExecutionAuthorityStore(db),
  );
  const orphanAuthority = db.prepare(`SELECT authority.event_id
    FROM _workflow_event_authorities AS authority
    LEFT JOIN workflow_events AS event ON event.event_id = authority.event_id
    LEFT JOIN _workflow_event_delivery AS delivery ON delivery.event_id = authority.event_id
    WHERE event.event_id IS NULL OR delivery.event_id IS NULL LIMIT 1`)
    .get() as { event_id: string } | null;
  if (orphanAuthority) throw invalidEventState('authority row has no matching event envelope');
  const rows = db.prepare(`SELECT
      event.event_id, event.tenant_id, event.instance_id, event.event_name,
      event.payload, event.sent_by,
      event.created_at AS event_created_at,
      delivery.event_id AS delivery_event_id,
      delivery.instance_id AS delivery_instance_id,
      delivery.event_name AS delivery_event_name,
      delivery.claimed_by_step_id, delivery.claimed_at, delivery.actor_json,
      delivery.authority_kind,
      delivery.payload_bytes, delivery.actor_bytes,
      delivery.created_at AS delivery_created_at,
      authority.event_id AS authority_event_id,
      authority.authority_json, authority.authority_mac
    FROM workflow_events AS event
    LEFT JOIN _workflow_event_delivery AS delivery ON delivery.event_id = event.event_id
    LEFT JOIN _workflow_event_authorities AS authority ON authority.event_id = event.event_id
    WHERE event.instance_id = ? ORDER BY event.rowid ASC`).all(instanceId) as PersistedEventEnvelope[];
  for (const row of rows) {
    try {
      validateEnvelope(
        db,
        eventAuthorities,
        instanceId,
        instance.tenant_id ?? null,
        row,
        allowHistoricalPublicOnly,
      );
    } catch (error) {
      if (error instanceof WorkflowError) throw error;
      throw invalidEventState('event envelope contains malformed durable data');
    }
  }

  const orphan = db.prepare(`SELECT delivery.event_id
    FROM _workflow_event_delivery AS delivery
    LEFT JOIN workflow_events AS event
      ON event.event_id = delivery.event_id
      AND event.instance_id = delivery.instance_id
      AND event.event_name = delivery.event_name
    WHERE delivery.instance_id = ? AND event.event_id IS NULL LIMIT 1`)
    .get(instanceId) as { event_id: string } | null;
  if (orphan) throw invalidEventState('delivery row has no matching public event');
}

function validateEnvelope(
  db: ReactiveDB,
  eventAuthorities: WorkflowEventAuthorityStore,
  instanceId: string,
  tenantId: string | null,
  row: PersistedEventEnvelope,
  allowHistoricalPublicOnly: boolean,
): void {
  if (row.instance_id !== instanceId
    || (row.tenant_id ?? null) !== tenantId
  ) {
    throw invalidEventState('public event does not match its parent instance');
  }
  if (!row.event_name || row.event_name.length > MAX_WORKFLOW_EVENT_NAME_LENGTH
    || row.event_name.includes('\0')) {
    throw invalidEventState('event name is invalid');
  }
  const createdAt = persistedWorkflowTimestamp(row.event_created_at, 'workflow event created_at');
  const payloadBytes = row.payload === null ? 0 : Buffer.byteLength(row.payload, 'utf8');
  if (row.payload !== null) parsePersistedWorkflowJson(row.payload, 'workflow event payload');

  if (row.delivery_event_id === null) {
    if (!allowHistoricalPublicOnly || row.authority_event_id !== null) {
      throw invalidEventState('public event is missing its private delivery envelope');
    }
    return;
  }
  if (row.delivery_instance_id !== instanceId
    || row.delivery_event_name !== row.event_name
    || row.delivery_created_at !== row.event_created_at
    || row.authority_kind === null) {
    throw invalidEventState('public and private event identities do not match');
  }
  if (!Number.isSafeInteger(row.payload_bytes) || row.payload_bytes !== payloadBytes) {
    throw invalidEventState('event payload byte accounting is invalid');
  }

  const actorSnapshotBytes = row.actor_json === null
    ? 0
    : Buffer.byteLength(row.actor_json, 'utf8');
  const sealedAuthorityBytes = row.authority_event_id === null
    ? 0
    : Buffer.byteLength(row.authority_json ?? '', 'utf8')
      + Buffer.byteLength(row.authority_mac ?? '', 'utf8');
  const actorBytes = actorSnapshotBytes + sealedAuthorityBytes;
  if (!Number.isSafeInteger(row.actor_bytes) || row.actor_bytes !== actorBytes) {
    throw invalidEventState('event actor byte accounting is invalid');
  }
  const actor = parseWorkflowEventActor(row.actor_json);
  if ((actor?.actorId ?? null) !== row.sent_by
    || serializeWorkflowEventActor(actor) !== row.actor_json) {
    throw invalidEventState('event actor snapshot does not match its audit sender');
  }
  const sealed = eventAuthorities.read({
    eventId: row.event_id,
    tenantId: row.tenant_id ?? null,
    instanceId: row.instance_id,
    eventName: row.event_name,
    payloadJson: row.payload,
    sentBy: row.sent_by,
    createdAt: row.event_created_at,
    actorJson: row.actor_json,
  });
  if (row.authority_kind === 'legacy-untrusted') {
    if (row.authority_event_id !== null || sealed.state !== 'none') {
      throw invalidEventState('untrusted event has an authority envelope');
    }
  } else if (row.authority_event_id !== null) {
    if (sealed.state !== 'valid'
      || sealed.authority.kind !== row.authority_kind
      || actor === null
      || (sealed.authority.kind === 'actor'
        ? sealed.authority.identity.userId
        : `system:${sealed.authority.identity.principal}`) !== actor.actorId
      || sealed.authority.identity.tenantId !== (actor.tenantId ?? null)) {
      throw invalidEventState('event actor authority seal is invalid');
    }
  } else {
    throw invalidEventState('trusted event is missing its authority envelope');
  }

  if (row.claimed_by_step_id === null) {
    if (row.claimed_at !== null) throw invalidEventState('pending event has a claim timestamp');
    return;
  }
  const claimedAt = persistedWorkflowTimestamp(row.claimed_at, 'workflow event claimed_at');
  if (claimedAt! < createdAt!) throw invalidEventState('event claim precedes event creation');
  if (row.claimed_by_step_id.startsWith('consumed:')) {
    if (row.claimed_by_step_id !== `consumed:${row.event_id}`) {
      throw invalidEventState('consumed event marker is invalid');
    }
    return;
  }
  if (row.claimed_by_step_id.startsWith('discarded:')) {
    if (row.claimed_by_step_id !== `discarded:${row.event_id}`) {
      throw invalidEventState('discarded event marker is invalid');
    }
    return;
  }
  const step = db.prepare(`SELECT instance_id, wait_event FROM workflow_steps
    WHERE step_id = ? LIMIT 1`).get(row.claimed_by_step_id) as {
      instance_id: string;
      wait_event: string | null;
    } | null;
  if (!step || step.instance_id !== instanceId
    || (step.wait_event !== null && step.wait_event !== row.event_name)) {
    throw invalidEventState('event claim does not belong to its waiting step');
  }
}

function invalidEventState(reason: string): WorkflowError {
  return new WorkflowError(
    `Workflow event delivery state is invalid: ${reason}`,
    'WORKFLOW_STATE_INVALID',
    500,
  );
}
