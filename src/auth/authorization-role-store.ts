import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';
import { defineAuthorizationRoleTables } from './authorization-role-schema';
import {
  authTokenEligibleUserSql,
  recoverableRegistrationUserSql,
} from './auth-user-eligibility';
import type {
  AuthorizationAssignmentSource,
  AuthorizationRoleAssignmentRecord,
  AuthorizationRoleSet,
} from './authorization-role-types';

interface AssignmentRow {
  assignment_id: string;
  scope_kind: 'application' | 'tenant';
  scope_id: string;
  user_id: string;
  tenant_id: string | null;
  membership_id: string | null;
  role_key: string;
  source: AuthorizationAssignmentSource;
  source_id: string | null;
  created_by: string | null;
  created_at: number;
  revoked_by: string | null;
  revoked_at: number | null;
}

interface RoleRow { role_key: string }
interface GenerationRow { authorization_generation: number }
interface CountRow { count: number }
interface AssignmentMutationRow { assignment_id: string }
interface MembershipAuthorityRow {
  tenant_id: string;
  membership_id: string;
  user_id: string;
  membership_status: string;
  tenant_status: string;
  authorization_generation: number;
}

export interface RetainedSimpleMembershipRole {
  tenantId: string;
  membershipId: string;
  userId: string;
  status: 'active' | 'suspended';
  roleKey: string | null;
}

export interface InsertAuthorizationAssignmentInput {
  userId: string;
  roleKey: string;
  source: AuthorizationAssignmentSource;
  sourceId?: string | null;
  createdBy?: string | null;
  createdAt?: number;
}

export interface InsertTenantAuthorizationAssignmentInput
  extends InsertAuthorizationAssignmentInput {
  tenantId: string;
  membershipId: string;
}

/** SQL persistence owner for retained advanced-role assignment history. */
export class AuthorizationRoleStore {
  private readonly statements: {
    insertApplication: Statement;
    insertTenant: Statement;
    revokeApplication: Statement;
    revokeTenant: Statement;
    activeApplication: Statement;
    activeTenant: Statement;
    applicationRoles: Statement;
    tenantRoles: Statement;
    applicationGeneration: Statement;
    bumpApplicationGeneration: Statement;
    membershipAuthority: Statement;
    retainedSimpleMembershipRoles: Statement;
    countTenantAssignmentHistory: Statement;
    rebindWebMembershipSessions: Statement;
    rebindNativeMembershipSessions: Statement;
    deletePendingNativeMembershipCodes: Statement;
    deletePendingNativeMembershipRequests: Statement;
    reconcileTenantOwners: Statement;
    countActiveApplicationRole: Statement;
    countRetainedApplicationRole: Statement;
    countPendingApplicationOwnerVerification: Statement;
    hasPendingApplicationBootstrapReceipt: Statement;
    hasProvisionalApplicationOwner: Statement;
    hasProvisionalTenantOwner: Statement;
    deleteProvisionalApplicationOwner: Statement;
  };

  constructor(
    private readonly db: ReactiveDB,
    private readonly now: () => number = Date.now,
    private readonly createAssignmentId: () => string = () => `arole_${crypto.randomUUID()}`,
  ) {
    defineAuthorizationRoleTables(db);
    // Authority-revision AFTER triggers perform an additional write for each
    // assignment mutation. Bun includes those trigger side effects in
    // StatementResult.changes, so every conditional result below uses
    // RETURNING to count only rows targeted by this store.
    this.statements = {
      insertApplication: db.prepare(`
        INSERT OR IGNORE INTO _auth_application_role_assignments (
          assignment_id, application_id, user_id, role_key, source, source_id,
          created_by, created_at, revoked_by, revoked_at
        ) VALUES (?, 'application', ?, ?, ?, ?, ?, ?, NULL, NULL)
        RETURNING assignment_id
      `),
      insertTenant: db.prepare(`
        INSERT OR IGNORE INTO _auth_tenant_membership_roles (
          assignment_id, tenant_id, membership_id, user_id, role_key, source,
          source_id, created_by, created_at, revoked_by, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
        RETURNING assignment_id
      `),
      revokeApplication: db.prepare(`
        UPDATE _auth_application_role_assignments
        SET revoked_by = ?, revoked_at = ?
        WHERE application_id = 'application' AND user_id = ? AND role_key = ?
          AND revoked_at IS NULL
        RETURNING assignment_id
      `),
      revokeTenant: db.prepare(`
        UPDATE _auth_tenant_membership_roles
        SET revoked_by = ?, revoked_at = ?
        WHERE tenant_id = ? AND membership_id = ? AND role_key = ?
          AND revoked_at IS NULL
        RETURNING assignment_id
      `),
      activeApplication: db.prepare(`
        SELECT assignment_id, 'application' AS scope_kind,
          application_id AS scope_id, user_id, NULL AS tenant_id,
          NULL AS membership_id, role_key, source, source_id, created_by,
          created_at, revoked_by, revoked_at
        FROM _auth_application_role_assignments
        WHERE application_id = 'application' AND user_id = ? AND role_key = ?
          AND revoked_at IS NULL
      `),
      activeTenant: db.prepare(`
        SELECT assignment_id, 'tenant' AS scope_kind, tenant_id AS scope_id,
          user_id, tenant_id, membership_id, role_key, source, source_id,
          created_by, created_at, revoked_by, revoked_at
        FROM _auth_tenant_membership_roles
        WHERE tenant_id = ? AND membership_id = ? AND role_key = ?
          AND revoked_at IS NULL
      `),
      applicationRoles: db.prepare(`
        SELECT role_key FROM _auth_application_role_assignments
        WHERE application_id = 'application' AND user_id = ? AND revoked_at IS NULL
        ORDER BY role_key ASC
      `),
      tenantRoles: db.prepare(`
        SELECT role_key FROM _auth_tenant_membership_roles
        WHERE tenant_id = ? AND membership_id = ? AND user_id = ?
          AND revoked_at IS NULL
        ORDER BY role_key ASC
      `),
      applicationGeneration: db.prepare(`
        SELECT authorization_generation
        FROM _auth_application_authorization_state
        WHERE application_id = 'application' AND user_id = ?
      `),
      bumpApplicationGeneration: db.prepare(`
        INSERT INTO _auth_application_authorization_state (
          application_id, user_id, authorization_generation, updated_at
        ) VALUES ('application', ?, 1, ?)
        ON CONFLICT(application_id, user_id) DO UPDATE SET
          authorization_generation = authorization_generation + 1,
          updated_at = excluded.updated_at
      `),
      membershipAuthority: db.prepare(`
        SELECT m.tenant_id, m.membership_id, m.user_id,
          m.status AS membership_status, t.status AS tenant_status,
          m.authorization_generation
        FROM _auth_tenant_memberships m
        INNER JOIN _auth_tenants t ON t.tenant_id = m.tenant_id
        WHERE m.tenant_id = ? AND m.membership_id = ? AND m.user_id = ?
      `),
      retainedSimpleMembershipRoles: db.prepare(`
        SELECT tenant_id, membership_id, user_id, status, role_key
        FROM _auth_tenant_memberships
        WHERE status <> 'removed'
        ORDER BY tenant_id ASC, membership_id ASC
      `),
      countTenantAssignmentHistory: db.prepare(`
        SELECT COUNT(*) AS count FROM _auth_tenant_membership_roles
      `),
      rebindWebMembershipSessions: db.prepare(`
        UPDATE _auth_sessions
        SET membership_authorization_generation = ?
        WHERE scope_kind = 'tenant' AND tenant_id = ? AND membership_id = ?
          AND user_id = ? AND status = 'active'
      `),
      rebindNativeMembershipSessions: db.prepare(`
        UPDATE _auth_native_sessions
        SET membership_authorization_generation = ?
        WHERE scope_kind = 'tenant' AND tenant_id = ? AND membership_id = ?
          AND user_id = ?
      `),
      deletePendingNativeMembershipCodes: db.prepare(`
        DELETE FROM _auth_native_codes
        WHERE scope_kind = 'tenant' AND tenant_id = ? AND membership_id = ?
          AND user_id = ? AND consumed_at IS NULL
      `),
      deletePendingNativeMembershipRequests: db.prepare(`
        DELETE FROM _auth_native_requests
        WHERE scope_kind = 'tenant' AND tenant_id = ? AND membership_id = ?
          AND bound_user_id = ? AND consumed_at IS NULL
      `),
      reconcileTenantOwners: db.prepare(`
        INSERT OR IGNORE INTO _auth_tenant_membership_roles (
          assignment_id, tenant_id, membership_id, user_id, role_key, source,
          source_id, created_by, created_at, revoked_by, revoked_at
        )
        SELECT 'arole_' || lower(hex(randomblob(16))), m.tenant_id,
          m.membership_id, m.user_id, 'owner', 'migration',
          'simple-owner-adoption', m.created_by, ?, NULL, NULL
        FROM _auth_tenant_memberships m
        WHERE m.role_key = 'owner' AND m.status <> 'removed'
          AND NOT EXISTS (
            SELECT 1 FROM _auth_tenant_membership_roles r
            WHERE r.tenant_id = m.tenant_id
              AND r.membership_id = m.membership_id
              AND r.role_key = 'owner'
              AND r.revoked_at IS NULL
          )
        RETURNING assignment_id
      `),
      countActiveApplicationRole: db.prepare(`
        SELECT COUNT(*) AS count
        FROM _auth_application_role_assignments r
        INNER JOIN users u ON u.user_id = r.user_id
        WHERE r.application_id = 'application'
          AND r.role_key = ?
          AND r.revoked_at IS NULL
          AND ${authTokenEligibleUserSql('u')}
      `),
      countRetainedApplicationRole: db.prepare(`
        SELECT COUNT(*) AS count
        FROM _auth_application_role_assignments
        WHERE application_id = 'application'
          AND role_key = ?
          AND revoked_at IS NULL
      `),
      countPendingApplicationOwnerVerification: db.prepare(`
        SELECT COUNT(*) AS count
        FROM _auth_application_role_assignments assignment
        INNER JOIN users identity ON identity.user_id = assignment.user_id
        WHERE assignment.application_id = 'application'
          AND assignment.role_key = 'owner'
          AND assignment.source = 'bootstrap'
          AND assignment.revoked_at IS NULL
          AND (${recoverableRegistrationUserSql('identity')})
      `),
      hasPendingApplicationBootstrapReceipt: db.prepare(`
        SELECT COUNT(*) AS count
        FROM _auth_registration_provisioning pending
        WHERE pending.registration_id = ?
          AND pending.user_id = ?
          AND pending.tenant_id IS NULL
          AND pending.is_bootstrap = 1
      `),
      hasProvisionalApplicationOwner: db.prepare(`
        SELECT COUNT(*) AS count
        FROM _auth_application_role_assignments assignment
        INNER JOIN _auth_registration_provisioning pending
          ON pending.registration_id = assignment.source_id
          AND pending.user_id = assignment.user_id
          AND pending.is_bootstrap = 1
        WHERE assignment.application_id = 'application'
          AND assignment.user_id = ?
          AND assignment.role_key = 'owner'
          AND assignment.source = 'bootstrap'
          AND assignment.source_id = ?
          AND assignment.revoked_at IS NULL
      `),
      hasProvisionalTenantOwner: db.prepare(`
        SELECT COUNT(*) AS count
        FROM _auth_tenant_membership_roles assignment
        INNER JOIN _auth_tenant_memberships membership
          ON membership.membership_id = assignment.membership_id
          AND membership.tenant_id = assignment.tenant_id
          AND membership.user_id = assignment.user_id
        INNER JOIN _auth_registration_provisioning pending
          ON pending.registration_id = ?
          AND pending.tenant_id = assignment.tenant_id
          AND pending.user_id = assignment.user_id
        WHERE assignment.tenant_id = ?
          AND assignment.user_id = ?
          AND assignment.role_key = 'owner'
          AND assignment.source = 'system'
          AND assignment.source_id = 'tenant-creation'
          AND assignment.revoked_at IS NULL
          AND membership.status = 'active'
          AND membership.role_key = 'owner'
      `),
      deleteProvisionalApplicationOwner: db.prepare(`
        DELETE FROM _auth_application_role_assignments
        WHERE application_id = 'application'
          AND user_id = ?
          AND role_key = 'owner'
          AND source = 'bootstrap'
          AND source_id = ?
          AND revoked_at IS NULL
          AND EXISTS (
            SELECT 1
            FROM _auth_registration_provisioning pending
            WHERE pending.registration_id = ?
              AND pending.user_id = ?
              AND pending.is_bootstrap = 1
          )
        RETURNING assignment_id
      `),
    };
  }

  transaction<T>(operation: () => T): T {
    return this.db.transaction(operation);
  }

  /** Whether an exact, still-pending bootstrap receipt retains its owner row. */
  hasProvisionalApplicationOwner(userId: string, registrationId: string): boolean {
    const row = this.statements.hasProvisionalApplicationOwner.get(
      userId,
      registrationId,
    ) as CountRow | null;
    return (row?.count ?? 0) === 1;
  }

  hasPendingApplicationBootstrapReceipt(
    userId: string,
    registrationId: string,
  ): boolean {
    const row = this.statements.hasPendingApplicationBootstrapReceipt.get(
      registrationId,
      userId,
    ) as CountRow | null;
    return (row?.count ?? 0) === 1;
  }

  /** Whether the receipt-bound tenant still has its protected advanced owner. */
  hasProvisionalTenantOwner(input: {
    registrationId: string;
    tenantId: string;
    userId: string;
  }): boolean {
    const row = this.statements.hasProvisionalTenantOwner.get(
      input.registrationId,
      input.tenantId,
      input.userId,
    ) as CountRow | null;
    return (row?.count ?? 0) === 1;
  }

  insertApplication(input: InsertAuthorizationAssignmentInput): {
    changed: boolean;
    assignment: AuthorizationRoleAssignmentRecord;
  } {
    const createdAt = input.createdAt ?? this.now();
    const assignmentId = this.createAssignmentId();
    const inserted = this.statements.insertApplication.get(
      assignmentId,
      input.userId,
      input.roleKey,
      input.source,
      input.sourceId ?? null,
      input.createdBy ?? null,
      createdAt,
    ) as AssignmentMutationRow | null;
    const assignment = this.getActiveApplicationAssignment(input.userId, input.roleKey);
    if (!assignment) throw new Error('[auth] Application role assignment insert failed.');
    return { changed: inserted !== null, assignment };
  }

  insertTenant(input: InsertTenantAuthorizationAssignmentInput): {
    changed: boolean;
    assignment: AuthorizationRoleAssignmentRecord;
  } {
    const createdAt = input.createdAt ?? this.now();
    const assignmentId = this.createAssignmentId();
    const inserted = this.statements.insertTenant.get(
      assignmentId,
      input.tenantId,
      input.membershipId,
      input.userId,
      input.roleKey,
      input.source,
      input.sourceId ?? null,
      input.createdBy ?? null,
      createdAt,
    ) as AssignmentMutationRow | null;
    const assignment = this.getActiveTenantAssignment(
      input.tenantId,
      input.membershipId,
      input.roleKey,
    );
    if (!assignment) throw new Error('[auth] Tenant role assignment insert failed.');
    return { changed: inserted !== null, assignment };
  }

  revokeApplication(userId: string, roleKey: string, revokedBy: string): boolean {
    return this.statements.revokeApplication.get(
      revokedBy,
      this.now(),
      userId,
      roleKey,
    ) !== null;
  }

  /** Protected lifecycle primitive; callers must own application-owner invariants. */
  revokeApplicationSystemRole(
    userId: string,
    roleKey: string,
    revokedBy: string,
    revokedAt = this.now(),
  ): boolean {
    return this.statements.revokeApplication.get(
      revokedBy,
      revokedAt,
      userId,
      roleKey,
    ) !== null;
  }

  /**
   * Physically remove only a receipt-bound owner from an unfinished bootstrap.
   * The database trigger independently repeats the pending-marker check.
   */
  deleteProvisionalApplicationOwner(
    userId: string,
    registrationId: string,
  ): boolean {
    return this.statements.deleteProvisionalApplicationOwner.get(
      userId,
      registrationId,
      registrationId,
      userId,
    ) !== null;
  }

  revokeTenant(
    tenantId: string,
    membershipId: string,
    roleKey: string,
    revokedBy: string,
  ): boolean {
    return this.statements.revokeTenant.get(
      revokedBy,
      this.now(),
      tenantId,
      membershipId,
      roleKey,
    ) !== null;
  }

  /** Protected lifecycle primitive; callers must own tenant-owner invariants. */
  revokeTenantSystemRole(
    tenantId: string,
    membershipId: string,
    roleKey: string,
    revokedBy: string,
    revokedAt = this.now(),
  ): boolean {
    return this.statements.revokeTenant.get(
      revokedBy,
      revokedAt,
      tenantId,
      membershipId,
      roleKey,
    ) !== null;
  }

  getApplicationRoleSet(userId: string): AuthorizationRoleSet {
    const generation = (
      this.statements.applicationGeneration.get(userId) as GenerationRow | null
    )?.authorization_generation ?? 0;
    const roles = (this.statements.applicationRoles.all(userId) as RoleRow[])
      .map((row) => row.role_key);
    return freezeRoleSet({
      scopeKind: 'application',
      scopeId: 'application',
      userId,
      roles,
      revision: `application:application:${generation}`,
    });
  }

  getTenantRoleSet(
    tenantId: string,
    membershipId: string,
    userId: string,
  ): AuthorizationRoleSet | null {
    const authority = this.getMembershipAuthority(tenantId, membershipId, userId);
    if (!authority
      || authority.tenant_status !== 'active'
      || authority.membership_status !== 'active') return null;
    return this.getRetainedTenantRoleSet(tenantId, membershipId, userId);
  }

  /** Retained tenant assignments and generation, even while membership is inactive. */
  getRetainedTenantRoleSet(
    tenantId: string,
    membershipId: string,
    userId: string,
  ): AuthorizationRoleSet | null {
    const authority = this.getMembershipAuthority(tenantId, membershipId, userId);
    if (!authority) return null;
    const roles = (this.statements.tenantRoles.all(
      tenantId,
      membershipId,
      userId,
    ) as RoleRow[]).map((row) => row.role_key);
    return freezeRoleSet({
      scopeKind: 'tenant',
      scopeId: tenantId,
      tenantId,
      membershipId,
      userId,
      roles,
      revision: `tenant:${tenantId}:${membershipId}:${authority.authorization_generation}`,
    });
  }

  /** Active assignment keys without requiring the membership itself to be active. */
  getRetainedApplicationRoleKeys(userId: string): readonly string[] {
    return Object.freeze((this.statements.applicationRoles.all(userId) as RoleRow[])
      .map((row) => row.role_key));
  }

  /** Active assignment keys without requiring the membership itself to be active. */
  getRetainedTenantRoleKeys(
    tenantId: string,
    membershipId: string,
    userId: string,
  ): readonly string[] {
    return this.getRetainedTenantRoleSet(tenantId, membershipId, userId)?.roles
      ?? Object.freeze([]);
  }

  getMembershipAuthority(
    tenantId: string,
    membershipId: string,
    userId: string,
  ): MembershipAuthorityRow | null {
    return this.statements.membershipAuthority.get(
      tenantId,
      membershipId,
      userId,
    ) as MembershipAuthorityRow | null;
  }

  bumpApplicationGeneration(userId: string): void {
    this.statements.bumpApplicationGeneration.run(userId, this.now());
  }

  /** Active/suspended simple-role sources retained across an advanced upgrade. */
  listRetainedSimpleMembershipRoles(): readonly RetainedSimpleMembershipRole[] {
    const rows = this.statements.retainedSimpleMembershipRoles.all() as Array<{
      tenant_id: string;
      membership_id: string;
      user_id: string;
      status: 'active' | 'suspended';
      role_key: string | null;
    }>;
    return Object.freeze(rows.map((row) => Object.freeze({
      tenantId: row.tenant_id,
      membershipId: row.membership_id,
      userId: row.user_id,
      status: row.status,
      roleKey: row.role_key,
    })));
  }

  countTenantAssignmentHistory(): number {
    const row = this.statements.countTenantAssignmentHistory.get() as CountRow;
    return Number(row.count);
  }

  /** Rebase durable session parents while clearing incomplete native grants. */
  rebindAdoptedMembershipSessions(input: {
    tenantId: string;
    membershipId: string;
    userId: string;
    membershipAuthorizationGeneration: number;
  }): Readonly<{
    webSessions: number;
    nativeSessions: number;
    clearedNativeCodes: number;
    clearedNativeRequests: number;
  }> {
    const bindings = [input.tenantId, input.membershipId, input.userId] as const;
    // Codes reference requests, so remove incomplete codes before requests.
    const clearedNativeCodes = this.statements.deletePendingNativeMembershipCodes
      .run(...bindings).changes;
    const clearedNativeRequests = this.statements.deletePendingNativeMembershipRequests
      .run(...bindings).changes;
    const webSessions = this.statements.rebindWebMembershipSessions.run(
      input.membershipAuthorizationGeneration,
      ...bindings,
    ).changes;
    const nativeSessions = this.statements.rebindNativeMembershipSessions.run(
      input.membershipAuthorizationGeneration,
      ...bindings,
    ).changes;
    return Object.freeze({
      webSessions,
      nativeSessions,
      clearedNativeCodes,
      clearedNativeRequests,
    });
  }

  /** Adopt protected simple-mode owner memberships when advanced mode starts. */
  reconcileProtectedTenantOwners(): number {
    return (this.statements.reconcileTenantOwners.all(
      this.now(),
    ) as AssignmentMutationRow[]).length;
  }

  hasActiveApplicationRole(roleKey: string): boolean {
    const row = this.statements.countActiveApplicationRole.get(roleKey) as CountRow;
    return row.count > 0;
  }

  /** Any retained assignment, including a registration-gated bootstrap owner. */
  hasRetainedApplicationRole(roleKey: string): boolean {
    const row = this.statements.countRetainedApplicationRole.get(roleKey) as CountRow;
    return row.count > 0;
  }

  /** Exact durable bridge between delivered registration and email verification. */
  hasPendingApplicationOwnerVerification(): boolean {
    const row = this.statements.countPendingApplicationOwnerVerification.get() as CountRow;
    return row.count > 0;
  }

  private getActiveApplicationAssignment(
    userId: string,
    roleKey: string,
  ): AuthorizationRoleAssignmentRecord | null {
    const row = this.statements.activeApplication.get(userId, roleKey) as AssignmentRow | null;
    return row ? mapAssignment(row) : null;
  }

  private getActiveTenantAssignment(
    tenantId: string,
    membershipId: string,
    roleKey: string,
  ): AuthorizationRoleAssignmentRecord | null {
    const row = this.statements.activeTenant.get(
      tenantId,
      membershipId,
      roleKey,
    ) as AssignmentRow | null;
    return row ? mapAssignment(row) : null;
  }
}

function mapAssignment(row: AssignmentRow): AuthorizationRoleAssignmentRecord {
  return {
    assignmentId: row.assignment_id,
    scopeKind: row.scope_kind,
    scopeId: row.scope_id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    membershipId: row.membership_id,
    roleKey: row.role_key,
    source: row.source,
    sourceId: row.source_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    revokedBy: row.revoked_by,
    revokedAt: row.revoked_at,
  };
}

function freezeRoleSet(value: AuthorizationRoleSet): AuthorizationRoleSet {
  return Object.freeze({
    ...value,
    roles: Object.freeze([...value.roles]),
  });
}
