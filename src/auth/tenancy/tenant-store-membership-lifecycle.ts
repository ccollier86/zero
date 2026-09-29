import { AuthError } from '../types';
import { canonicalizeTenantRoleKey } from './tenancy-canonicalization';
import { TenantStoreContext } from './tenant-store-context';
import {
  TENANT_OWNER_ROLE_KEY,
  TenancyError,
  type CreateTenantMembershipInput,
  type TenantMembershipRecord,
  type TenantMembershipStatus,
  type TenantOwnershipTransferResult,
} from './tenancy-types';

/** Coordinates retained-membership and protected-ownership lifecycle changes. */
export class TenantStoreMembershipLifecycle {
  constructor(private readonly context: TenantStoreContext) {}

  createMembership(input: CreateTenantMembershipInput): TenantMembershipRecord {
    const roleKey = canonicalizeTenantRoleKey(input.roleKey);
    const membershipId = this.context.createMembershipId();
    const now = this.context.now();

    try {
      return this.context.mutation(() => {
        this.context.lockTenant(input.tenantId);
        const tenant = this.context.requireTenant(input.tenantId);
        if (tenant.status !== 'active') {
          throw new TenancyError(
            'Cannot create an active membership in a non-active tenant',
            'TENANT_NOT_ACTIVE',
          );
        }
        this.context.requireUser(input.userId);
        this.context.requireUser(input.createdBy);
        if (roleKey === TENANT_OWNER_ROLE_KEY
          && !this.context.statements.tokenEligibleUserExists.get(input.userId)) {
          throw new TenancyError(
            'Ownership target must be able to authenticate',
            'TENANT_OWNERSHIP_TARGET_INVALID',
          );
        }
        const existing = this.context.getMembership(input.tenantId, input.userId);
        if (existing) {
          throw new TenancyError(
            'A retained membership already exists for this tenant and user',
            'TENANT_MEMBERSHIP_EXISTS',
          );
        }
        this.context.statements.insertMembership.run(
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
          this.context.notifyOwnerCreated({
            tenantId: input.tenantId,
            membershipId,
            userId: input.userId,
            createdBy: input.createdBy,
            createdAt: now,
          });
        }
        return this.context.requireMembership(membershipId);
      });
    } catch (error) {
      if (error instanceof AuthError) throw error;
      if (!(error instanceof TenancyError)
        && this.context.getMembership(input.tenantId, input.userId)) {
        throw new TenancyError(
          'A retained membership already exists for this tenant and user',
          'TENANT_MEMBERSHIP_EXISTS',
        );
      }
      throw error;
    }
  }

  suspendMembership(membershipId: string): TenantMembershipRecord {
    return this.changeMembershipStatus(membershipId, 'suspended');
  }

  reactivateMembership(membershipId: string): TenantMembershipRecord {
    return this.changeMembershipStatus(membershipId, 'active');
  }

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
    const tenantId = this.context.requireMembershipTenantHint(membershipId);
    return this.context.mutation(() => {
      this.context.lockTenant(tenantId);
      const tenant = this.context.requireTenant(tenantId);
      const current = this.context.requireMembership(membershipId);
      if (tenant.status !== 'active') {
        throw new TenancyError(
          'Cannot re-admit a membership to a non-active tenant',
          'TENANT_NOT_ACTIVE',
        );
      }
      if (!this.context.statements.activeUserExists.get(current.userId)) {
        throw new TenancyError(
          'Membership user is not active',
          'TENANT_USER_NOT_FOUND',
        );
      }
      if (current.status === 'active') return current;
      const changedAt = this.context.now();
      this.context.statements.readmitMembership.run(roleKey, changedAt, membershipId);
      if (current.roleKey === TENANT_OWNER_ROLE_KEY) {
        this.context.notifyOwnerRoleChanged({
          tenantId,
          membershipId,
          userId: current.userId,
          previousRoleKey: TENANT_OWNER_ROLE_KEY,
          roleKey,
          changedAt,
        });
      }
      return this.context.requireMembership(membershipId);
    });
  }

  removeMembership(membershipId: string): TenantMembershipRecord {
    const tenantId = this.context.requireMembershipTenantHint(membershipId);
    return this.context.mutation(() => {
      this.context.lockTenant(tenantId);
      const current = this.context.requireMembership(membershipId);
      if (current.status === 'removed') return current;
      this.context.assertCanLoseActiveOwner(current, 'removed', current.roleKey);
      const now = this.context.now();
      this.context.statements.updateMembershipStatus.run(
        'removed',
        now,
        null,
        now,
        membershipId,
      );
      return this.context.requireMembership(membershipId);
    });
  }

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
    const tenantId = this.context.requireMembershipTenantHint(currentOwnerMembershipId);
    const demotedRoleKey = canonicalizeTenantRoleKey(demotedRoleKeyInput);
    if (demotedRoleKey === TENANT_OWNER_ROLE_KEY) {
      throw new TenancyError(
        'The previous owner must receive a non-owner role',
        'TENANT_OWNERSHIP_TARGET_INVALID',
      );
    }

    return this.context.mutation(() => {
      this.context.lockTenant(tenantId);
      const current = this.context.requireMembership(currentOwnerMembershipId);
      const target = this.context.requireMembership(targetMembershipId);
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
        || !this.context.statements.tokenEligibleUserExists.get(target.userId)) {
        throw new TenancyError(
          'Ownership target must be an active member who can authenticate',
          'TENANT_OWNERSHIP_TARGET_INVALID',
        );
      }

      const changedAt = this.context.now();
      if (target.roleKey !== TENANT_OWNER_ROLE_KEY) {
        this.context.statements.updateMembershipRole.run(
          TENANT_OWNER_ROLE_KEY,
          changedAt,
          targetMembershipId,
        );
        this.context.notifyOwnerRoleChanged({
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
      this.context.assertCanLoseActiveOwner(current, 'active', demotedRoleKey);
      this.context.statements.updateMembershipRole.run(
        demotedRoleKey,
        changedAt,
        currentOwnerMembershipId,
      );
      this.context.notifyOwnerRoleChanged({
        tenantId,
        membershipId: current.membershipId,
        userId: current.userId,
        previousRoleKey: TENANT_OWNER_ROLE_KEY,
        roleKey: demotedRoleKey,
        changedAt,
      });

      return {
        previousOwnerMembership: this.context.requireMembership(currentOwnerMembershipId),
        ownerMembership: this.context.requireMembership(targetMembershipId),
      };
    });
  }

  updateMembershipRole(
    membershipId: string,
    roleKeyInput: string,
  ): TenantMembershipRecord {
    const roleKey = canonicalizeTenantRoleKey(roleKeyInput);
    const tenantId = this.context.requireMembershipTenantHint(membershipId);

    return this.context.mutation(() => {
      this.context.lockTenant(tenantId);
      const current = this.context.requireMembership(membershipId);
      if (current.roleKey === roleKey) return current;
      if (roleKey === TENANT_OWNER_ROLE_KEY) {
        throw new TenancyError(
          'Owner authority requires explicit ownership transfer',
          'TENANT_OWNERSHIP_REQUIRED',
        );
      }
      this.context.assertCanLoseActiveOwner(current, current.status, roleKey);
      const changedAt = this.context.now();
      this.context.statements.updateMembershipRole.run(roleKey, changedAt, membershipId);
      if (current.roleKey === TENANT_OWNER_ROLE_KEY
        || roleKey === TENANT_OWNER_ROLE_KEY) {
        this.context.notifyOwnerRoleChanged({
          tenantId,
          membershipId,
          userId: current.userId,
          previousRoleKey: current.roleKey,
          roleKey,
          changedAt,
        });
      }
      return this.context.requireMembership(membershipId);
    });
  }

  bumpMembershipAuthorizationGeneration(
    membershipId: string,
  ): TenantMembershipRecord {
    const tenantId = this.context.requireMembershipTenantHint(membershipId);
    return this.context.mutation(() => {
      this.context.lockTenant(tenantId);
      this.context.requireMembership(membershipId);
      this.context.statements.bumpMembershipGeneration.run(
        this.context.now(),
        membershipId,
      );
      return this.context.requireMembership(membershipId);
    });
  }

  private changeMembershipStatus(
    membershipId: string,
    status: Extract<TenantMembershipStatus, 'active' | 'suspended'>,
  ): TenantMembershipRecord {
    const tenantId = this.context.requireMembershipTenantHint(membershipId);
    return this.context.mutation(() => {
      this.context.lockTenant(tenantId);
      const current = this.context.requireMembership(membershipId);
      if (current.status === status) return current;
      if (current.status === 'removed') {
        throw new TenancyError(
          'A removed membership requires an explicit re-admission flow',
          'TENANT_MEMBERSHIP_STATUS_CONFLICT',
        );
      }
      if (status === 'active' && current.roleKey === TENANT_OWNER_ROLE_KEY
        && !this.context.statements.tokenEligibleUserExists.get(current.userId)) {
        throw new TenancyError(
          'Ownership target must be able to authenticate',
          'TENANT_OWNERSHIP_TARGET_INVALID',
        );
      }
      this.context.assertCanLoseActiveOwner(current, status, current.roleKey);
      const now = this.context.now();
      this.context.statements.updateMembershipStatus.run(
        status,
        now,
        status === 'suspended' ? now : null,
        null,
        membershipId,
      );
      return this.context.requireMembership(membershipId);
    });
  }
}
