import type { ReactiveDB } from '../sync/reactive-db';
import type { AuthAuditService } from './auth-audit-service';
import type { AuthorizationKernel } from './authorization-kernel';
import { AuthorizationRoleStore } from './authorization-role-store';
import {
  AuthorizationRoleAssignmentError,
  type RegistrationProvisioningAuthorityInput,
  type RollbackProvisionalApplicationOwnerInput,
} from './authorization-role-types';
import { canUserReceiveAuthTokens } from './auth-user-eligibility';
import type { TenancyService } from './tenancy/tenancy-service';
import type { UserStore } from './user-store';

/**
 * Internal owner/provisioning lifecycle for advanced authorization profiles.
 *
 * Registration bootstrap, installed-app adoption, and protected tenant-owner
 * repair deliberately live behind the public AuthorizationRoleService facade.
 * Keeping these system-only transitions together prevents ordinary role
 * assignment APIs from acquiring migration and provisioning responsibilities.
 */
export class AuthorizationRoleProvisioningService {
  constructor(
    private readonly db: ReactiveDB,
    private readonly store: AuthorizationRoleStore,
    private readonly kernel: AuthorizationKernel,
    private readonly users: UserStore,
    private readonly tenancy: TenancyService | null,
    private readonly audit?: AuthAuditService,
  ) {}

  /** Install the protected first application owner during single-mode bootstrap. */
  establishBootstrapOwner(userId: string, registrationId?: string): void {
    if (!this.isProfile('single')) return;
    if (registrationId) {
      this.requireActiveUser(userId);
      if (!this.store.hasPendingApplicationBootstrapReceipt(userId, registrationId)) {
        throw new AuthorizationRoleAssignmentError(
          'Application bootstrap owner is not bound to the active registration',
          'AUTHORIZATION_OWNERSHIP_TARGET_INVALID',
        );
      }
    } else {
      this.requireTokenEligibleUser(userId);
    }
    this.mutation(() => {
      const inserted = this.store.insertApplication({
        userId,
        roleKey: 'owner',
        source: 'bootstrap',
        sourceId: registrationId ?? 'installation-bootstrap',
        createdBy: userId,
      });
      if (inserted.changed) this.store.bumpApplicationGeneration(userId);
    });
  }

  /** Verify the exact pending application-owner graph before registration finalizes. */
  hasProvisionalApplicationOwner(
    input: RollbackProvisionalApplicationOwnerInput,
  ): boolean {
    if (!this.isProfile('single') || !input.userId || !input.registrationId) {
      return false;
    }
    return this.store.hasProvisionalApplicationOwner(
      input.userId,
      input.registrationId,
    );
  }

  /**
   * Verify that any protected authority created by a pending registration is
   * still present before the receipt can be finalized.
   */
  hasProvisionalRegistrationAuthority(
    input: RegistrationProvisioningAuthorityInput,
  ): boolean {
    if (!input.registrationId || !input.userId) return false;
    if (this.isProfile('single')) {
      if (input.tenantId !== null) return false;
      return !input.isBootstrap
        || this.store.hasProvisionalApplicationOwner(
          input.userId,
          input.registrationId,
        );
    }
    if (this.isProfile('multi')) {
      if (input.isBootstrap && input.tenantId === null) return false;
      return input.tenantId === null || this.store.hasProvisionalTenantOwner({
        registrationId: input.registrationId,
        tenantId: input.tenantId,
        userId: input.userId,
      });
    }
    return false;
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
    this.requireProfile('single');
    if (!input.userId || !input.registrationId) return false;
    return this.mutation(() => {
      if (!this.store.hasPendingApplicationBootstrapReceipt(
        input.userId,
        input.registrationId,
      )) return false;
      const changed = this.store.deleteProvisionalApplicationOwner(
        input.userId,
        input.registrationId,
      );
      if (changed) this.store.bumpApplicationGeneration(input.userId);
      if (changed) return true;
      // Recovery is idempotent if the exact pending row was already removed.
      // A mismatched live owner assignment remains a hard failure.
      return !this.store.getRetainedApplicationRoleKeys(input.userId).includes('owner');
    });
  }

  /**
   * Explicit, config-trusted adoption path for an already-installed
   * single/advanced app. No global administrator is guessed implicitly.
   */
  adoptApplicationOwner(selector: { userId?: string; email?: string }): {
    userId: string;
    changed: boolean;
  } {
    this.requireProfile('single');
    return this.mutation(() => {
      const user = selector.userId
        ? this.users.getUserById(selector.userId)
        : selector.email
          ? this.users.getUserByEmail(selector.email)
          : null;
      if (!user) {
        throw new AuthorizationRoleAssignmentError(
          'Configured application owner adoption target was not found or was ambiguous',
          'AUTHORIZATION_SUBJECT_NOT_FOUND',
        );
      }
      if (!canUserReceiveAuthTokens(user)) throw ownershipTargetInvalid();
      if (this.store.hasRetainedApplicationRole('owner')) {
        if (this.store.getRetainedApplicationRoleKeys(user.userId).includes('owner')) {
          return { userId: user.userId, changed: false };
        }
        throw new AuthorizationRoleAssignmentError(
          'Application owner adoption is only available while the installation is ownerless',
          'AUTHORIZATION_OWNERSHIP_TARGET_INVALID',
        );
      }
      const inserted = this.store.insertApplication({
        userId: user.userId,
        roleKey: 'owner',
        source: 'migration',
        sourceId: 'configured-owner-adoption',
        createdBy: user.userId,
      });
      if (inserted.changed) {
        this.store.bumpApplicationGeneration(user.userId);
        this.audit?.append({
          action: 'application.ownership-adopted',
          outcome: 'succeeded',
          scope: { kind: 'application' },
          actor: { provenance: 'system' },
          target: { type: 'user', id: user.userId },
        });
      }
      return { userId: user.userId, changed: inserted.changed };
    });
  }

  hasActiveApplicationOwner(): boolean {
    return this.isProfile('single')
      && this.store.hasActiveApplicationRole('owner');
  }

  /** Retained owner rows include the deliberate pre-verification bootstrap window. */
  hasRetainedApplicationOwner(): boolean {
    return this.isProfile('single')
      && this.store.hasRetainedApplicationRole('owner');
  }

  /**
   * Registration intent outlives provisioning until the delivered email is
   * consumed, and is the only accepted transitional ineligible-owner state.
   */
  hasPendingApplicationOwnerVerification(): boolean {
    return this.isProfile('single')
      && this.store.hasPendingApplicationOwnerVerification();
  }

  /** Install a protected tenant owner inside the caller's tenant transaction. */
  establishTenantOwner(input: {
    tenantId: string;
    membershipId: string;
    userId: string;
    createdBy: string;
    createdAt: number;
  }): void {
    if (!this.isProfile('multi')) return;
    this.mutation(() => {
      const user = this.requireUser(input.userId);
      if (!canUserReceiveAuthTokens(user)
        && !this.users.hasPendingRegistrationProvisioning(input.userId)) {
        throw ownershipTargetInvalid();
      }
      this.store.insertTenant({
        ...input,
        roleKey: 'owner',
        source: 'system',
        sourceId: 'tenant-creation',
      });
    });
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
    if (!this.isProfile('multi')) return;
    this.mutation(() => {
      if (input.roleKey === 'owner') {
        this.store.insertTenant({
          tenantId: input.tenantId,
          membershipId: input.membershipId,
          userId: input.userId,
          roleKey: 'owner',
          source: 'system',
          sourceId: 'tenant-owner-role-transition',
          createdBy: input.userId,
          createdAt: input.changedAt,
        });
        return;
      }
      if (input.previousRoleKey === 'owner') {
        this.store.revokeTenantSystemRole(
          input.tenantId,
          input.membershipId,
          'owner',
          input.userId,
          input.changedAt,
        );
      }
    });
  }

  reconcileProtectedTenantOwners(): number {
    if (!this.isProfile('multi')) return 0;
    return this.mutation(() => {
      const repaired = this.store.reconcileProtectedTenantOwners();
      if (repaired > 0) {
        this.audit?.append({
          action: 'application.tenant-owner-roles-reconciled',
          outcome: 'succeeded',
          scope: { kind: 'application' },
          actor: { provenance: 'system' },
          target: { type: 'tenant-owner-assignments' },
          metadata: { count: repaired },
        });
      }
      return repaired;
    });
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
    this.requireProfile('multi');
    if (!this.tenancy) {
      throw new Error('[auth] Multi-tenant role adoption requires tenancy services.');
    }
    const tenancy = this.tenancy;
    return this.mutation(() => {
      if (this.store.countTenantAssignmentHistory() > 0) {
        throw new Error(
          '[auth] Cannot adopt multi/simple membership roles because advanced '
            + 'tenant assignment history already exists. Restore the last known '
            + 'profile and inspect the authority graph before startup.',
        );
      }
      const memberships = this.store.listRetainedSimpleMembershipRoles();
      const invalid = memberships.filter((membership) => !membership.roleKey
        || !this.kernel.authorization.roles[membership.roleKey]);
      if (invalid.length > 0) {
        const details = invalid.slice(0, 5).map((membership) =>
          `${membership.membershipId}=${membership.roleKey ?? '<null>'}`,
        ).join(', ');
        throw new Error(
          '[auth] Cannot upgrade multi/simple to multi/advanced because retained '
            + `membership roles are undeclared or retired: ${details}. Restore `
            + 'those exact role templates in auth.authorization.roles, start '
            + 'the upgrade once, then change assignments through the advanced '
            + 'role administration API.',
        );
      }

      let assignments = 0;
      for (const membership of memberships) {
        const inserted = this.store.insertTenant({
          tenantId: membership.tenantId,
          membershipId: membership.membershipId,
          userId: membership.userId,
          roleKey: membership.roleKey!,
          source: 'migration',
          sourceId: 'multi-simple-profile-adoption-v1',
          createdBy: null,
        });
        if (inserted.changed) assignments += 1;
      }
      // Every retained candidate may have a session minted under simple-mode
      // semantics. Advance each authority generation exactly once with the profile transition,
      // including owners and suspended memberships. Durable browser/native
      // parents are atomically rebound to that exact new generation so a
      // preserved effective role does not force a sign-in; incomplete native
      // grants are cleared because they cannot be safely rebased.
      for (const membership of memberships) {
        const current = tenancy.bumpMembershipAuthorizationGeneration(
          membership.membershipId,
        );
        this.store.rebindAdoptedMembershipSessions({
          tenantId: membership.tenantId,
          membershipId: membership.membershipId,
          userId: membership.userId,
          membershipAuthorizationGeneration: current.authorizationGeneration,
        });
      }
      return Object.freeze({ memberships: memberships.length, assignments });
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
