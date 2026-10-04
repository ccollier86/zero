/** Private durable lookup/insert boundary for privileged event receipts. */

import type { ReactiveDB } from '../sync/reactive-db';
import { WorkflowError } from './workflow-error';
import type {
  WorkflowSystemEventDeliveryResult,
  WorkflowSystemEventReceiptCommand,
  WorkflowSystemEventReceiptIdentity,
} from './workflow-system-event-delivery-contract';
import {
  workflowSystemEventIdempotencyConflict,
} from './workflow-system-event-delivery-contract';

interface WorkflowSystemEventReceiptRow {
  scope_kind: string;
  scope_id: string;
  tenant_id: string | null;
  principal: string;
  idempotency_key: string;
  command_version: number;
  command_fingerprint: string;
  target_kind: string;
  target_id: string;
  event_id: string;
  instance_id: string;
  event_name: string;
  created_at: string;
  event_tenant_id: string | null;
  event_instance_id: string | null;
  event_event_name: string | null;
  delivery_authority_kind: string | null;
  authority_event_id: string | null;
}

export type WorkflowSystemEventReceiptLookup =
  | Readonly<{ readonly state: 'miss' }>
  | Readonly<{
      readonly state: 'replay';
      readonly result: WorkflowSystemEventDeliveryResult;
    }>;

/** Reads and appends immutable receipts inside the coordinator transaction. */
export class WorkflowSystemEventReceiptStore {
  constructor(private readonly db: ReactiveDB) {}

  lookup(
    identity: WorkflowSystemEventReceiptIdentity,
    command: WorkflowSystemEventReceiptCommand,
  ): WorkflowSystemEventReceiptLookup {
    const row = this.db.prepare(`
      SELECT receipt.*,
        event.tenant_id AS event_tenant_id,
        event.instance_id AS event_instance_id,
        event.event_name AS event_event_name,
        delivery.authority_kind AS delivery_authority_kind,
        authority.event_id AS authority_event_id
      FROM _workflow_system_event_receipts AS receipt
      LEFT JOIN workflow_events AS event ON event.event_id = receipt.event_id
      LEFT JOIN _workflow_event_delivery AS delivery
        ON delivery.event_id = receipt.event_id
      LEFT JOIN _workflow_event_authorities AS authority
        ON authority.event_id = receipt.event_id
      WHERE receipt.scope_kind = ? AND receipt.scope_id = ?
        AND receipt.principal = ? AND receipt.idempotency_key = ?
      LIMIT 1
    `).get(
      identity.scopeKind,
      identity.scopeId,
      identity.principal,
      identity.idempotencyKey,
    ) as WorkflowSystemEventReceiptRow | null;
    if (!row) return Object.freeze({ state: 'miss' });
    this.assertIntegrity(row, identity);
    if (row.command_fingerprint !== command.fingerprint
      || row.command_version !== command.version
      || row.target_kind !== command.targetKind
      || row.target_id !== command.targetId
      || row.instance_id !== command.instanceId
      || row.event_name !== command.eventName) {
      throw workflowSystemEventIdempotencyConflict();
    }
    return Object.freeze({
      state: 'replay',
      result: freezeResult(row),
    });
  }

  insert(
    identity: WorkflowSystemEventReceiptIdentity,
    command: WorkflowSystemEventReceiptCommand,
    result: WorkflowSystemEventDeliveryResult,
  ): void {
    this.db.prepare(`INSERT INTO _workflow_system_event_receipts (
      scope_kind, scope_id, tenant_id, principal, idempotency_key,
      command_version, command_fingerprint, target_kind, target_id,
      event_id, instance_id, event_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      identity.scopeKind,
      identity.scopeId,
      identity.tenantId,
      identity.principal,
      identity.idempotencyKey,
      command.version,
      command.fingerprint,
      command.targetKind,
      command.targetId,
      result.eventId,
      result.instanceId,
      result.eventName,
      result.createdAt,
    );
  }

  private assertIntegrity(
    row: WorkflowSystemEventReceiptRow,
    identity: WorkflowSystemEventReceiptIdentity,
  ): void {
    const scopeValid = row.scope_kind === identity.scopeKind
      && row.scope_id === identity.scopeId
      && row.tenant_id === identity.tenantId
      && row.principal === identity.principal
      && row.idempotency_key === identity.idempotencyKey
      && ((row.scope_kind === 'application'
        && row.scope_id === 'application'
        && row.tenant_id === null)
        || (row.scope_kind === 'tenant'
          && row.tenant_id !== null
          && row.scope_id === row.tenant_id));
    const commandValid = row.command_version === 1
      && /^[a-f0-9]{64}$/u.test(row.command_fingerprint)
      && row.target_kind === 'instance'
      && row.target_id === row.instance_id;
    const parentValid = row.event_instance_id === row.instance_id
      && row.event_event_name === row.event_name
      && row.event_tenant_id === row.tenant_id
      && row.delivery_authority_kind === 'system'
      && row.authority_event_id === row.event_id;
    if (!scopeValid || !commandValid || !parentValid
      || !row.event_id || !row.instance_id || !row.event_name || !row.created_at) {
      throw new WorkflowError(
        'Workflow system event receipt is inconsistent',
        'WORKFLOW_STATE_INVALID',
        500,
      );
    }
  }
}

function freezeResult(
  row: Pick<WorkflowSystemEventReceiptRow, 'event_id' | 'instance_id' | 'event_name' | 'created_at'>,
): WorkflowSystemEventDeliveryResult {
  return Object.freeze({
    eventId: row.event_id,
    instanceId: row.instance_id,
    eventName: row.event_name,
    createdAt: row.created_at,
  });
}
