/** Private immutable actor/SYSTEM start receipts; disjoint namespaces share the same cryptographic integrity checks. */
import type { ReactiveDB } from '../sync/reactive-db';
import type { WorkflowExecutionAuthorityStore, WorkflowPersistedExecutionAuthority } from './workflow-execution-authority';
import { workflowActorStartPrincipal } from './workflow-actor-start-contract';
import { WorkflowError } from './workflow-error';
import type { WorkflowInstanceRecord } from './types';
import {
  workflowSystemStartConflict, workflowSystemStartHash, workflowSystemStartPin,
  type WorkflowSystemStartIdentity, type WorkflowSystemStartResult,
} from './workflow-system-start-contract';

interface StartReceiptRow {
  scope_kind: 'application' | 'tenant'; scope_id: string; tenant_id: string | null;
  principal: string; idempotency_key: string; command_version: number;
  request_fingerprint: string; command_fingerprint: string; instance_id: string;
  name: string; definition_version: number | null; created_at: string;
  authority_json: string; authority_mac: string;
}

/** Access only inside an owner-fenced writer transaction; receipts never expire. */
export class WorkflowStartReceiptStore {
  private readonly table: string;
  private readonly sealDomain: string;
  constructor(private readonly db: ReactiveDB, private readonly authorities: WorkflowExecutionAuthorityStore, private readonly kind: 'system' | 'actor' = 'system') {
    this.table = `_workflow_${kind}_start_receipts`;
    this.sealDomain = `workflow.${kind}-start.receipt.v1`;
  }

  lookup(identity: WorkflowSystemStartIdentity, requestFingerprint?: string, assertAuthority?: (authority: WorkflowPersistedExecutionAuthority) => void): WorkflowSystemStartResult | null {
    const row = this.db.prepare(`SELECT * FROM ${this.table}
      WHERE scope_kind = ? AND scope_id = ? AND principal = ? AND idempotency_key = ?`).get(
      identity.scopeKind, identity.scopeId, identity.principal, identity.idempotencyKey,
    ) as StartReceiptRow | null;
    if (!row) return null;
    const original = this.assertIntegrity(row, identity);
    assertAuthority?.(original);
    if (requestFingerprint !== undefined && row.request_fingerprint !== requestFingerprint) throw workflowSystemStartConflict();
    return Object.freeze({ instanceId: row.instance_id, name: row.name, createdAt: row.created_at, definitionVersion: row.definition_version });
  }

  insert(identity: WorkflowSystemStartIdentity, requestFingerprint: string, instance: WorkflowInstanceRecord,
    authority: WorkflowPersistedExecutionAuthority): WorkflowSystemStartResult {
    const row: StartReceiptRow = {
      scope_kind: identity.scopeKind, scope_id: identity.scopeId, tenant_id: identity.tenantId,
      principal: identity.principal, idempotency_key: identity.idempotencyKey, command_version: 1,
      request_fingerprint: requestFingerprint,
      command_fingerprint: workflowSystemStartHash([1, requestFingerprint, workflowSystemStartPin(instance)]),
      instance_id: instance.instance_id, name: instance.name, created_at: instance.created_at,
      definition_version: instance.definition_version ?? null, authority_json: '', authority_mac: '',
    };
    const seal = this.authorities.sealAuthority(this.sealDomain, authority, boundReceipt(row));
    row.authority_json = seal.authorityJson; row.authority_mac = seal.authorityMac;
    this.db.prepare(`INSERT INTO ${this.table} (
      scope_kind, scope_id, tenant_id, principal, idempotency_key, command_version,
      request_fingerprint, command_fingerprint, instance_id, name, definition_version,
      created_at, authority_json, authority_mac
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      row.scope_kind, row.scope_id, row.tenant_id, row.principal, row.idempotency_key, row.command_version,
      row.request_fingerprint, row.command_fingerprint, row.instance_id, row.name, row.definition_version,
      row.created_at, row.authority_json, row.authority_mac,
    );
    return Object.freeze({ instanceId: row.instance_id, name: row.name, createdAt: row.created_at, definitionVersion: row.definition_version });
  }

  /** Permanent actor keys never silently expire. Capacity is checked in O(1) under the same writer lock. */
  assertCapacity(identity: WorkflowSystemStartIdentity): void {
    if (this.kind !== 'actor') return;
    const usage = this.db.prepare(`SELECT receipt_count FROM _workflow_actor_start_usage WHERE scope_kind = ? AND scope_id = ? AND principal = ?`)
      .get(identity.scopeKind, identity.scopeId, identity.principal) as { receipt_count: number } | null;
    if (usage && usage.receipt_count >= 100000) throw new WorkflowError('Permanent actor start receipt capacity reached; existing keys remain reconcilable', 'WORKFLOW_START_LIMIT_EXCEEDED', 507);
  }

  /** Validate retained receipts before recovery can execute an interrupted start. */
  validateInstance(instanceId: string): void {
    const row = this.db.prepare(`SELECT * FROM ${this.table} WHERE instance_id = ?`).get(instanceId) as StartReceiptRow | null;
    if (!row) return;
    this.assertIntegrity(row, { scopeKind: row.scope_kind, scopeId: row.scope_id, tenantId: row.tenant_id, principal: row.principal, idempotencyKey: row.idempotency_key });
  }

  /** Validate only live starts, using the status and receipt identity indexes without loading history. */
  validateRecovery(): void {
    const rows = this.db.prepare(`SELECT receipt.instance_id FROM workflow_instances AS instance
      INNER JOIN ${this.table} AS receipt ON receipt.instance_id = instance.instance_id
      WHERE instance.status IN ('running','paused')`).iterate() as Iterable<{ instance_id: string }>;
    // FK plus the native parent-delete trigger prevent ledger orphaning even
    // when an advanced SQLite caller temporarily disables foreign_keys.
    for (const row of rows) this.validateInstance(row.instance_id);
  }

  private assertIntegrity(row: StartReceiptRow, identity: WorkflowSystemStartIdentity): WorkflowPersistedExecutionAuthority {
    const instance = this.db.prepare('SELECT * FROM workflow_instances WHERE instance_id = ?').get(row.instance_id) as WorkflowInstanceRecord | null;
    const authority = this.authorities.openAuthority(this.sealDomain, boundReceipt(row), row.authority_json, row.authority_mac);
    if (!instance || row.command_version !== 1 || row.tenant_id !== identity.tenantId
      || !authority || authority.kind !== this.kind
      || (authority.kind === 'system' ? authority.identity.principal : workflowActorStartPrincipal(authority)) !== identity.principal
      || (authority.kind === 'actor' && instance.started_by !== authority.identity.userId)
      || authority.identity.scopeKind !== identity.scopeKind || authority.identity.scopeId !== identity.scopeId
      || authority.identity.tenantId !== identity.tenantId || instance.tenant_id !== identity.tenantId
      || instance.name !== row.name || instance.created_at !== row.created_at
      || (instance.definition_version ?? null) !== row.definition_version
      || row.command_fingerprint !== workflowSystemStartHash([1, row.request_fingerprint, workflowSystemStartPin(instance)])) {
      throw new WorkflowError(`Workflow ${this.kind} start receipt is inconsistent`, 'WORKFLOW_STATE_INVALID', 500);
    }
    return authority;
  }
}

function boundReceipt(row: StartReceiptRow): string {
  return JSON.stringify([row.command_version, row.scope_kind, row.scope_id, row.tenant_id, row.principal,
    row.idempotency_key, row.request_fingerprint, row.command_fingerprint, row.instance_id,
    row.name, row.definition_version, row.created_at]);
}
