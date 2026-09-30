import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../../sync/reactive-db';
import {
  authTokenEligibleUserSql,
  recoverableTenantRegistrationUserSql,
} from '../auth-user-eligibility';
import { ADMIN_USER_PROVISIONING_TABLE } from '../admin-user-provisioning-schema';
import { invokeSynchronousAuthCallback } from '../auth-synchronous-callback';
import { defineTenancyTables } from './tenancy-schema';
import {
  TENANT_OWNER_ROLE_KEY,
  TenancyError,
  type TenantKind,
  type TenantMembershipRecord,
  type TenantMembershipStatus,
  type TenantRecord,
  type TenantStatus,
} from './tenancy-types';
import type { TenantStoreOptions } from './tenant-store-options';

interface TenantRow {
  tenant_id: string;
  kind: string;
  slug: string;
  name: string;
  status: string;
  authorization_generation: number;
  created_by: string;
  created_at: number;
  updated_at: number;
  suspended_at: number | null;
}

interface MembershipRow {
  membership_id: string;
  tenant_id: string;
  user_id: string;
  status: string;
  role_key: string | null;
  authorization_generation: number;
  joined_at: number;
  created_at: number;
  updated_at: number;
  suspended_at: number | null;
  removed_at: number | null;
  created_by: string;
}

interface CountRow {
  count: number;
}

interface TenantStoreStatements {
  userExists: Statement;
  activeUserExists: Statement;
  tokenEligibleUserExists: Statement;
  pendingRegistrationUserExists: Statement;
  pendingAdminUserExists: Statement | null;
  insertTenant: Statement;
  insertMembership: Statement;
  getTenantById: Statement;
  getTenantBySlug: Statement;
  getAdministrationTenant: Statement;
  countTenants: Statement;
  getMembershipById: Statement;
  getMembershipByTenantUser: Statement;
  getMembershipTenantHint: Statement;
  listActiveMembershipsForUser: Statement;
  hasActiveAdministrationMembership: Statement;
  listActiveMembershipsForTenant: Statement;
  lockTenant: Statement;
  countActiveOwners: Statement;
  countOtherActiveOwners: Statement;
  firstTenantWithoutRecoverableOwner: Statement;
  updateTenantStatus: Statement;
  updateMembershipStatus: Statement;
  readmitMembership: Statement;
  updateMembershipRole: Statement;
  bumpTenantGeneration: Statement;
  bumpMembershipGeneration: Statement;
}

/**
 * Internal persistence and transaction boundary shared by the lifecycle
 * coordinators. It owns prepared SQL, row mapping, profile fencing, and the
 * protected-owner checks that must run under the same ReactiveDB transaction.
 */
export class TenantStoreContext {
  private readonly clock: () => number;
  private readonly tenantIdFactory: () => string;
  private readonly membershipIdFactory: () => string;
  private readonly onOwnerCreated: NonNullable<TenantStoreOptions['onOwnerCreated']> | null;
  private readonly onOwnerRoleChanged:
    NonNullable<TenantStoreOptions['onOwnerRoleChanged']> | null;
  private readonly identityProjection:
    NonNullable<TenantStoreOptions['identityProjection']> | null;
  private readonly profileGuard: () => void;
  private readonly emitCode: TenantStoreOptions['emitCode'];
  readonly statements: TenantStoreStatements;

  constructor(
    readonly db: ReactiveDB,
    options: TenantStoreOptions,
    private readonly callbackReceiver: object,
  ) {
    defineTenancyTables(db);
    this.clock = options.now ?? Date.now;
    this.tenantIdFactory = options.createTenantId
      ?? (() => `ten_${crypto.randomUUID()}`);
    this.membershipIdFactory = options.createMembershipId
      ?? (() => `tmem_${crypto.randomUUID()}`);
    this.onOwnerCreated = options.onOwnerCreated ?? null;
    this.onOwnerRoleChanged = options.onOwnerRoleChanged ?? null;
    this.identityProjection = options.identityProjection ?? null;
    this.emitCode = options.emitCode;
    const assertCurrentProfile = options.assertCurrentProfile;
    this.profileGuard = assertCurrentProfile
      ? () => invokeSynchronousAuthCallback(assertCurrentProfile, {
          component: 'tenant-store',
          invariant: 'runtime-profile-guard-async',
          message: '[auth] Tenant runtime profile guard must be synchronous.',
          emitCode: this.emitCode,
        })
      : () => {};
    this.statements = prepareTenantStoreStatements(db);
  }

  now(): number {
    return this.clock.call(this.callbackReceiver);
  }

  createTenantId(): string {
    return this.tenantIdFactory.call(this.callbackReceiver);
  }

  createMembershipId(): string {
    return this.membershipIdFactory.call(this.callbackReceiver);
  }

  assertCurrentProfile(): void {
    this.profileGuard();
  }

  getTenant(tenantId: string): TenantRecord | null {
    this.assertCurrentProfile();
    const row = this.statements.getTenantById.get(tenantId) as TenantRow | null;
    return row ? mapTenant(row) : null;
  }

  getTenantByCanonicalSlug(slug: string): TenantRecord | null {
    const row = this.statements.getTenantBySlug.get(slug) as TenantRow | null;
    return row ? mapTenant(row) : null;
  }

  getAdministrationTenant(): TenantRecord | null {
    this.assertCurrentProfile();
    const rows = this.statements.getAdministrationTenant.all() as TenantRow[];
    if (rows.length > 1) {
      throw new TenancyError(
        'Multiple administration tenants exist',
        'TENANT_ADMINISTRATION_EXISTS',
      );
    }
    return rows[0] ? mapTenant(rows[0]) : null;
  }

  countTenants(): number {
    this.assertCurrentProfile();
    return (this.statements.countTenants.get() as CountRow).count;
  }

  getMembershipById(membershipId: string): TenantMembershipRecord | null {
    this.assertCurrentProfile();
    const row = this.statements.getMembershipById.get(membershipId) as MembershipRow | null;
    return row ? mapMembership(row) : null;
  }

  getMembership(tenantId: string, userId: string): TenantMembershipRecord | null {
    this.assertCurrentProfile();
    const row = this.statements.getMembershipByTenantUser.get(
      tenantId,
      userId,
    ) as MembershipRow | null;
    return row ? mapMembership(row) : null;
  }

  listActiveMembershipsForUser(userId: string): TenantMembershipRecord[] {
    this.assertCurrentProfile();
    return (this.statements.listActiveMembershipsForUser.all(userId) as MembershipRow[])
      .map(mapMembership);
  }

  hasActiveAdministrationMembership(userId: string): boolean {
    this.assertCurrentProfile();
    return Boolean(this.statements.hasActiveAdministrationMembership.get(userId));
  }

  listActiveMembershipsForTenant(tenantId: string): TenantMembershipRecord[] {
    this.assertCurrentProfile();
    this.requireTenant(tenantId);
    return (this.statements.listActiveMembershipsForTenant.all(tenantId) as MembershipRow[])
      .map(mapMembership);
  }

  mutation<T>(operation: () => T): T {
    return this.db.transaction(() => {
      // ReactiveDB begins an immediate transaction, so this generation check
      // cannot race a profile transition committed by another connection.
      this.assertCurrentProfile();
      return operation();
    });
  }

  lockTenant(tenantId: string): void {
    const result = this.statements.lockTenant.run(tenantId);
    if (result.changes !== 1) {
      throw new TenancyError('Tenant not found', 'TENANT_NOT_FOUND');
    }
  }

  requireUser(userId: string): void {
    if (!this.statements.userExists.get(userId)) {
      throw new TenancyError(`User not found: ${userId}`, 'TENANT_USER_NOT_FOUND');
    }
  }

  requireTenant(tenantId: string): TenantRecord {
    const tenant = this.getTenant(tenantId);
    if (!tenant) throw new TenancyError('Tenant not found', 'TENANT_NOT_FOUND');
    return tenant;
  }

  requireMembership(membershipId: string): TenantMembershipRecord {
    const membership = this.getMembershipById(membershipId);
    if (!membership) {
      throw new TenancyError('Tenant membership not found', 'TENANT_MEMBERSHIP_NOT_FOUND');
    }
    return membership;
  }

  requireMembershipTenantHint(membershipId: string): string {
    const row = this.statements.getMembershipTenantHint.get(membershipId) as {
      tenant_id: string;
    } | null;
    if (!row) {
      throw new TenancyError('Tenant membership not found', 'TENANT_MEMBERSHIP_NOT_FOUND');
    }
    return row.tenant_id;
  }

  notifyOwnerCreated(
    input: Parameters<NonNullable<TenantStoreOptions['onOwnerCreated']>>[0],
  ): void {
    if (!this.onOwnerCreated) return;
    invokeSynchronousAuthCallback(
      () => this.onOwnerCreated!.call(this.callbackReceiver, input),
      {
        component: 'tenant-store',
        invariant: 'owner-created-callback-async',
        message: '[auth] Tenant owner creation callback must be synchronous.',
        emitCode: this.emitCode,
      },
    );
  }

  notifyMembershipCreated(input: {
    membershipId: string;
    tenantId: string;
    userId: string;
  }): void {
    if (!this.identityProjection) return;
    if (this.identityProjectionIsDeferred(input.userId, input.tenantId)) return;
    invokeSynchronousAuthCallback(
      () => this.identityProjection!.membershipCreated(input),
      {
        component: 'tenant-store',
        invariant: 'identity-projection-membership-hook-async',
        message: '[auth] Identity projection membership hook must be synchronous.',
        emitCode: this.emitCode,
      },
    );
  }

  private identityProjectionIsDeferred(userId: string, tenantId: string): boolean {
    return Boolean(
      this.statements.pendingRegistrationUserExists.get(userId, tenantId)
      || this.statements.pendingAdminUserExists?.get(userId),
    );
  }

  notifyOwnerRoleChanged(
    input: Parameters<NonNullable<TenantStoreOptions['onOwnerRoleChanged']>>[0],
  ): void {
    if (!this.onOwnerRoleChanged) return;
    invokeSynchronousAuthCallback(
      () => this.onOwnerRoleChanged!.call(this.callbackReceiver, input),
      {
        component: 'tenant-store',
        invariant: 'owner-role-changed-callback-async',
        message: '[auth] Tenant owner role callback must be synchronous.',
        emitCode: this.emitCode,
      },
    );
  }

  assertCanLoseActiveOwner(
    current: TenantMembershipRecord,
    nextStatus: TenantMembershipStatus,
    nextRoleKey: string | null,
  ): void {
    const currentlyActiveOwner = current.status === 'active'
      && current.roleKey === TENANT_OWNER_ROLE_KEY;
    const remainsActiveOwner = nextStatus === 'active'
      && nextRoleKey === TENANT_OWNER_ROLE_KEY;
    if (!currentlyActiveOwner || remainsActiveOwner) return;
    this.assertTenantHasAnotherActiveOwner(current.tenantId, current.membershipId);
  }

  assertTenantHasActiveOwner(tenantId: string): void {
    const { count } = this.statements.countActiveOwners.get(
      tenantId,
      TENANT_OWNER_ROLE_KEY,
    ) as CountRow;
    if (count < 1) {
      throw new TenancyError(
        'A tenant must have an active owner before reactivation',
        'TENANT_LAST_OWNER',
      );
    }
  }

  assertUsableOwnerInvariants(): void {
    this.assertCurrentProfile();
    const invalid = this.statements.firstTenantWithoutRecoverableOwner.get() as {
      tenant_id: string;
    } | null;
    if (!invalid) return;
    throw new TenancyError(
      `Active tenant has no usable or registration-recoverable owner: ${invalid.tenant_id}`,
      'TENANT_USABLE_OWNER_REQUIRED',
    );
  }

  private assertTenantHasAnotherActiveOwner(
    tenantId: string,
    currentMembershipId: string,
  ): void {
    const { count } = this.statements.countOtherActiveOwners.get(
      tenantId,
      TENANT_OWNER_ROLE_KEY,
      currentMembershipId,
    ) as CountRow;
    if (count < 1) {
      throw new TenancyError(
        'A tenant must retain at least one active owner',
        'TENANT_LAST_OWNER',
      );
    }
  }
}

function prepareTenantStoreStatements(db: ReactiveDB): TenantStoreStatements {
  return {
    userExists: db.prepare('SELECT user_id FROM users WHERE user_id = ?'),
    activeUserExists: db.prepare(
      "SELECT user_id FROM users WHERE user_id = ? AND status = 'active'",
    ),
    tokenEligibleUserExists: db.prepare(`
      SELECT user_id FROM users
      WHERE user_id = ? AND ${authTokenEligibleUserSql('users')}
    `),
    pendingRegistrationUserExists: db.prepare(`
      SELECT user_id FROM _auth_registration_provisioning
      WHERE user_id = ? AND (tenant_id IS NULL OR tenant_id = ?) LIMIT 1
    `),
    pendingAdminUserExists: hasTable(db, ADMIN_USER_PROVISIONING_TABLE)
      ? db.prepare(`
          SELECT user_id FROM ${ADMIN_USER_PROVISIONING_TABLE}
          WHERE user_id = ? LIMIT 1
        `)
      : null,
    insertTenant: db.prepare(`
      INSERT INTO _auth_tenants (
        tenant_id, kind, slug, name, status, authorization_generation,
        created_by, created_at, updated_at, suspended_at
      ) VALUES (?, ?, ?, ?, 'active', 0, ?, ?, ?, NULL)
    `),
    insertMembership: db.prepare(`
      INSERT INTO _auth_tenant_memberships (
        membership_id, tenant_id, user_id, status, role_key,
        authorization_generation, joined_at, created_at, updated_at,
        suspended_at, removed_at, created_by
      ) VALUES (?, ?, ?, 'active', ?, 0, ?, ?, ?, NULL, NULL, ?)
    `),
    getTenantById: db.prepare(
      'SELECT * FROM _auth_tenants WHERE tenant_id = ?',
    ),
    getTenantBySlug: db.prepare(
      'SELECT * FROM _auth_tenants WHERE slug = ? COLLATE NOCASE',
    ),
    getAdministrationTenant: db.prepare(
      "SELECT * FROM _auth_tenants WHERE kind = 'administration' LIMIT 2",
    ),
    countTenants: db.prepare('SELECT COUNT(*) AS count FROM _auth_tenants'),
    getMembershipById: db.prepare(
      'SELECT * FROM _auth_tenant_memberships WHERE membership_id = ?',
    ),
    getMembershipByTenantUser: db.prepare(`
      SELECT * FROM _auth_tenant_memberships
      WHERE tenant_id = ? AND user_id = ?
    `),
    getMembershipTenantHint: db.prepare(`
      SELECT tenant_id FROM _auth_tenant_memberships WHERE membership_id = ?
    `),
    listActiveMembershipsForUser: db.prepare(`
      SELECT m.*
      FROM _auth_tenant_memberships m
      INNER JOIN _auth_tenants t ON t.tenant_id = m.tenant_id
      WHERE m.user_id = ? AND m.status = 'active' AND t.status = 'active'
      ORDER BY t.slug ASC, m.membership_id ASC
    `),
    hasActiveAdministrationMembership: db.prepare(`
      SELECT 1 AS present
      FROM _auth_tenant_memberships membership
      INNER JOIN _auth_tenants tenant ON tenant.tenant_id = membership.tenant_id
      WHERE membership.user_id = ?
        AND membership.status = 'active'
        AND tenant.status = 'active'
        AND tenant.kind = 'administration'
      LIMIT 1
    `),
    listActiveMembershipsForTenant: db.prepare(`
      SELECT * FROM _auth_tenant_memberships
      WHERE tenant_id = ? AND status = 'active'
      ORDER BY joined_at ASC, membership_id ASC
    `),
    // This no-op write must be the first statement in membership mutation
    // transactions. It serializes last-owner decisions across SQLite writers.
    lockTenant: db.prepare(`
      UPDATE _auth_tenants SET updated_at = updated_at WHERE tenant_id = ?
    `),
    countActiveOwners: db.prepare(`
      SELECT COUNT(*) AS count
      FROM _auth_tenant_memberships membership
      INNER JOIN users owner ON owner.user_id = membership.user_id
      WHERE membership.tenant_id = ?
        AND membership.status = 'active'
        AND membership.role_key = ?
        AND ${authTokenEligibleUserSql('owner')}
    `),
    countOtherActiveOwners: db.prepare(`
      SELECT COUNT(*) AS count
      FROM _auth_tenant_memberships membership
      INNER JOIN users owner ON owner.user_id = membership.user_id
      WHERE membership.tenant_id = ?
        AND membership.role_key = ?
        AND membership.membership_id <> ?
        AND membership.status = 'active'
        AND ${authTokenEligibleUserSql('owner')}
    `),
    firstTenantWithoutRecoverableOwner: db.prepare(`
      SELECT tenant.tenant_id
      FROM _auth_tenants tenant
      WHERE tenant.status = 'active'
        AND NOT EXISTS (
          SELECT 1
          FROM _auth_tenant_memberships membership
          INNER JOIN users owner ON owner.user_id = membership.user_id
          WHERE membership.tenant_id = tenant.tenant_id
            AND membership.status = 'active'
            AND membership.role_key = 'owner'
            AND ${authTokenEligibleUserSql('owner')}
        )
        AND NOT EXISTS (
          SELECT 1
          FROM _auth_tenant_memberships membership
          INNER JOIN users owner ON owner.user_id = membership.user_id
          WHERE membership.tenant_id = tenant.tenant_id
            AND membership.status = 'active'
            AND membership.role_key = 'owner'
            AND tenant.created_by = owner.user_id
            AND (${recoverableTenantRegistrationUserSql('owner', 'tenant')})
        )
      ORDER BY tenant.tenant_id ASC
      LIMIT 1
    `),
    updateTenantStatus: db.prepare(`
      UPDATE _auth_tenants
      SET status = ?,
          authorization_generation = authorization_generation + 1,
          updated_at = ?,
          suspended_at = ?
      WHERE tenant_id = ?
    `),
    updateMembershipStatus: db.prepare(`
      UPDATE _auth_tenant_memberships
      SET status = ?,
          authorization_generation = authorization_generation + 1,
          updated_at = ?,
          suspended_at = ?,
          removed_at = ?
      WHERE membership_id = ?
    `),
    readmitMembership: db.prepare(`
      UPDATE _auth_tenant_memberships
      SET status = 'active',
          role_key = ?,
          authorization_generation = authorization_generation + 1,
          updated_at = ?,
          suspended_at = NULL,
          removed_at = NULL
      WHERE membership_id = ?
    `),
    updateMembershipRole: db.prepare(`
      UPDATE _auth_tenant_memberships
      SET role_key = ?,
          authorization_generation = authorization_generation + 1,
          updated_at = ?
      WHERE membership_id = ?
    `),
    bumpTenantGeneration: db.prepare(`
      UPDATE _auth_tenants
      SET authorization_generation = authorization_generation + 1,
          updated_at = ?
      WHERE tenant_id = ?
    `),
    bumpMembershipGeneration: db.prepare(`
      UPDATE _auth_tenant_memberships
      SET authorization_generation = authorization_generation + 1,
          updated_at = ?
      WHERE membership_id = ?
    `),
  };
}

function hasTable(db: ReactiveDB, table: string): boolean {
  return Boolean(db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(table));
}

function mapTenant(row: TenantRow): TenantRecord {
  return {
    tenantId: row.tenant_id,
    kind: row.kind as TenantKind,
    slug: row.slug,
    name: row.name,
    status: row.status as TenantStatus,
    authorizationGeneration: row.authorization_generation,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    suspendedAt: row.suspended_at,
  };
}

function mapMembership(row: MembershipRow): TenantMembershipRecord {
  return {
    membershipId: row.membership_id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    status: row.status as TenantMembershipStatus,
    roleKey: row.role_key,
    authorizationGeneration: row.authorization_generation,
    joinedAt: row.joined_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    suspendedAt: row.suspended_at,
    removedAt: row.removed_at,
    createdBy: row.created_by,
  };
}
