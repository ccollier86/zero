/** Offline notification eligibility from current server-owned Guardian rows. This creates no credential/session and grants no transcript access. */
import type { ServiceDataScope } from '../auth/service-data-scope';
import type { UserStore } from '../auth/user-store';
import type { TenancyService } from '../auth/tenancy';
import type { AuthorizationKernel, AccessRequirement } from '../auth/authorization-kernel';
import { createRequestAuthorizationAccess, type AuthorizationRoleAssignmentResolver } from '../auth/authorization-access';
import { AuthError, type AuthContext } from '../auth/types';

/** Only current role/property policy is tested; recipients still need canonical conversation authorization when opening the generic notice. */
export function createMessagingRecipientPolicy(input: { users: UserStore; tenancy: TenancyService | null; kernel: AuthorizationKernel; roles: AuthorizationRoleAssignmentResolver | null;
  support: false | { readonly staff: AccessRequirement }; assertCurrent(): void }): (scope: ServiceDataScope, userId: string) => boolean {
  const permits = createMessagingAccessPolicy(input);
  return (scope, userId) => input.support !== false && permits(scope, userId, input.support.staff);
}
/** Reuses Guardian's exact current role/property semantics for configured assistant and group policies. */
export function createMessagingAccessPolicy(input: { users: UserStore; tenancy: TenancyService | null; kernel: AuthorizationKernel; roles: AuthorizationRoleAssignmentResolver | null;
  assertCurrent(): void }): (scope: ServiceDataScope, userId: string, requirement?: AccessRequirement) => boolean {
  return (scope, userId, requirement) => {
    input.assertCurrent();
    const user = input.users.getUserById(userId); if (!user || user.status !== 'active') return false;
    const context: AuthContext = { userId: user.userId, email: user.email, role: user.role, sessionScopeKind: scope.scopeKind, sessionScopeId: scope.scopeId };
    if (scope.tenantId !== null) {
      const tenant = input.tenancy?.getTenant(scope.tenantId), member = input.tenancy?.getMembership(scope.tenantId, userId);
      if (!tenant || tenant.status !== 'active' || !member || member.status !== 'active') return false;
      Object.assign(context, { tenantId: tenant.tenantId, tenantKind: tenant.kind, membershipId: member.membershipId, tenantRole: member.roleKey,
        tenantAuthorizationGeneration: tenant.authorizationGeneration, membershipAuthorizationGeneration: member.authorizationGeneration });
    } else if (input.kernel.tenancy.mode !== 'single') return false;
    const access = createRequestAuthorizationAccess({ authContext: context, kernel: input.kernel, propertyStore: input.users, roleAssignments: input.roles, assertCurrentProfile: input.assertCurrent });
    try { if (requirement !== undefined) access.authorize(requirement); input.assertCurrent(); return true; }
    catch (error) { if (error instanceof AuthError && [401, 403, 404].includes(error.status)) return false; throw error; }
  };
}
