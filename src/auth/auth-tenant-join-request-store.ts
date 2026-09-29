import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';
import {
  mapJoinRequest,
  type JoinRequestRow,
} from './auth-tenant-onboarding-codec';
import type {
  AuthTenantJoinRequestRecord,
  AuthTenantJoinRequestStatus,
} from './auth-tenant-onboarding-types';

/** Persistence row used by the reviewer-safe join-request projection. */
export interface AuthTenantJoinRequestProjectionRow extends JoinRequestRow {
  username: string;
  first_name: string | null;
  last_name: string | null;
  domain_request_role_key: string | null;
  domain_request_blocked_until: number | null;
  domain_provenance_unbound: number;
}

/** Durable verified-domain evidence bound to one join-request revision. */
export interface AuthTenantJoinRequestProvenanceRow {
  claim_id: string;
  domain: string;
  request_role_key: string;
  mailbox_proof_id: string | null;
  blocked_until: number | null;
  source: 'verified-domain' | 'legacy-unbound';
  request_revision: number | null;
}

interface JoinRequestCursor {
  timestamp: number;
  id: string;
}

/**
 * SQL and provenance boundary for tenant join requests.
 *
 * Transaction ownership deliberately remains with the orchestration service;
 * every method here is a synchronous statement operation inside that caller's
 * existing tenant lock and ReactiveDB transaction.
 */
export class AuthTenantJoinRequestStore {
  private readonly stmts: {
    lockTenant: Statement;
    getJoinRequestById: Statement;
    getJoinRequestByTenantUser: Statement;
    insertJoinRequest: Statement;
    reopenJoinRequest: Statement;
    supersedePendingJoinRequest: Statement;
    approveJoinRequest: Statement;
    denyJoinRequest: Statement;
  };

  constructor(
    private readonly db: ReactiveDB,
    private readonly now: () => number = Date.now,
  ) {
    this.stmts = {
      lockTenant: db.prepare(`
        UPDATE _auth_tenants SET updated_at = updated_at WHERE tenant_id = ?
      `),
      getJoinRequestById: db.prepare(`
        SELECT * FROM _auth_tenant_join_requests
        WHERE tenant_id = ? AND join_request_id = ?
      `),
      getJoinRequestByTenantUser: db.prepare(`
        SELECT * FROM _auth_tenant_join_requests
        WHERE tenant_id = ? AND user_id = ?
      `),
      insertJoinRequest: db.prepare(`
        INSERT INTO _auth_tenant_join_requests (
          join_request_id, tenant_id, user_id, email, status,
          request_revision, requested_at, created_at, updated_at,
          reviewed_at, reviewed_by, last_decision, approved_membership_id
        ) VALUES (?, ?, ?, ?, 'pending', 1, ?, ?, ?, NULL, NULL, NULL, NULL)
      `),
      reopenJoinRequest: db.prepare(`
        UPDATE _auth_tenant_join_requests
        SET status = 'pending', request_revision = request_revision + 1,
            requested_at = ?, updated_at = ?, reviewed_at = NULL,
            reviewed_by = NULL, approved_membership_id = NULL
        WHERE join_request_id = ? AND tenant_id = ? AND user_id = ?
          AND status IN ('approved', 'denied', 'cancelled')
          AND request_revision = ?
      `),
      supersedePendingJoinRequest: db.prepare(`
        UPDATE _auth_tenant_join_requests
        SET request_revision = request_revision + 1,
            requested_at = ?, updated_at = ?, reviewed_at = NULL,
            reviewed_by = NULL, approved_membership_id = NULL
        WHERE join_request_id = ? AND tenant_id = ? AND user_id = ?
          AND status = 'pending' AND request_revision = ?
      `),
      approveJoinRequest: db.prepare(`
        UPDATE _auth_tenant_join_requests
        SET status = 'approved', updated_at = ?, reviewed_at = ?,
            reviewed_by = ?, last_decision = 'approved', approved_membership_id = ?
        WHERE join_request_id = ? AND tenant_id = ? AND status = 'pending'
          AND request_revision = ?
      `),
      denyJoinRequest: db.prepare(`
        UPDATE _auth_tenant_join_requests
        SET status = 'denied', updated_at = ?, reviewed_at = ?,
            reviewed_by = ?, last_decision = 'denied', approved_membership_id = NULL
        WHERE join_request_id = ? AND tenant_id = ? AND status = 'pending'
          AND request_revision = ?
      `),
    };
  }

  lockTenant(tenantId: string): void {
    this.stmts.lockTenant.run(tenantId);
  }

  getById(tenantId: string, joinRequestId: string): AuthTenantJoinRequestRecord | null {
    const row = this.stmts.getJoinRequestById.get(
      tenantId,
      joinRequestId,
    ) as JoinRequestRow | null;
    return row ? mapJoinRequest(row) : null;
  }

  getByTenantUser(tenantId: string, userId: string): AuthTenantJoinRequestRecord | null {
    const row = this.stmts.getJoinRequestByTenantUser.get(
      tenantId,
      userId,
    ) as JoinRequestRow | null;
    return row ? mapJoinRequest(row) : null;
  }

  insert(input: {
    joinRequestId: string;
    tenantId: string;
    userId: string;
    email: string;
    now: number;
  }): void {
    this.stmts.insertJoinRequest.run(
      input.joinRequestId,
      input.tenantId,
      input.userId,
      input.email,
      input.now,
      input.now,
      input.now,
    );
  }

  supersedePending(request: AuthTenantJoinRequestRecord, now: number): number {
    return this.stmts.supersedePendingJoinRequest.run(
      now,
      now,
      request.joinRequestId,
      request.tenantId,
      request.userId,
      request.requestRevision,
    ).changes;
  }

  reopen(request: AuthTenantJoinRequestRecord, now: number): number {
    return this.stmts.reopenJoinRequest.run(
      now,
      now,
      request.joinRequestId,
      request.tenantId,
      request.userId,
      request.requestRevision,
    ).changes;
  }

  approve(input: {
    request: AuthTenantJoinRequestRecord;
    expectedRequestRevision: number;
    reviewedBy: string;
    membershipId: string;
    now: number;
  }): number {
    return this.stmts.approveJoinRequest.run(
      input.now,
      input.now,
      input.reviewedBy,
      input.membershipId,
      input.request.joinRequestId,
      input.request.tenantId,
      input.expectedRequestRevision,
    ).changes;
  }

  deny(input: {
    request: AuthTenantJoinRequestRecord;
    expectedRequestRevision: number;
    reviewedBy: string;
    now: number;
  }): number {
    return this.stmts.denyJoinRequest.run(
      input.now,
      input.now,
      input.reviewedBy,
      input.request.joinRequestId,
      input.request.tenantId,
      input.expectedRequestRevision,
    ).changes;
  }

  listProjectionRows(input: {
    tenantId: string;
    status?: AuthTenantJoinRequestStatus;
    cursor: JoinRequestCursor | null;
    limit: number;
  }): AuthTenantJoinRequestProjectionRow[] {
    const clauses = ['request.tenant_id = ?'];
    const args: Array<string | number> = [input.tenantId];
    if (input.status) {
      clauses.push('request.status = ?');
      args.push(input.status);
    }
    if (input.cursor) {
      clauses.push(`(
        request.requested_at > ?
        OR (request.requested_at = ? AND request.join_request_id > ?)
      )`);
      args.push(input.cursor.timestamp, input.cursor.timestamp, input.cursor.id);
    }
    const domainProjection = this.domainProjectionSql();
    return this.db.prepare(`
      SELECT request.*, identity.username, identity.first_name, identity.last_name,
        ${domainProjection.column}
      FROM _auth_tenant_join_requests request
      INNER JOIN users identity ON identity.user_id = request.user_id
      ${domainProjection.join}
      WHERE ${clauses.join(' AND ')}
      ORDER BY request.requested_at ASC, request.join_request_id ASC
      LIMIT ?
    `).all(...args, input.limit + 1) as AuthTenantJoinRequestProjectionRow[];
  }

  getProjectionRow(
    tenantId: string,
    joinRequestId: string,
  ): AuthTenantJoinRequestProjectionRow | null {
    const domainProjection = this.domainProjectionSql();
    return this.db.prepare(`
      SELECT request.*, identity.username, identity.first_name, identity.last_name,
        ${domainProjection.column}
      FROM _auth_tenant_join_requests request
      INNER JOIN users identity ON identity.user_id = request.user_id
      ${domainProjection.join}
      WHERE request.tenant_id = ? AND request.join_request_id = ?
    `).get(tenantId, joinRequestId) as AuthTenantJoinRequestProjectionRow | null;
  }

  getVerifiedDomainProvenance(
    tenantId: string,
    joinRequestId: string,
    requestRevision: number,
  ): AuthTenantJoinRequestProvenanceRow | null {
    if (!this.hasProvenanceTable()) return null;
    return this.db.prepare(`SELECT claim_id, domain, request_role_key, mailbox_proof_id,
        blocked_until, source, request_revision
      FROM _auth_domain_join_request_provenance
      WHERE tenant_id = ? AND join_request_id = ?
        AND source = 'verified-domain' AND request_revision = ?`).get(
      tenantId,
      joinRequestId,
      requestRevision,
    ) as AuthTenantJoinRequestProvenanceRow | null;
  }

  getAnyDomainProvenance(
    tenantId: string,
    joinRequestId: string,
  ): AuthTenantJoinRequestProvenanceRow | null {
    if (!this.hasProvenanceTable()) return null;
    return this.db.prepare(`SELECT claim_id, domain, request_role_key, mailbox_proof_id,
        blocked_until, source, request_revision
      FROM _auth_domain_join_request_provenance
      WHERE tenant_id = ? AND join_request_id = ?`).get(
      tenantId,
      joinRequestId,
    ) as AuthTenantJoinRequestProvenanceRow | null;
  }

  bindLegacyProvenanceToRevision(
    request: AuthTenantJoinRequestRecord,
    provenance: AuthTenantJoinRequestProvenanceRow | null,
  ): void {
    if (provenance?.source !== 'legacy-unbound'
      || provenance.request_revision !== null) return;
    this.db.prepare(`UPDATE _auth_domain_join_request_provenance
      SET request_revision = ?, updated_at = ?
      WHERE join_request_id = ? AND tenant_id = ?
        AND source = 'legacy-unbound' AND request_revision IS NULL`).run(
      request.requestRevision,
      this.now(),
      request.joinRequestId,
      request.tenantId,
    );
  }

  recordDomainMembershipProvenance(
    membershipId: string,
    joinRequestId: string,
    provenance: AuthTenantJoinRequestProvenanceRow,
  ): void {
    this.db.prepare(`
      INSERT INTO _auth_tenant_membership_provenance (
        membership_id, source, source_id, claim_id, domain, recorded_at
      ) VALUES (?, 'domain-request', ?, ?, ?, ?)
      ON CONFLICT(membership_id) DO NOTHING
    `).run(
      membershipId,
      joinRequestId,
      provenance.claim_id,
      provenance.domain,
      this.now(),
    );
  }

  blockVerifiedDomainProvenance(input: {
    request: AuthTenantJoinRequestRecord;
    expectedRequestRevision: number;
    blockedUntil: number;
    now: number;
  }): void {
    if (!this.hasProvenanceTable()) return;
    this.db.prepare(`UPDATE _auth_domain_join_request_provenance
      SET blocked_until = ?, updated_at = ?
      WHERE join_request_id = ? AND tenant_id = ?
        AND source = 'verified-domain' AND request_revision = ?`).run(
      input.blockedUntil,
      input.now,
      input.request.joinRequestId,
      input.request.tenantId,
      input.expectedRequestRevision,
    );
  }

  private hasProvenanceTable(): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = ?`).get('_auth_domain_join_request_provenance'));
  }

  private domainProjectionSql(): { column: string; join: string } {
    if (!this.hasProvenanceTable()) {
      return {
        column: `NULL AS domain_request_role_key,
          NULL AS domain_request_blocked_until,
          0 AS domain_provenance_unbound`,
        join: '',
      };
    }
    return {
      column: `CASE
          WHEN (domain_provenance.source = 'verified-domain'
              AND domain_provenance.request_revision = request.request_revision)
            OR (domain_provenance.source = 'legacy-unbound'
              AND (domain_provenance.request_revision IS NULL
                OR domain_provenance.request_revision = request.request_revision))
          THEN domain_provenance.request_role_key ELSE NULL
        END AS domain_request_role_key,
        CASE
          WHEN domain_provenance.source = 'verified-domain'
            AND domain_provenance.request_revision = request.request_revision
          THEN domain_provenance.blocked_until ELSE NULL
        END AS domain_request_blocked_until,
        CASE
          WHEN domain_provenance.source = 'legacy-unbound'
            AND (domain_provenance.request_revision IS NULL
              OR domain_provenance.request_revision = request.request_revision)
          THEN 1 ELSE 0
        END AS domain_provenance_unbound`,
      join: `LEFT JOIN _auth_domain_join_request_provenance domain_provenance
        ON domain_provenance.tenant_id = request.tenant_id
        AND domain_provenance.join_request_id = request.join_request_id`,
    };
  }
}
