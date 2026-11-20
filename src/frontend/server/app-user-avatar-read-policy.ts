/** Request-local private-photo policy context; never exposes SYSTEM, Storage or a writer. */
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import type { AuthContext } from '../../auth/types';
import { AuthError } from '../../auth/types';
import { serviceDataScopeFromIdentity } from '../../auth/service-data-scope';
import { createRequestAuthorizationAccess } from '../../auth/authorization-access';
import type { AccessRequirement } from '../../auth/authorization-kernel';
import type { AuthUserAvatarReadContext } from '../../auth/auth-user-avatar-read-policy';
import { ZERO_AUTH_STORE, ZERO_AUTH_TENANCY_SERVICE, ZERO_AUTHORIZATION_KERNEL,
  ZERO_AUTHORIZATION_ROLE_SERVICE, ZERO_SYNC_DB } from '../../runtime/service-keys';

export function managedUserAvatarReadContext(runtime: ZeroAppRuntime, auth: AuthContext, subjectId: string,
  guard: () => void): AuthUserAvatarReadContext {
  guard();
  const users = runtime.require(ZERO_AUTH_STORE), kernel = runtime.require(ZERO_AUTHORIZATION_KERNEL);
  const scope = serviceDataScopeFromIdentity(auth, kernel.tenancy.mode);
  if (!scope) throw new AuthError('Avatar subject is unavailable', 'AUTH_AVATAR_IMAGE_UNAVAILABLE', 404);
  return Object.freeze({ viewerId: auth.userId, subjectId, scope,
    // Resolve the canonical application read plane lazily. A policy which only
    // tests Guardian roles/properties need not inspect any application records.
    db: Object.freeze({ get(table: string, id: string) { guard(); const value = runtime.require(ZERO_SYNC_DB).get(table, id); guard(); return value; },
      query(table: string) { guard(); const value = runtime.require(ZERO_SYNC_DB).query(table); guard(); return value; } }),
    allows(userId: string, requirement: AccessRequirement) {
      guard();
      const user = users.getUserById(userId);
      if (!user || user.status !== 'active') return false;
      const context: AuthContext = { userId: user.userId, email: user.email, role: user.role,
        sessionScopeKind: scope.scopeKind, sessionScopeId: scope.scopeId };
      if (scope.tenantId !== null) {
        const tenancy = runtime.get(ZERO_AUTH_TENANCY_SERVICE), tenant = tenancy?.getTenant(scope.tenantId), member = tenancy?.getMembership(scope.tenantId, userId);
        if (tenant?.status !== 'active' || member?.status !== 'active') return false;
        Object.assign(context, { tenantId: tenant.tenantId, tenantKind: tenant.kind, membershipId: member.membershipId,
          tenantRole: member.roleKey, tenantAuthorizationGeneration: tenant.authorizationGeneration,
          membershipAuthorizationGeneration: member.authorizationGeneration });
      }
      const access = createRequestAuthorizationAccess({ authContext: context, kernel, propertyStore: users,
        roleAssignments: runtime.get(ZERO_AUTHORIZATION_ROLE_SERVICE) ?? null, assertCurrentProfile: guard });
      try { access.authorize(requirement); guard(); return true; }
      catch (error) { if (error instanceof AuthError && [401, 403, 404].includes(error.status)) return false; throw error; }
    },
  });
}
