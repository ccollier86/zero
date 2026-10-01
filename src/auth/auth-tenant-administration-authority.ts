import type { AuthPlatformCodeEmitter } from './auth-observability';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';
import {
  tenantAdministrationForbidden,
  tenantMemberNotFound,
} from './auth-tenant-administration-errors';
import type {
  AssertAuthTenantMutationAuthority,
  AuthTenantMutationAuthority,
} from './auth-tenant-mutation-authority';
import type { PermissionKey } from './types';
import type { UserStore } from './user-store';
import type { TenancyService } from './tenancy/tenancy-service';
import type { TenantMembershipRecord } from './tenancy/tenancy-types';

/** Commit-boundary authority and tenant relationship checks shared by the control plane. */
export class AuthTenantAdministrationAuthority {
  constructor(
    private readonly users: UserStore,
    private readonly tenancy: TenancyService,
    private readonly emitCode?: AuthPlatformCodeEmitter,
  ) {}

  assertCurrentProfile(): void {
    this.users.assertCurrentProfile();
  }

  requireMutationAuthority(
    tenantId: string,
    assertion: AssertAuthTenantMutationAuthority,
    permissions: readonly PermissionKey[],
  ): AuthTenantMutationAuthority {
    const authority = this.invoke(assertion, permissions);
    if (authority.scope.tenantId !== tenantId) throw tenantAdministrationForbidden();
    if (authority.platformAdministration === true) {
      if (authority.auth.tenantKind !== 'administration'
        || authority.applicationScope?.scopeKind !== 'application') {
        throw tenantAdministrationForbidden();
      }
      const target = this.tenancy.getTenant(tenantId);
      if (!target || target.kind !== 'organization' || target.status !== 'active') {
        throw tenantAdministrationForbidden();
      }
      return authority;
    }
    this.requireActorMembership(
      tenantId,
      authority.scope.membershipId,
      authority.auth.userId,
    );
    return authority;
  }

  invoke(
    assertion: AssertAuthTenantMutationAuthority,
    permissions: readonly PermissionKey[],
  ): AuthTenantMutationAuthority {
    return invokeSynchronousAuthCallback(
      () => assertion(permissions),
      {
        component: 'auth-tenant-administration-service',
        invariant: 'authority-callback-async',
        message: '[auth] Tenant administration authority callback must be synchronous.',
        emitCode: this.emitCode,
      },
    );
  }

  requireActorMembership(
    tenantId: string,
    membershipId: string,
    userId: string,
  ): TenantMembershipRecord {
    this.requireActiveTenant(tenantId);
    const membership = this.requireTenantMembership(tenantId, membershipId);
    if (membership.userId !== userId || membership.status !== 'active') {
      throw tenantAdministrationForbidden();
    }
    return membership;
  }

  requireTenantMembership(
    tenantId: string,
    membershipId: string,
  ): TenantMembershipRecord {
    const membership = this.tenancy.getMembershipById(membershipId);
    if (!membership || membership.tenantId !== tenantId) throw tenantMemberNotFound();
    return membership;
  }

  requireActiveTenant(tenantId: string): void {
    const tenant = this.tenancy.getTenant(tenantId);
    if (!tenant || tenant.status !== 'active') throw tenantAdministrationForbidden();
  }
}
