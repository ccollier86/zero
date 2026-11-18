/** Current SYSTEM-owned offline subject policy; this creates no session or credential. */
import { createRequestAuthorizationAccess, type AuthorizationRoleAssignmentResolver } from '../auth/authorization-access';
import type { AuthorizationKernel, AccessRequirement } from '../auth/authorization-kernel';
import type { ServiceDataScope } from '../auth/service-data-scope';
import type { UserStore } from '../auth/user-store';
import type { TenancyService } from '../auth/tenancy';
import { AuthError, type AuthContext } from '../auth/types';
import { canUserReceiveAuthTokens } from '../auth/auth-user-eligibility';
import { invokeSynchronousAuthCallback } from '../auth/auth-synchronous-callback';

export interface CalendarParticipantPolicyDependencies {
  readonly users: UserStore;
  readonly tenancy: TenancyService | null;
  readonly kernel: AuthorizationKernel;
  readonly roles: AuthorizationRoleAssignmentResolver | null;
  readonly userEligibility: AccessRequirement;
  assertCurrent(): void;
}

/** Rehydrate on every invocation; a discovered name never becomes an admission capability. */
export function createCalendarParticipantPolicy(input: CalendarParticipantPolicyDependencies): (scope: ServiceDataScope, userId: string) => boolean {
  const requirement = input.kernel.compile(input.userEligibility);
  // Defense in depth for trusted adapters bypassing normal config resolution.
  if (input.userEligibility === true || requirement.user !== 'required' || requirement.credentialKinds !== undefined) {
    throw new AuthError('Calendar subject policy is not offline-provable', 'AUTH_POLICY_UNAVAILABLE', 503);
  }
  const assertCurrent = () => { invokeSynchronousAuthCallback(input.assertCurrent, {
    component: 'calendar-participants', invariant: 'subject-profile-guard-async',
    message: 'Calendar participant subject profile guard must be synchronous.',
  }); };
  return (scope, userId) => {
    assertCurrent();
    const user = input.users.getUserById(userId);
    if (!user || !canUserReceiveAuthTokens(user)) return false;
    const context: AuthContext = { userId: user.userId, email: user.email, role: user.role,
      sessionScopeKind: scope.scopeKind, sessionScopeId: scope.scopeId };
    if (input.kernel.tenancy.mode === 'multi') {
      if (scope.scopeKind !== 'tenant' || scope.tenantId === null || scope.scopeId !== scope.tenantId) return false;
      const tenant = input.tenancy?.getTenant(scope.tenantId), member = input.tenancy?.getMembership(scope.tenantId, userId);
      if (!tenant || tenant.status !== 'active' || !member || member.status !== 'active') return false;
      Object.assign(context, { tenantId: tenant.tenantId, tenantKind: tenant.kind, membershipId: member.membershipId,
        tenantRole: member.roleKey, tenantAuthorizationGeneration: tenant.authorizationGeneration,
        membershipAuthorizationGeneration: member.authorizationGeneration });
    } else if (scope.scopeKind !== 'application' || scope.scopeId !== 'application' || scope.tenantId !== null) return false;
    const access = createRequestAuthorizationAccess({ authContext: context, kernel: input.kernel,
      propertyStore: input.users, roleAssignments: input.roles, assertCurrentProfile: assertCurrent });
    try { access.authorize(requirement); assertCurrent(); return true; }
    catch (error) { if (error instanceof AuthError && [401, 403, 404].includes(error.status)) return false; throw error; }
  };
}
