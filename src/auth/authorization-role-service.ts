import type { ReactiveDB } from '../sync/reactive-db';
import {
  expandAuthorizationRolesForScope,
  type AuthorizationKernel,
} from './authorization-kernel';
import { AuthorizationRoleStore } from './authorization-role-store';
import {
  AuthorizationRoleAssignmentError,
  type AssignApplicationRoleInput,
  type AssignTenantRoleInput,
  type AuthorizationRoleAssignmentRecord,
  type AuthorizationRegistrySnapshot,
  type AuthorizationRoleSet,
  type ApplicationOwnershipTransferResult,
  type ExpandedAuthorizationRoleSet,
  type RegistrationProvisioningAuthorityInput,
  type RemoveApplicationRoleInput,
  type RemoveTenantRoleInput,
  type ReplaceApplicationRolesInput,
  type RollbackProvisionalApplicationOwnerInput,
  type TransferApplicationOwnershipInput,
} from './authorization-role-types';
import type { TenancyService } from './tenancy/tenancy-service';
import type { UserStore } from './user-store';
import type { AuthAuditService } from './auth-audit-service';
import { canUserReceiveAuthTokens } from './auth-user-eligibility';
import {
  isRoleAssignableToTenantKind,
} from './authorization-registry';
import { AuthorizationRoleProvisioningService } from './authorization-role-provisioning-service';

/**
 * Headless app-local advanced RBAC control plane.
 *
 * HTTP/UI adapters must authorize the actor before calling these methods. This
 * service derives every subject/scope from server-owned rows, rejects protected
 * system roles, and owns generation invalidation with each assignment write.
 */
export class AuthorizationRoleService {
  private readonly provisioning: AuthorizationRoleProvisioningService;

  constructor(
    private readonly db: ReactiveDB,
    private readonly store: AuthorizationRoleStore,
    readonly kernel: AuthorizationKernel,
    private readonly users: UserStore,
    private readonly tenancy: TenancyService | null,
    audit?: AuthAuditService,
  ) {
    this.provisioning = new AuthorizationRoleProvisioningService(
      db,
      store,
      kernel,
      users,
      tenancy,
      audit,
    );
  }

  resolveApplicationRoles(userId: string): AuthorizationRoleSet | null {
    if (!this.isProfile('single')) return null;
    const user = this.users.getUserById(userId);
    if (!user || user.status !== 'active') return null;
    return this.store.getApplicationRoleSet(userId);
  }

  /** Detailed static ceiling for authenticated application/admin UI. */
  getRegistry(): AuthorizationRegistrySnapshot {
    return Object.freeze({
      permissions: this.kernel.authorization.permissions,
      roles: Object.freeze(Object.fromEntries(
        Object.entries(this.kernel.authorization.roles).map(([key, role]) => [
          key,
          Object.freeze({ ...role, assignable: !role.system }),
        ]),
      )),
    });
  }

  resolveTenantRoles(input: {
    tenantId: string;
    membershipId: string;
    userId: string;
  }): AuthorizationRoleSet | null {
    if (!this.isProfile('multi')) return null;
    const tenant = this.tenancy?.getTenant(input.tenantId);
    if (!tenant || tenant.status !== 'active') return null;
    const set = this.store.getTenantRoleSet(
      input.tenantId,
      input.membershipId,
      input.userId,
    );
    if (!set) return set;

    // A role retained from an older configuration remains visible to the
    // control plane for cleanup, but becomes inert when it does not belong to
    // the live tenant kind. This protects both directions: administration
    // roles cannot leak into customer organizations, and customer roles cannot
    // accidentally confer authority inside the administration organization.
    const roles = set.roles.filter((roleKey) => (
      roleKey === 'owner'
      || isRoleAssignableToTenantKind(
        roleKey,
        tenant.kind,
        this.kernel.authorization,
      )
    ));
    return Object.freeze({
      ...set,
      roles: Object.freeze(roles),
    });
  }

  /** Retained live assignment keys for an application-control-plane projection. */
  getRetainedApplicationRoleKeys(userId: string): readonly string[] {
    this.requireProfile('single');
    this.requireUser(userId);
    return this.store.getRetainedApplicationRoleKeys(userId);
  }

  /** Retained keys plus revision, including for suspended control-plane subjects. */
  getRetainedApplicationRoleSet(userId: string): AuthorizationRoleSet {
    this.requireProfile('single');
    this.requireUser(userId);
    return this.store.getApplicationRoleSet(userId);
  }

  /**
   * Read retained active assignment rows for control-plane display.
   * Suspended/removed memberships confer no authority, but their assignment
   * history still needs an accurate administrative projection.
   */
  getRetainedTenantRoleKeys(input: {
    tenantId: string;
    membershipId: string;
    userId: string;
  }): readonly string[] {
    this.requireProfile('multi');
    const membership = this.tenancy?.getMembershipById(input.membershipId);
    if (!membership
      || membership.tenantId !== input.tenantId
      || membership.userId !== input.userId) {
      throw new AuthorizationRoleAssignmentError(
        'Authorization subject does not belong to the requested tenant',
        'AUTHORIZATION_SCOPE_MISMATCH',
      );
    }
    return this.store.getRetainedTenantRoleKeys(
      input.tenantId,
      input.membershipId,
      input.userId,
    );
  }

  /** Retained tenant keys plus revision for optimistic administration writes. */
  getRetainedTenantRoleSet(input: {
    tenantId: string;
    membershipId: string;
    userId: string;
  }): AuthorizationRoleSet {
    this.requireProfile('multi');
    const membership = this.tenancy?.getMembershipById(input.membershipId);
    if (!membership
      || membership.tenantId !== input.tenantId
      || membership.userId !== input.userId) {
      throw new AuthorizationRoleAssignmentError(
        'Authorization subject does not belong to the requested tenant',
        'AUTHORIZATION_SCOPE_MISMATCH',
      );
    }
    const retained = this.store.getRetainedTenantRoleSet(
      input.tenantId,
      input.membershipId,
      input.userId,
    );
    if (!retained) {
      throw new AuthorizationRoleAssignmentError(
        'Authorization subject does not belong to the requested tenant',
        'AUTHORIZATION_SCOPE_MISMATCH',
      );
    }
    return retained;
  }

  getExpandedApplicationRoles(userId: string): ExpandedAuthorizationRoleSet | null {
    const set = this.resolveApplicationRoles(userId);
    return set ? this.expand(set) : null;
  }

  getExpandedTenantRoles(input: {
    tenantId: string;
    membershipId: string;
    userId: string;
  }): ExpandedAuthorizationRoleSet | null {
    const set = this.resolveTenantRoles(input);
    return set ? this.expand(set) : null;
  }

  assignApplicationRole(input: AssignApplicationRoleInput): {
    assignment: AuthorizationRoleAssignmentRecord;
    authority: ExpandedAuthorizationRoleSet;
  } {
    this.requireProfile('single');
    this.requireAssignableRole(input.roleKey);
    return this.mutation(() => {
      this.requireActiveUser(input.userId);
      this.requireUser(input.createdBy);
      const inserted = this.store.insertApplication({
        userId: input.userId,
        roleKey: input.roleKey,
        source: 'manual',
        sourceId: input.sourceId,
        createdBy: input.createdBy,
      });
      if (inserted.changed) this.store.bumpApplicationGeneration(input.userId);
      return {
        assignment: inserted.assignment,
        authority: this.expand(this.store.getApplicationRoleSet(input.userId)),
      };
    });
  }

  removeApplicationRole(input: RemoveApplicationRoleInput): ExpandedAuthorizationRoleSet {
    this.requireProfile('single');
    this.requireAssignableRole(input.roleKey);
    return this.mutation(() => {
      this.requireUser(input.revokedBy);
      if (this.store.revokeApplication(input.userId, input.roleKey, input.revokedBy)) {
        this.store.bumpApplicationGeneration(input.userId);
      }
      return this.expand(this.store.getApplicationRoleSet(input.userId));
    });
  }

  /** Atomically replace every assignable application role, preserving system roles. */
  replaceApplicationRoles(
    input: ReplaceApplicationRolesInput,
  ): ExpandedAuthorizationRoleSet {
    this.requireProfile('single');
    const desired = [...new Set(input.roleKeys)].sort(compareKeys);
    for (const roleKey of desired) this.requireAssignableRole(roleKey);

    return this.mutation(() => {
      this.requireUser(input.changedBy);
      const target = this.requireUser(input.userId);
      const current = this.store.getRetainedApplicationRoleKeys(input.userId);
      const assignableCurrent = current.filter(
        (roleKey) => !this.kernel.authorization.roles[roleKey]?.system,
      );
      const desiredSet = new Set(desired);
      const currentSet = new Set(assignableCurrent);
      const hasGrant = desired.some((roleKey) => !currentSet.has(roleKey));
      if (hasGrant && target.status !== 'active') throw inactiveSubject();
      let changed = false;

      for (const roleKey of desired) {
        if (currentSet.has(roleKey)) continue;
        changed = this.store.insertApplication({
          userId: input.userId,
          roleKey,
          source: 'manual',
          sourceId: null,
          createdBy: input.changedBy,
        }).changed || changed;
      }
      for (const roleKey of assignableCurrent) {
        if (desiredSet.has(roleKey)) continue;
        changed = this.store.revokeApplication(
          input.userId,
          roleKey,
          input.changedBy,
        ) || changed;
      }
      if (changed) this.store.bumpApplicationGeneration(input.userId);
      return this.expand(this.store.getApplicationRoleSet(input.userId));
    });
  }

  /**
   * Move the protected application-owner role in one transaction.
   *
   * The target assignment is created before the prior owner is revoked so the
   * database-level last-owner guard remains true for the entire write.
   */
  transferApplicationOwnership(
    input: TransferApplicationOwnershipInput,
  ): ApplicationOwnershipTransferResult {
    this.requireProfile('single');
    if (input.ownerUserId === input.targetUserId) {
      throw ownershipTargetInvalid();
    }

    return this.mutation(() => {
      this.requireUser(input.changedBy);
      const owner = this.requireActiveUser(input.ownerUserId);
      const target = this.requireTokenEligibleUser(input.targetUserId);
      const ownerRoles = this.store.getRetainedApplicationRoleKeys(owner.userId);
      const targetRoles = this.store.getRetainedApplicationRoleKeys(target.userId);
      if (!ownerRoles.includes('owner')) {
        throw new AuthorizationRoleAssignmentError(
          'Application ownership is required for this operation',
          'AUTHORIZATION_OWNERSHIP_REQUIRED',
        );
      }
      if (targetRoles.includes('owner')) throw ownershipTargetInvalid();

      const inserted = this.store.insertApplication({
        userId: target.userId,
        roleKey: 'owner',
        source: 'system',
        sourceId: 'application-ownership-transfer',
        createdBy: input.changedBy,
      });
      if (!inserted.changed) throw ownershipTargetInvalid();
      this.store.bumpApplicationGeneration(target.userId);

      try {
        if (!this.store.revokeApplicationSystemRole(
          owner.userId,
          'owner',
          input.changedBy,
        )) {
          throw new AuthorizationRoleAssignmentError(
            'Application ownership changed before transfer completed',
            'AUTHORIZATION_OWNERSHIP_REQUIRED',
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('AUTH_LAST_ACTIVE_APPLICATION_OWNER')) {
          throw new AuthorizationRoleAssignmentError(
            'Cannot remove the last active application owner',
            'AUTHORIZATION_LAST_OWNER',
          );
        }
        throw error;
      }
      this.store.bumpApplicationGeneration(owner.userId);

      return Object.freeze({
        owner: this.expand(this.store.getApplicationRoleSet(target.userId)),
        previousOwner: this.expand(this.store.getApplicationRoleSet(owner.userId)),
      });
    });
  }

  assignTenantRole(input: AssignTenantRoleInput): {
    assignment: AuthorizationRoleAssignmentRecord;
    authority: ExpandedAuthorizationRoleSet;
  } {
    this.requireProfile('multi');
    return this.mutation(() => {
      this.requireUser(input.createdBy);
      const membership = this.requireActiveMembership(
        input.tenantId,
        input.membershipId,
      );
      this.requireAssignableTenantRole(input.roleKey, input.tenantId);
      const inserted = this.store.insertTenant({
        tenantId: input.tenantId,
        membershipId: input.membershipId,
        userId: membership.userId,
        roleKey: input.roleKey,
        source: 'manual',
        sourceId: input.sourceId,
        createdBy: input.createdBy,
      });
      if (inserted.changed) {
        this.tenancy!.bumpMembershipAuthorizationGeneration(input.membershipId);
      }
      const authority = this.store.getTenantRoleSet(
        input.tenantId,
        input.membershipId,
        membership.userId,
      );
      if (!authority) throw inactiveSubject();
      return { assignment: inserted.assignment, authority: this.expand(authority) };
    });
  }

  removeTenantRole(input: RemoveTenantRoleInput): ExpandedAuthorizationRoleSet {
    this.requireProfile('multi');
    this.requireAssignableRole(input.roleKey);
    return this.mutation(() => {
      this.requireUser(input.revokedBy);
      const membership = this.requireActiveMembership(
        input.tenantId,
        input.membershipId,
      );
      if (this.store.revokeTenant(
        input.tenantId,
        input.membershipId,
        input.roleKey,
        input.revokedBy,
      )) {
        this.tenancy!.bumpMembershipAuthorizationGeneration(input.membershipId);
      }
      const authority = this.store.getTenantRoleSet(
        input.tenantId,
        input.membershipId,
        membership.userId,
      );
      if (!authority) throw inactiveSubject();
      return this.expand(authority);
    });
  }

  /** Atomically replace every assignable tenant role, preserving system roles. */
  replaceTenantRoles(input: {
    tenantId: string;
    membershipId: string;
    roleKeys: readonly string[];
    changedBy: string;
  }): ExpandedAuthorizationRoleSet {
    this.requireProfile('multi');
    const desired = [...new Set(input.roleKeys)].sort(compareKeys);

    return this.mutation(() => {
      this.requireUser(input.changedBy);
      const membership = this.requireActiveMembership(
        input.tenantId,
        input.membershipId,
      );
      const current = this.store.getRetainedTenantRoleKeys(
        input.tenantId,
        input.membershipId,
        membership.userId,
      );
      const currentSet = new Set(current);
      for (const roleKey of desired) {
        if (!this.kernel.authorization.roles[roleKey]) {
          if (currentSet.has(roleKey)) continue;
        }
        this.requireAssignableTenantRole(roleKey, input.tenantId);
      }
      const assignableCurrent = current.filter(
        (roleKey) => !this.kernel.authorization.roles[roleKey]?.system,
      );
      const desiredSet = new Set(desired);
      const assignableCurrentSet = new Set(assignableCurrent);
      let changed = false;

      for (const roleKey of desired) {
        if (assignableCurrentSet.has(roleKey)) continue;
        changed = this.store.insertTenant({
          tenantId: input.tenantId,
          membershipId: input.membershipId,
          userId: membership.userId,
          roleKey,
          source: 'manual',
          sourceId: null,
          createdBy: input.changedBy,
        }).changed || changed;
      }
      for (const roleKey of assignableCurrent) {
        if (desiredSet.has(roleKey)) continue;
        changed = this.store.revokeTenant(
          input.tenantId,
          input.membershipId,
          roleKey,
          input.changedBy,
        ) || changed;
      }
      if (changed) {
        this.tenancy!.bumpMembershipAuthorizationGeneration(input.membershipId);
      }
      const authority = this.store.getTenantRoleSet(
        input.tenantId,
        input.membershipId,
        membership.userId,
      );
      if (!authority) throw inactiveSubject();
      return this.expand(authority);
    });
  }

  /** Install the protected first application owner during single-mode bootstrap. */
  establishBootstrapOwner(userId: string, registrationId?: string): void {
    this.provisioning.establishBootstrapOwner(userId, registrationId);
  }

  /** Verify the exact pending application-owner graph before registration finalizes. */
  hasProvisionalApplicationOwner(
    input: RollbackProvisionalApplicationOwnerInput,
  ): boolean {
    return this.provisioning.hasProvisionalApplicationOwner(input);
  }

  /**
   * Verify that any protected authority created by a pending registration is
   * still present before the receipt can be finalized.
   */
  hasProvisionalRegistrationAuthority(
    input: RegistrationProvisioningAuthorityInput,
  ): boolean {
    return this.provisioning.hasProvisionalRegistrationAuthority(input);
  }

  /**
   * Roll back the exact protected owner created by an unfinished registration.
   *
   * This is intentionally not a generic owner-removal API. The store and the
   * database trigger both require a matching pending provisioning receipt.
   */
  rollbackProvisionalApplicationOwner(
    input: RollbackProvisionalApplicationOwnerInput,
  ): boolean {
    return this.provisioning.rollbackProvisionalApplicationOwner(input);
  }

  /**
   * Explicit, config-trusted adoption path for an already-installed
   * single/advanced app. No global administrator is guessed implicitly.
   */
  adoptApplicationOwner(selector: { userId?: string; email?: string }): {
    userId: string;
    changed: boolean;
  } {
    return this.provisioning.adoptApplicationOwner(selector);
  }

  hasActiveApplicationOwner(): boolean {
    return this.provisioning.hasActiveApplicationOwner();
  }

  /** Retained owner rows include the deliberate pre-verification bootstrap window. */
  hasRetainedApplicationOwner(): boolean {
    return this.provisioning.hasRetainedApplicationOwner();
  }

  /**
   * Registration intent outlives provisioning until the delivered email is
   * consumed, and is the only accepted transitional ineligible-owner state.
   */
  hasPendingApplicationOwnerVerification(): boolean {
    return this.provisioning.hasPendingApplicationOwnerVerification();
  }

  /** Install a protected tenant owner inside the caller's tenant transaction. */
  establishTenantOwner(input: {
    tenantId: string;
    membershipId: string;
    userId: string;
    createdBy: string;
    createdAt: number;
  }): void {
    this.provisioning.establishTenantOwner(input);
  }

  /**
   * Keep the protected advanced owner assignment aligned with the retained
   * tenancy owner marker. TenantStore invokes this inside the same transaction,
   * so either both authority models change or neither does.
   */
  syncTenantOwnerRole(input: {
    tenantId: string;
    membershipId: string;
    userId: string;
    previousRoleKey: string | null;
    roleKey: string;
    changedAt: number;
  }): void {
    this.provisioning.syncTenantOwnerRole(input);
  }

  reconcileProtectedTenantOwners(): number {
    return this.provisioning.reconcileProtectedTenantOwners();
  }

  /**
   * Project retained multi/simple role keys into advanced assignment rows.
   *
   * The installed-profile gate calls this once, inside the same transaction
   * that commits the advanced marker. Validation is deliberately complete
   * before the first insert so an undeclared/retired role cannot partially
   * strip authority. Removed memberships are excluded because readmission is
   * an explicit new-role ceremony; suspended memberships retain their role.
   */
  adoptSimpleTenantMembershipRoles(): Readonly<{
    memberships: number;
    assignments: number;
  }> {
    return this.provisioning.adoptSimpleTenantMembershipRoles();
  }

  private expand(set: AuthorizationRoleSet): ExpandedAuthorizationRoleSet {
    // A removed template makes its retained assignment inert. Keeping the key
    // visible lets the owner reconcile it without granting stale authority.
    const expanded = expandAuthorizationRolesForScope(
      this.kernel.authorization,
      set.roles,
      set.scopeKind,
    );
    return Object.freeze({
      ...set,
      roles: Object.freeze([...set.roles]),
      permissions: expanded.permissions,
      allPermissions: expanded.allPermissions,
    });
  }

  private mutation<T>(operation: () => T): T {
    return this.db.transaction(() => {
      // The assertion runs after BEGIN IMMEDIATE, so a request that entered an
      // old runtime before adoption cannot commit an old-profile role write
      // after the installed generation changes.
      this.users.assertCurrentProfile();
      return operation();
    });
  }

  private requireAssignableRole(roleKey: string) {
    const role = this.kernel.authorization.roles[roleKey];
    if (!role) {
      throw new AuthorizationRoleAssignmentError(
        `Authorization role is not declared: ${roleKey}`,
        'AUTHORIZATION_ROLE_UNDECLARED',
      );
    }
    if (role.system) {
      throw new AuthorizationRoleAssignmentError(
        `Authorization role requires a dedicated protected lifecycle: ${roleKey}`,
        'AUTHORIZATION_SYSTEM_ROLE_PROTECTED',
      );
    }
    return role;
  }

  private requireAssignableTenantRole(roleKey: string, tenantId: string) {
    const role = this.requireAssignableRole(roleKey);
    const tenant = this.tenancy?.getTenant(tenantId);
    if (!tenant) {
      throw new AuthorizationRoleAssignmentError(
        'Authorization subject does not belong to the requested tenant',
        'AUTHORIZATION_SCOPE_MISMATCH',
      );
    }
    if (!isRoleAssignableToTenantKind(
      roleKey,
      tenant.kind,
      this.kernel.authorization,
    )) {
      if (tenant.kind === 'administration') {
        throw new AuthorizationRoleAssignmentError(
          `Administration organization memberships require an administration role: ${roleKey}`,
          'AUTHORIZATION_ADMINISTRATION_ROLE_REQUIRED',
        );
      }
      throw new AuthorizationRoleAssignmentError(
        `Authorization role requires the administration organization: ${roleKey}`,
        'AUTHORIZATION_ADMINISTRATION_SCOPE_REQUIRED',
      );
    }
    return role;
  }

  private requireActiveMembership(tenantId: string, membershipId: string) {
    const membership = this.tenancy?.getMembershipById(membershipId);
    const tenant = this.tenancy?.getTenant(tenantId);
    if (!membership || membership.tenantId !== tenantId || !tenant) {
      throw new AuthorizationRoleAssignmentError(
        'Authorization subject does not belong to the requested tenant',
        'AUTHORIZATION_SCOPE_MISMATCH',
      );
    }
    if (membership.status !== 'active' || tenant.status !== 'active') {
      throw inactiveSubject();
    }
    return membership;
  }

  private requireActiveUser(userId: string) {
    const user = this.requireUser(userId);
    if (user.status !== 'active') throw inactiveSubject();
    return user;
  }

  private requireTokenEligibleUser(userId: string) {
    const user = this.requireUser(userId);
    if (user.status !== 'active') throw inactiveSubject();
    if (!canUserReceiveAuthTokens(user)) throw ownershipTargetInvalid();
    return user;
  }

  private requireUser(userId: string) {
    const user = this.users.getUserById(userId);
    if (!user) {
      throw new AuthorizationRoleAssignmentError(
        'Authorization subject was not found',
        'AUTHORIZATION_SUBJECT_NOT_FOUND',
      );
    }
    return user;
  }

  private requireProfile(tenancy: 'single' | 'multi'): void {
    if (!this.isProfile(tenancy)) {
      throw new AuthorizationRoleAssignmentError(
        `Advanced ${tenancy}-tenant authorization is not enabled`,
        'AUTHORIZATION_ADVANCED_REQUIRED',
      );
    }
  }

  private isProfile(tenancy: 'single' | 'multi'): boolean {
    return this.kernel.authorization.mode === 'advanced'
      && this.kernel.tenancy.mode === tenancy;
  }
}

function inactiveSubject(): AuthorizationRoleAssignmentError {
  return new AuthorizationRoleAssignmentError(
    'Authorization subject is not active',
    'AUTHORIZATION_SUBJECT_INACTIVE',
  );
}

function ownershipTargetInvalid(): AuthorizationRoleAssignmentError {
  return new AuthorizationRoleAssignmentError(
    'Application ownership target is invalid',
    'AUTHORIZATION_OWNERSHIP_TARGET_INVALID',
  );
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
