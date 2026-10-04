/** Recovery validation for durable idempotent system-event receipts. */

import type { ReactiveDB } from '../sync/reactive-db';
import { WorkflowError } from './workflow-error';
import type { WorkflowEventAuthorityStore } from './workflow-event-authority-store';
import {
  createWorkflowSystemEventCommand,
  requireWorkflowSystemEventIdempotencyKey,
} from './workflow-system-event-delivery-contract';

interface ReceiptIntegrityRow {
  scope_kind: 'application' | 'tenant';
  scope_id: string;
  tenant_id: string | null;
  principal: string;
  idempotency_key: string;
  command_version: number;
  command_fingerprint: string;
  target_kind: string;
  target_id: string;
  receipt_event_id: string;
  receipt_instance_id: string;
  receipt_event_name: string;
  receipt_created_at: string;
  event_id: string | null;
  event_tenant_id: string | null;
  event_instance_id: string | null;
  event_name: string | null;
  payload: string | null;
  sent_by: string | null;
  event_created_at: string | null;
  actor_json: string | null;
  authority_kind: string | null;
}

/** Prove every receipt still names its exact sealed system event command. */
export function validateWorkflowSystemEventReceiptState(
  db: ReactiveDB,
  instanceId: string,
  eventAuthorities: WorkflowEventAuthorityStore,
): void {
  const orphan = db.prepare(`SELECT receipt.event_id
    FROM _workflow_system_event_receipts AS receipt
    LEFT JOIN workflow_events AS event ON event.event_id = receipt.event_id
    LEFT JOIN _workflow_event_delivery AS delivery
      ON delivery.event_id = receipt.event_id
    LEFT JOIN _workflow_event_authorities AS authority
      ON authority.event_id = receipt.event_id
    WHERE receipt.instance_id = ?
      AND (event.event_id IS NULL OR delivery.event_id IS NULL
        OR authority.event_id IS NULL)
    LIMIT 1`).get(instanceId) as { event_id: string } | null;
  if (orphan) throw invalidReceiptState('receipt has no complete event envelope');

  const rawRows = db.prepare(`SELECT
      receipt.scope_kind, receipt.scope_id, receipt.tenant_id,
      receipt.principal, receipt.idempotency_key,
      receipt.command_version, receipt.command_fingerprint,
      receipt.target_kind, receipt.target_id,
      receipt.event_id AS receipt_event_id,
      receipt.instance_id AS receipt_instance_id,
      receipt.event_name AS receipt_event_name,
      receipt.created_at AS receipt_created_at,
      event.event_id, event.tenant_id AS event_tenant_id,
      event.instance_id AS event_instance_id,
      event.event_name, event.payload, event.sent_by,
      event.created_at AS event_created_at,
      delivery.actor_json, delivery.authority_kind
    FROM _workflow_system_event_receipts AS receipt
    LEFT JOIN workflow_events AS event ON event.event_id = receipt.event_id
    LEFT JOIN _workflow_event_delivery AS delivery
      ON delivery.event_id = receipt.event_id
    WHERE receipt.instance_id = ?
    ORDER BY receipt.created_at ASC, receipt.event_id ASC`).all(instanceId);
  const rows = rawRows as ReceiptIntegrityRow[];

  for (const row of rows) validateReceipt(row, eventAuthorities);
}

function validateReceipt(
  row: ReceiptIntegrityRow,
  eventAuthorities: WorkflowEventAuthorityStore,
): void {
  try {
    requireWorkflowSystemEventIdempotencyKey(row.idempotency_key);
  } catch {
    throw invalidReceiptState('idempotency key is invalid');
  }
  const scopeValid = (row.scope_kind === 'application'
    && row.scope_id === 'application'
    && row.tenant_id === null)
    || (row.scope_kind === 'tenant'
      && row.tenant_id !== null
      && row.scope_id === row.tenant_id);
  if (!scopeValid
    || row.command_version !== 1
    || !/^[a-f0-9]{64}$/u.test(row.command_fingerprint)
    || row.target_kind !== 'instance'
    || row.target_id !== row.receipt_instance_id
    || row.receipt_event_id !== row.event_id
    || row.receipt_instance_id !== row.event_instance_id
    || row.receipt_event_name !== row.event_name
    || row.receipt_created_at !== row.event_created_at
    || row.tenant_id !== row.event_tenant_id
    || row.authority_kind !== 'system'
    || row.event_id === null
    || row.event_instance_id === null
    || row.event_name === null
    || row.event_created_at === null
    || row.actor_json === null) {
    throw invalidReceiptState('receipt identity is inconsistent');
  }
  const sealed = eventAuthorities.read({
    eventId: row.event_id,
    tenantId: row.event_tenant_id,
    instanceId: row.event_instance_id,
    eventName: row.event_name,
    payloadJson: row.payload,
    sentBy: row.sent_by,
    createdAt: row.event_created_at,
    actorJson: row.actor_json,
  });
  if (sealed.state !== 'valid'
    || sealed.authority.kind !== 'system'
    || sealed.authority.identity.principal !== row.principal
    || sealed.authority.identity.tenantId !== row.tenant_id
    || sealed.authority.identity.scopeKind !== row.scope_kind
    || sealed.authority.identity.scopeId !== row.scope_id) {
    throw invalidReceiptState('receipt authority is invalid');
  }
  const command = createWorkflowSystemEventCommand({
    instanceId: row.event_instance_id,
    eventName: row.event_name,
    payloadJson: row.payload,
    principal: sealed.authority.identity.principal,
    reason: sealed.authority.identity.reason,
    scopeKind: sealed.authority.identity.scopeKind,
    scopeId: sealed.authority.identity.scopeId,
    tenantId: sealed.authority.identity.tenantId,
  });
  if (command.fingerprint !== row.command_fingerprint) {
    throw invalidReceiptState('receipt command fingerprint is invalid');
  }
}

function invalidReceiptState(reason: string): WorkflowError {
  return new WorkflowError(
    `Workflow system event receipt state is invalid: ${reason}`,
    'WORKFLOW_STATE_INVALID',
    500,
  );
}
