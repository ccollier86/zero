/** Private persistence, MAC sealing, and attempt leases for workflow authority. */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';
import {
  canonicalWorkflowAuthorityProperties,
  parseWorkflowExecutionAuthority,
  serializeWorkflowExecutionAuthority,
  workflowAuthoritySealPayload,
} from './workflow-execution-authority-codec';
import { defineWorkflowExecutionAuthorityTables } from './workflow-execution-authority-schema';
import type {
  WorkflowAuthorityFailureReason,
  WorkflowAuthorityReadResult,
  WorkflowAuthoritySeal,
  WorkflowPersistedExecutionAuthority,
} from './workflow-execution-authority-types';
import { WorkflowError } from './workflow-error';

const AUTHORITY_MAC_KEY = 'workflow.execution_authority.mac_key.v1';
const authorityStoreDatabases = new WeakMap<WorkflowExecutionAuthorityStore, ReactiveDB>();

interface AuthorityRow {
  instance_id: string;
  authority_kind: string;
  tenant_id: string | null;
  actor_user_id: string | null;
  authority_json: string;
  authority_mac: string;
  status: string;
  validation_count: number;
  created_at: number;
  last_validated_at: number | null;
  invalidated_at: number | null;
  invalidation_reason: string | null;
}

interface ConfigRow { value: string }

/** Private persistence owner for authenticated seals and execution leases. */
export class WorkflowExecutionAuthorityStore {
  private readonly insertAuthority: Statement;
  private readonly getAuthority: Statement;
  private readonly touchAuthority: Statement;
  private readonly invalidateAuthority: Statement;
  private readonly insertLease: Statement;
  private readonly getLease: Statement;
  private readonly deleteLease: Statement;
  private readonly deleteInstanceLeases: Statement;
  private readonly macKey: Buffer;

  constructor(
    private readonly db: ReactiveDB,
    private readonly now: () => number = Date.now,
  ) {
    authorityStoreDatabases.set(this, db);
    defineWorkflowExecutionAuthorityTables(db);
    this.macKey = loadOrCreateAuthorityMacKey(db);
    this.insertAuthority = db.prepare(`
      INSERT INTO _workflow_execution_authorities (
        instance_id, authority_kind, tenant_id, actor_user_id,
        authority_json, authority_mac, status, validation_count,
        created_at, last_validated_at, invalidated_at, invalidation_reason
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?, NULL, NULL, NULL)
    `);
    this.getAuthority = db.prepare(
      'SELECT * FROM _workflow_execution_authorities WHERE instance_id = ?',
    );
    // The write is intentionally first in every validation transaction. It
    // obtains SQLite's writer lock before auth/tenant/session rows are read.
    this.touchAuthority = db.prepare(`
      UPDATE _workflow_execution_authorities
      SET validation_count = validation_count + 1, last_validated_at = ?
      WHERE instance_id = ? AND status = 'active'
    `);
    this.invalidateAuthority = db.prepare(`
      UPDATE _workflow_execution_authorities
      SET status = 'invalid', invalidated_at = ?, invalidation_reason = ?
      WHERE instance_id = ? AND status = 'active'
    `);
    this.insertLease = db.prepare(`
      INSERT INTO _workflow_step_executions (
        step_id, instance_id, execution_id, created_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(step_id) DO UPDATE SET
        instance_id = excluded.instance_id,
        execution_id = excluded.execution_id,
        created_at = excluded.created_at
    `);
    this.getLease = db.prepare(
      'SELECT execution_id FROM _workflow_step_executions WHERE step_id = ?',
    );
    this.deleteLease = db.prepare(
      'DELETE FROM _workflow_step_executions WHERE step_id = ? AND execution_id = ?',
    );
    this.deleteInstanceLeases = db.prepare(
      'DELETE FROM _workflow_step_executions WHERE instance_id = ?',
    );
  }

  insert(instanceId: string, authority: WorkflowPersistedExecutionAuthority): void {
    // Preserve the v1 instance-seal wire format for already persisted runs.
    const json = serializeWorkflowExecutionAuthority(authority);
    this.insertAuthority.run(
      instanceId,
      authority.kind,
      authority.identity.tenantId,
      authority.kind === 'actor' ? authority.identity.userId : null,
      json,
      this.mac(json),
      this.now(),
    );
  }

  /** Bind a validated authority to one private durable record identifier. */
  sealAuthority(
    domain: string,
    authority: WorkflowPersistedExecutionAuthority,
    boundValue = '',
  ): WorkflowAuthoritySeal {
    const authorityJson = serializeWorkflowExecutionAuthority(authority);
    return Object.freeze({
      authorityJson,
      authorityMac: this.mac(workflowAuthoritySealPayload(
        domain,
        boundValue,
        authorityJson,
      )),
    });
  }

  /** Verify and decode an authority envelope without accepting raw snapshots. */
  openAuthority(
    domain: string,
    boundValue: string,
    authorityJson: string,
    authorityMac: string,
  ): WorkflowPersistedExecutionAuthority | null {
    if (!this.validMac(
      workflowAuthoritySealPayload(domain, boundValue, authorityJson),
      authorityMac,
    )) return null;
    return parseWorkflowExecutionAuthority(authorityJson);
  }

  /** Obtain the write lock and return a verified active seal. */
  lockAndRead(instanceId: string): WorkflowAuthorityReadResult {
    const touched = this.touchAuthority.run(this.now(), instanceId);
    if (touched.changes !== 1) return { ok: false, reason: 'authority-missing' };
    const row = this.getAuthority.get(instanceId) as AuthorityRow | null;
    if (!row || row.status !== 'active') {
      return { ok: false, reason: 'authority-missing' };
    }
    if (!this.validMac(row.authority_json, row.authority_mac)) {
      return { ok: false, reason: 'authority-seal-invalid' };
    }
    const authority = parseWorkflowExecutionAuthority(row.authority_json);
    if (!authority
      || authority.kind !== row.authority_kind
      || authority.identity.tenantId !== row.tenant_id
      || (authority.kind === 'actor' ? authority.identity.userId : null)
        !== row.actor_user_id) {
      return { ok: false, reason: 'authority-seal-invalid' };
    }
    return { ok: true, authority };
  }

  invalidate(instanceId: string, reason: WorkflowAuthorityFailureReason): void {
    this.invalidateAuthority.run(this.now(), reason, instanceId);
    this.deleteInstanceLeases.run(instanceId);
  }

  putLease(stepId: string, instanceId: string, executionId: string): void {
    this.insertLease.run(stepId, instanceId, executionId, this.now());
  }

  hasLease(stepId: string, executionId: string): boolean {
    const row = this.getLease.get(stepId) as { execution_id: string } | null;
    return row?.execution_id === executionId;
  }

  releaseLease(stepId: string, executionId: string): boolean {
    return this.deleteLease.run(stepId, executionId).changes === 1;
  }

  releaseInstanceLeases(instanceId: string): void {
    this.deleteInstanceLeases.run(instanceId);
  }

  propertyMac(properties: Readonly<Record<string, string>>): string {
    return this.mac(canonicalWorkflowAuthorityProperties(properties));
  }

  private mac(value: string): string {
    return createHmac('sha256', this.macKey).update(value).digest('hex');
  }

  private validMac(value: string, expectedHex: string): boolean {
    if (!/^[a-f0-9]{64}$/u.test(expectedHex)) return false;
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = Buffer.from(this.mac(value), 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}

/** @internal Non-spoofable database identity for composed workflow stores. */
export function workflowExecutionAuthorityStoreUsesDatabase(
  store: WorkflowExecutionAuthorityStore,
  db: ReactiveDB,
): boolean {
  return authorityStoreDatabases.get(store) === db;
}

function loadOrCreateAuthorityMacKey(db: ReactiveDB): Buffer {
  const select = db.prepare('SELECT value FROM _auth_config WHERE key = ?');
  const insert = db.prepare(
    'INSERT OR IGNORE INTO _auth_config (key, value) VALUES (?, ?)',
  );
  const generated = randomBytes(32).toString('base64url');
  insert.run(AUTHORITY_MAC_KEY, generated);
  const row = select.get(AUTHORITY_MAC_KEY) as ConfigRow | null;
  if (!row) {
    throw new WorkflowError(
      'Workflow execution authority MAC key could not be initialized',
      'WORKFLOW_STARTUP_FAILED',
      503,
    );
  }
  const key = Buffer.from(row.value, 'base64url');
  if (key.length !== 32) {
    throw new WorkflowError(
      'Workflow execution authority MAC key is invalid',
      'WORKFLOW_STARTUP_FAILED',
      503,
    );
  }
  return key;
}
