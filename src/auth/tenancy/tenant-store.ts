import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../../sync/reactive-db';
import {
  authTokenEligibleUserSql,
  recoverableTenantRegistrationUserSql,
} from '../auth-user-eligibility';
import {
  canonicalizeTenantName,
  canonicalizeTenantRoleKey,
  canonicalizeTenantSlug,
} from './tenancy-canonicalization';
import { defineTenancyTables } from './tenancy-schema';
import {
  TENANT_OWNER_ROLE_KEY,
  TenancyError,
  type CreateTenantMembershipInput,
  type CreateTenantWithOwnerInput,
  type PreparedTenantCreation,
  type TenantCreationResult,
  type TenantMembershipRecord,
  type TenantMembershipStatus,
  type TenantKind,
  type TenantOwnershipTransferResult,
  type TenantRecord,
  type TenantStatus,
} from './tenancy-types';
import type { AuthPlatformCodeEmitter } from '../auth-observability';
import { invokeSynchronousAuthCallback } from '../auth-synchronous-callback';
import { AuthError } from '../types';

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

export interface TenantStoreOptions {
  now?: () => number;
  createTenantId?: () => string;
  createMembershipId?: () => string;
  /** Advanced-RBAC hook executed inside initial tenant creation transaction. */
  onOwnerCreated?: (input: {
    tenantId: string;
    membershipId: string;
    userId: string;
    createdBy: string;
    createdAt: number;
  }) => void;
  /** Advanced-RBAC hook executed inside retained simple-role transitions. */
  onOwnerRoleChanged?: (input: {
    tenantId: string;
    membershipId: string;
    userId: string;
    previousRoleKey: string | null;
    roleKey: string;
    changedAt: number;
  }) => void;
  /** App-local installed-profile fence checked under every mutation lock. */
  assertCurrentProfile?: () => void;
  /** App-local observability boundary for transaction invariant failures. */
  emitCode?: AuthPlatformCodeEmitter;
}

/**
 * Persistence owner for internal tenant and membership records.
 *
 * Domain invariants live here rather than in HTTP handlers so future native,
 * background, bootstrap, and admin integrations share the same atomic rules.
 */
export class TenantStore {
  private readonly now: () => number;
  private readonly createTenantId: () => string;
  private readonly createMembershipId: () => string;
  private readonly onOwnerCreated: NonNullable<TenantStoreOptions['onOwnerCreated']> | null;
  private readonly onOwnerRoleChanged:
    NonNullable<TenantStoreOptions['onOwnerRoleChanged']> | null;
  private readonly assertCurrentProfile: () => void;
  private readonly emitCode?: AuthPlatformCodeEmitter;
  private readonly stmts: {
    userExists: Statement;
    activeUserExists: Statement;
    tokenEligibleUserExists: Statement;
    pendingRegistrationUserExists: Statement;
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
  };

  constructor(
    private readonly db: ReactiveDB,
    options: TenantStoreOptions = {},
  ) {
    defineTenancyTables(db);
    this.now = options.now ?? Date.now;
    this.createTenantId = options.createTenantId
      ?? (() => `ten_${crypto.randomUUID()}`);
    this.createMembershipId = options.createMembershipId
      ?? (() => `tmem_${crypto.randomUUID()}`);
    this.onOwnerCreated = options.onOwnerCreated ?? null;
    this.onOwnerRoleChanged = options.onOwnerRoleChanged ?? null;
    this.emitCode = options.emitCode;
    const assertCurrentProfile = options.assertCurrentProfile;
    this.assertCurrentProfile = assertCurrentProfile
      ? () => invokeSynchronousAuthCallback(assertCurrentProfile, {
          component: 'tenant-store',
          invariant: 'runtime-profile-guard-async',
          message: '[auth] Tenant runtime profile guard must be synchronous.',
          emitCode: this.emitCode,
        })
      : () => {};
    this.stmts = {
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

  /** Atomically create a tenant and its protected initial owner membership. */
  createTenantWithOwner(input: CreateTenantWithOwnerInput): TenantCreationResult {
    const prepared = this.prepareTenantWithOwner(input);

    try {
      return this.persistPreparedTenantWithOwner(prepared);
    } catch (error) {
      if (error instanceof AuthError) throw error;
      if (error instanceof TenancyError) throw error;
      // Never translate a stale-runtime fence failure into a slug conflict.
      this.assertCurrentProfile();
      if (this.getTenantByCanonicalSlug(prepared.slug)) {
        throw new TenancyError(
          `Tenant slug is already in use: ${prepared.slug}`,
          'TENANT_SLUG_TAKEN',
        );
      }
      throw error;
    }
  }

  /** Validate and allocate identifiers before token signing starts. */
  prepareTenantWithOwner(input: CreateTenantWithOwnerInput): PreparedTenantCreation {
    return {
      tenantId: this.createTenantId(),
      membershipId: this.createMembershipId(),
      kind: input.kind ?? 'organization',
      slug: canonicalizeTenantSlug(input.slug),
      name: canonicalizeTenantName(input.name),
      ownerUserId: input.ownerUserId,
      createdBy: input.createdBy ?? input.ownerUserId,
      createdAt: this.now(),
    };
  }

  /**
   * Persist a prepared tenant and protected owner. Nested calls participate in
   * the caller's ReactiveDB transaction, which lets auth consume admission and
   * issue the bound parent/refresh family as one commit.
   */
  persistPreparedTenantWithOwner(
    prepared: PreparedTenantCreation,
  ): TenantCreationResult {
    try {
      return this.mutation(() => {
        this.requireUser(prepared.ownerUserId);
        this.requireUser(prepared.createdBy);
        if (!this.stmts.tokenEligibleUserExists.get(prepared.ownerUserId)
          && !this.stmts.pendingRegistrationUserExists.get(
            prepared.ownerUserId,
            prepared.tenantId,
          )) {
          throw new TenancyError(
            'Initial owner must be able to authenticate or belong to the active registration',
            'TENANT_OWNERSHIP_TARGET_INVALID',
          );
        }
        this.stmts.insertTenant.run(
          prepared.tenantId,
          prepared.kind,
          prepared.slug,
          prepared.name,
          prepared.createdBy,
          prepared.createdAt,
          prepared.createdAt,
        );
        this.stmts.insertMembership.run(
          prepared.membershipId,
          prepared.tenantId,
          prepared.ownerUserId,
          TENANT_OWNER_ROLE_KEY,
          prepared.createdAt,
          prepared.createdAt,
          prepared.createdAt,
          prepared.createdBy,
        );
        this.notifyOwnerCreated({
          tenantId: prepared.tenantId,
          membershipId: prepared.membershipId,
          userId: prepared.ownerUserId,
          createdBy: prepared.createdBy,
          createdAt: prepared.createdAt,
        });
        return {
          tenant: this.requireTenant(prepared.tenantId),
          ownerMembership: this.requireMembership(prepared.membershipId),
        };
      });
    } catch (error) {
      if (error instanceof AuthError) throw error;
      if (error instanceof TenancyError) throw error;
      // Never translate a stale-runtime fence failure into a slug conflict.
      this.assertCurrentProfile();
      if (this.getTenantByCanonicalSlug(prepared.slug)) {
        throw new TenancyError(
          `Tenant slug is already in use: ${prepared.slug}`,
          'TENANT_SLUG_TAKEN',
        );
      }
      throw error;
    }
  }

  /** Create one retained tenant membership; duplicate relationships fail closed. */
  createMembership(input: CreateTenantMembershipInput): TenantMembershipRecord {
    const roleKey = canonicalizeTenantRoleKey(input.roleKey);
    const membershipId = this.createMembershipId();
    const now = this.now();

    try {
      return this.mutation(() => {
        this.lockTenant(input.tenantId);
        const tenant = this.requireTenant(input.tenantId);
        if (tenant.status !== 'active') {
          throw new TenancyError(
            'Cannot create an active membership in a non-active tenant',
            'TENANT_NOT_ACTIVE',
          );
        }
        this.requireUser(input.userId);
        this.requireUser(input.createdBy);
        if (roleKey === TENANT_OWNER_ROLE_KEY
          && !this.stmts.tokenEligibleUserExists.get(input.userId)) {
          throw new TenancyError(
            'Ownership target must be able to authenticate',
            'TENANT_OWNERSHIP_TARGET_INVALID',
          );
        }
        const existing = this.getMembership(input.tenantId, input.userId);
        if (existing) {
          throw new TenancyError(
            'A retained membership already exists for this tenant and user',
            'TENANT_MEMBERSHIP_EXISTS',
          );
        }
        this.stmts.insertMembership.run(
          membershipId,
          input.tenantId,
          input.userId,
          roleKey,
          now,
          now,
          now,
          input.createdBy,
        );
        if (roleKey === TENANT_OWNER_ROLE_KEY) {
          this.notifyOwnerCreated({
            tenantId: input.tenantId,
            membershipId,
            userId: input.userId,
            createdBy: input.createdBy,
            createdAt: now,
          });
        }
        return this.requireMembership(membershipId);
      });
    } catch (error) {
      if (error instanceof AuthError) throw error;
      if (!(error instanceof TenancyError)
        && this.getMembership(input.tenantId, input.userId)) {
        throw new TenancyError(
          'A retained membership already exists for this tenant and user',
          'TENANT_MEMBERSHIP_EXISTS',
        );
      }
      throw error;
    }
  }

  getTenant(tenantId: string): TenantRecord | null {
    this.assertCurrentProfile();
    const row = this.stmts.getTenantById.get(tenantId) as TenantRow | null;
    return row ? mapTenant(row) : null;
  }

  getTenantBySlug(slug: string): TenantRecord | null {
    this.assertCurrentProfile();
    return this.getTenantByCanonicalSlug(canonicalizeTenantSlug(slug));
  }

  /** Return the sole protected administration tenant, when provisioned. */
  getAdministrationTenant(): TenantRecord | null {
    this.assertCurrentProfile();
    const rows = this.stmts.getAdministrationTenant.all() as TenantRow[];
    if (rows.length > 1) {
      throw new TenancyError(
        'Multiple administration tenants exist',
        'TENANT_ADMINISTRATION_EXISTS',
      );
    }
    return rows[0] ? mapTenant(rows[0]) : null;
  }

  /** Count retained tenant boundaries for startup readiness checks. */
  countTenants(): number {
    this.assertCurrentProfile();
    return (this.stmts.countTenants.get() as CountRow).count;
  }

  /**
   * Adopt one exact existing organization as the administration boundary.
   * The database permits this one-way transition only while no administration
   * tenant exists; kind can never be changed again afterward.
   */
  adoptAdministrationTenant(tenantId: string): TenantRecord {
    return this.mutation(() => {
      this.lockTenant(tenantId);
      const current = this.requireTenant(tenantId);
      const administration = this.getAdministrationTenant();
      if (administration) {
        if (administration.tenantId === tenantId) return administration;
        throw new TenancyError(
          'An administration tenant already exists',
          'TENANT_ADMINISTRATION_EXISTS',
        );
      }
      if (current.status !== 'active') {
        throw new TenancyError(
          'Administration tenant must be active',
          'TENANT_NOT_ACTIVE',
        );
      }
      const changedAt = this.now();
      const changed = this.db.prepare(`
        UPDATE _auth_tenants
        SET kind = 'administration',
            authorization_generation = authorization_generation + 1,
            updated_at = ?
        WHERE tenant_id = ? AND kind = 'organization' AND status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM _auth_tenants WHERE kind = 'administration'
          )
      `).run(changedAt, tenantId);
      // `changes` includes the authorization-revision trigger on an installed
      // runtime, so successful adoption may report more than the tenant row.
      if (changed.changes < 1) {
        throw new TenancyError(
          'Administration tenant adoption conflicted with current state',
          'TENANT_ADMINISTRATION_EXISTS',
        );
      }
      const adopted = this.requireTenant(tenantId);
      if (adopted.kind !== 'administration') {
        throw new TenancyError(
          'Administration tenant adoption did not establish the protected scope',
          'TENANT_ADMINISTRATION_REQUIRED',
        );
      }
      return adopted;
    });
  }

  getMembershipById(membershipId: string): TenantMembershipRecord | null {
    this.assertCurrentProfile();
    const row = this.stmts.getMembershipById.get(membershipId) as MembershipRow | null;
    return row ? mapMembership(row) : null;
  }

  getMembership(tenantId: string, userId: string): TenantMembershipRecord | null {
    this.assertCurrentProfile();
    const row = this.stmts.getMembershipByTenantUser.get(
      tenantId,
      userId,
    ) as MembershipRow | null;
    return row ? mapMembership(row) : null;
  }

  /** Return only memberships currently usable for tenant authorization. */
  listActiveMembershipsForUser(userId: string): TenantMembershipRecord[] {
    this.assertCurrentProfile();
    return (this.stmts.listActiveMembershipsForUser.all(userId) as MembershipRow[])
      .map(mapMembership);
  }

  /** One indexed existence check for dynamic platform-operator policy. */
  hasActiveAdministrationMembership(userId: string): boolean {
    this.assertCurrentProfile();
    return Boolean(this.stmts.hasActiveAdministrationMembership.get(userId));
  }

  /** Return active members for tenant administration, even while the tenant is suspended. */
  listActiveMembershipsForTenant(tenantId: string): TenantMembershipRecord[] {
    this.assertCurrentProfile();
    this.requireTenant(tenantId);
    return (this.stmts.listActiveMembershipsForTenant.all(tenantId) as MembershipRow[])
      .map(mapMembership);
  }

  suspendTenant(tenantId: string): TenantRecord {
    return this.changeTenantStatus(tenantId, 'suspended');
  }

  reactivateTenant(tenantId: string): TenantRecord {
    return this.changeTenantStatus(tenantId, 'active');
  }

  suspendMembership(membershipId: string): TenantMembershipRecord {
    return this.changeMembershipStatus(membershipId, 'suspended');
  }

  reactivateMembership(membershipId: string): TenantMembershipRecord {
    return this.changeMembershipStatus(membershipId, 'active');
  }

  /**
   * Explicitly re-admit a suspended or removed retained relationship.
   *
   * This is intentionally separate from ordinary reactivation: removed
   * membership can regain authority only through a reviewer-owned onboarding
   * ceremony. Owner authority remains exclusive to ownership transfer.
   */
  readmitMembership(
    membershipId: string,
    roleKeyInput = 'member',
  ): TenantMembershipRecord {
    const roleKey = canonicalizeTenantRoleKey(roleKeyInput);
    if (roleKey === TENANT_OWNER_ROLE_KEY) {
      throw new TenancyError(
        'Owner authority requires explicit ownership transfer',
        'TENANT_OWNERSHIP_REQUIRED',
      );
    }
    const tenantId = this.requireMembershipTenantHint(membershipId);
    return this.mutation(() => {
      this.lockTenant(tenantId);
      const tenant = this.requireTenant(tenantId);
      const current = this.requireMembership(membershipId);
      if (tenant.status !== 'active') {
        throw new TenancyError(
          'Cannot re-admit a membership to a non-active tenant',
          'TENANT_NOT_ACTIVE',
        );
      }
      if (!this.stmts.activeUserExists.get(current.userId)) {
        throw new TenancyError(
          'Membership user is not active',
          'TENANT_USER_NOT_FOUND',
        );
      }
      if (current.status === 'active') return current;
      const changedAt = this.now();
      this.stmts.readmitMembership.run(roleKey, changedAt, membershipId);
      if (current.roleKey === TENANT_OWNER_ROLE_KEY) {
        this.notifyOwnerRoleChanged({
          tenantId,
          membershipId,
          userId: current.userId,
          previousRoleKey: TENANT_OWNER_ROLE_KEY,
          roleKey,
          changedAt,
        });
      }
      return this.requireMembership(membershipId);
    });
  }

  /** Retain the relationship for audit while permanently removing its authority. */
  removeMembership(membershipId: string): TenantMembershipRecord {
    const tenantId = this.requireMembershipTenantHint(membershipId);
    return this.mutation(() => {
      this.lockTenant(tenantId);
      const current = this.requireMembership(membershipId);
      if (current.status === 'removed') return current;
      this.assertCanLoseActiveOwner(current, 'removed', current.roleKey);
      const now = this.now();
      this.stmts.updateMembershipStatus.run(
        'removed',
        now,
        null,
        now,
        membershipId,
      );
      return this.requireMembership(membershipId);
    });
  }

  /**
   * Atomically promote a live target before demoting the current owner.
   *
   * The source is explicit because callers must derive it from the live
   * request membership. Generic role mutation remains unable to manufacture
   * or remove the protected owner lifecycle.
   */
  transferOwnership(
    currentOwnerMembershipId: string,
    targetMembershipId: string,
    demotedRoleKeyInput = 'member',
  ): TenantOwnershipTransferResult {
    if (currentOwnerMembershipId === targetMembershipId) {
      throw new TenancyError(
        'Ownership must be transferred to a different membership',
        'TENANT_OWNERSHIP_TARGET_INVALID',
      );
    }
    const tenantId = this.requireMembershipTenantHint(currentOwnerMembershipId);
    const demotedRoleKey = canonicalizeTenantRoleKey(demotedRoleKeyInput);
    if (demotedRoleKey === TENANT_OWNER_ROLE_KEY) {
      throw new TenancyError(
        'The previous owner must receive a non-owner role',
        'TENANT_OWNERSHIP_TARGET_INVALID',
      );
    }

    return this.mutation(() => {
      this.lockTenant(tenantId);
      const current = this.requireMembership(currentOwnerMembershipId);
      const target = this.requireMembership(targetMembershipId);
      if (current.tenantId !== tenantId || target.tenantId !== tenantId) {
        throw new TenancyError(
          'Ownership target does not belong to this tenant',
          'TENANT_OWNERSHIP_TARGET_INVALID',
        );
      }
      if (current.status !== 'active' || current.roleKey !== TENANT_OWNER_ROLE_KEY) {
        throw new TenancyError(
          'The current membership is not an active owner',
          'TENANT_OWNERSHIP_REQUIRED',
        );
      }
      if (target.status !== 'active'
        || !this.stmts.tokenEligibleUserExists.get(target.userId)) {
        throw new TenancyError(
          'Ownership target must be an active member who can authenticate',
          'TENANT_OWNERSHIP_TARGET_INVALID',
        );
      }

      const changedAt = this.now();
      if (target.roleKey !== TENANT_OWNER_ROLE_KEY) {
        this.stmts.updateMembershipRole.run(
          TENANT_OWNER_ROLE_KEY,
          changedAt,
          targetMembershipId,
        );
        this.notifyOwnerRoleChanged({
          tenantId,
          membershipId: target.membershipId,
          userId: target.userId,
          previousRoleKey: target.roleKey,
          roleKey: TENANT_OWNER_ROLE_KEY,
          changedAt,
        });
      }

      // Promotion happens first, so both the store preflight and database
      // triggers can prove that the tenant retains a usable owner.
      this.assertCanLoseActiveOwner(current, 'active', demotedRoleKey);
      this.stmts.updateMembershipRole.run(
        demotedRoleKey,
        changedAt,
        currentOwnerMembershipId,
      );
      this.notifyOwnerRoleChanged({
        tenantId,
        membershipId: current.membershipId,
        userId: current.userId,
        previousRoleKey: TENANT_OWNER_ROLE_KEY,
        roleKey: demotedRoleKey,
        changedAt,
      });

      return {
        previousOwnerMembership: this.requireMembership(currentOwnerMembershipId),
        ownerMembership: this.requireMembership(targetMembershipId),
      };
    });
  }

  /** Update the one simple-mode role and invalidate existing membership authority. */
  updateMembershipRole(
    membershipId: string,
    roleKeyInput: string,
  ): TenantMembershipRecord {
    const roleKey = canonicalizeTenantRoleKey(roleKeyInput);
    const tenantId = this.requireMembershipTenantHint(membershipId);

    return this.mutation(() => {
      this.lockTenant(tenantId);
      const current = this.requireMembership(membershipId);
      if (current.roleKey === roleKey) return current;
      if (roleKey === TENANT_OWNER_ROLE_KEY) {
        throw new TenancyError(
          'Owner authority requires explicit ownership transfer',
          'TENANT_OWNERSHIP_REQUIRED',
        );
      }
      this.assertCanLoseActiveOwner(current, current.status, roleKey);
      const changedAt = this.now();
      this.stmts.updateMembershipRole.run(roleKey, changedAt, membershipId);
      if (current.roleKey === TENANT_OWNER_ROLE_KEY
        || roleKey === TENANT_OWNER_ROLE_KEY) {
        this.notifyOwnerRoleChanged({
          tenantId,
          membershipId,
          userId: current.userId,
          previousRoleKey: current.roleKey,
          roleKey,
          changedAt,
        });
      }
      return this.requireMembership(membershipId);
    });
  }

  private notifyOwnerCreated(
    input: Parameters<NonNullable<TenantStoreOptions['onOwnerCreated']>>[0],
  ): void {
    if (!this.onOwnerCreated) return;
    invokeSynchronousAuthCallback(() => this.onOwnerCreated!(input), {
      component: 'tenant-store',
      invariant: 'owner-created-callback-async',
      message: '[auth] Tenant owner creation callback must be synchronous.',
      emitCode: this.emitCode,
    });
  }

  private notifyOwnerRoleChanged(
    input: Parameters<NonNullable<TenantStoreOptions['onOwnerRoleChanged']>>[0],
  ): void {
    if (!this.onOwnerRoleChanged) return;
    invokeSynchronousAuthCallback(() => this.onOwnerRoleChanged!(input), {
      component: 'tenant-store',
      invariant: 'owner-role-changed-callback-async',
      message: '[auth] Tenant owner role callback must be synchronous.',
      emitCode: this.emitCode,
    });
  }

  /** Explicit tenant-wide invalidation for policy or emergency changes. */
  bumpTenantAuthorizationGeneration(tenantId: string): TenantRecord {
    return this.mutation(() => {
      this.lockTenant(tenantId);
      this.stmts.bumpTenantGeneration.run(this.now(), tenantId);
      return this.requireTenant(tenantId);
    });
  }

  /** Explicit invalidation for one retained membership. */
  bumpMembershipAuthorizationGeneration(
    membershipId: string,
  ): TenantMembershipRecord {
    const tenantId = this.requireMembershipTenantHint(membershipId);
    return this.mutation(() => {
      this.lockTenant(tenantId);
      this.requireMembership(membershipId);
      this.stmts.bumpMembershipGeneration.run(this.now(), membershipId);
      return this.requireMembership(membershipId);
    });
  }

  /** Fail startup closed on owner rows that cannot authenticate or verify. */
  assertUsableOwnerInvariants(): void {
    this.assertCurrentProfile();
    const invalid = this.stmts.firstTenantWithoutRecoverableOwner.get() as {
      tenant_id: string;
    } | null;
    if (!invalid) return;
    throw new TenancyError(
      `Active tenant has no usable or registration-recoverable owner: ${invalid.tenant_id}`,
      'TENANT_USABLE_OWNER_REQUIRED',
    );
  }

  private changeTenantStatus(
    tenantId: string,
    status: Extract<TenantStatus, 'active' | 'suspended'>,
  ): TenantRecord {
    return this.mutation(() => {
      this.lockTenant(tenantId);
      const current = this.requireTenant(tenantId);
      if (current.status === status) return current;
      if (current.kind === 'administration') {
        throw new TenancyError(
          'The administration tenant cannot be suspended',
          'TENANT_ADMINISTRATION_PROTECTED',
        );
      }
      if (current.status === 'archived') {
        throw new TenancyError(
          'An archived tenant cannot change active suspension state',
          'TENANT_STATUS_CONFLICT',
        );
      }
      if (status === 'active') this.assertTenantHasActiveOwner(tenantId);
      const now = this.now();
      this.stmts.updateTenantStatus.run(
        status,
        now,
        status === 'suspended' ? now : null,
        tenantId,
      );
      return this.requireTenant(tenantId);
    });
  }

  private changeMembershipStatus(
    membershipId: string,
    status: Extract<TenantMembershipStatus, 'active' | 'suspended'>,
  ): TenantMembershipRecord {
    const tenantId = this.requireMembershipTenantHint(membershipId);
    return this.mutation(() => {
      this.lockTenant(tenantId);
      const current = this.requireMembership(membershipId);
      if (current.status === status) return current;
      if (current.status === 'removed') {
        throw new TenancyError(
          'A removed membership requires an explicit re-admission flow',
          'TENANT_MEMBERSHIP_STATUS_CONFLICT',
        );
      }
      if (status === 'active' && current.roleKey === TENANT_OWNER_ROLE_KEY
        && !this.stmts.tokenEligibleUserExists.get(current.userId)) {
        throw new TenancyError(
          'Ownership target must be able to authenticate',
          'TENANT_OWNERSHIP_TARGET_INVALID',
        );
      }
      this.assertCanLoseActiveOwner(current, status, current.roleKey);
      const now = this.now();
      this.stmts.updateMembershipStatus.run(
        status,
        now,
        status === 'suspended' ? now : null,
        null,
        membershipId,
      );
      return this.requireMembership(membershipId);
    });
  }

  private assertCanLoseActiveOwner(
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

  private assertTenantHasAnotherActiveOwner(
    tenantId: string,
    currentMembershipId: string,
  ): void {
    const { count } = this.stmts.countOtherActiveOwners.get(
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

  private assertTenantHasActiveOwner(tenantId: string): void {
    const { count } = this.stmts.countActiveOwners.get(
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

  private mutation<T>(operation: () => T): T {
    return this.db.transaction(() => {
      // ReactiveDB begins an immediate transaction, so this generation check
      // cannot race a profile transition committed by another connection.
      this.assertCurrentProfile();
      return operation();
    });
  }

  private lockTenant(tenantId: string): void {
    const result = this.stmts.lockTenant.run(tenantId);
    if (result.changes !== 1) {
      throw new TenancyError('Tenant not found', 'TENANT_NOT_FOUND');
    }
  }

  private requireUser(userId: string): void {
    if (!this.stmts.userExists.get(userId)) {
      throw new TenancyError(`User not found: ${userId}`, 'TENANT_USER_NOT_FOUND');
    }
  }

  private requireTenant(tenantId: string): TenantRecord {
    const tenant = this.getTenant(tenantId);
    if (!tenant) throw new TenancyError('Tenant not found', 'TENANT_NOT_FOUND');
    return tenant;
  }

  private requireMembership(membershipId: string): TenantMembershipRecord {
    const membership = this.getMembershipById(membershipId);
    if (!membership) {
      throw new TenancyError('Tenant membership not found', 'TENANT_MEMBERSHIP_NOT_FOUND');
    }
    return membership;
  }

  private requireMembershipTenantHint(membershipId: string): string {
    const row = this.stmts.getMembershipTenantHint.get(membershipId) as {
      tenant_id: string;
    } | null;
    if (!row) {
      throw new TenancyError('Tenant membership not found', 'TENANT_MEMBERSHIP_NOT_FOUND');
    }
    return row.tenant_id;
  }

  private getTenantByCanonicalSlug(slug: string): TenantRecord | null {
    const row = this.stmts.getTenantBySlug.get(slug) as TenantRow | null;
    return row ? mapTenant(row) : null;
  }
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
