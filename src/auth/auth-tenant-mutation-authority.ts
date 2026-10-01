/** Commit-boundary authority for tenant control-plane mutations. */

import { createRequestAuthorizationAccess } from './authorization-access';
import type {
  AuthorizationKernel,
  AuthorizationScopeSnapshot,
} from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import { authContextAuthorityFingerprint } from './auth-context-authority';
import type { TokenService } from './token-service';
import { AuthError, type AuthContext, type PermissionKey } from './types';
import type { UserStore } from './user-store';

export interface AuthTenantMutationAuthority {
  readonly auth: AuthContext;
  readonly scope: AuthorizationScopeSnapshot & {
    readonly scopeKind: 'tenant';
    readonly tenantId: string;
    readonly membershipId: string;
  };
  /** Present only for a live protected administration-organization session. */
  readonly applicationScope?: (AuthorizationScopeSnapshot & {
    readonly scopeKind: 'application';
  }) | null;
  /**
   * Internal cross-tenant authority projected only by the protected
   * Administration Organization after application authority is revalidated.
   * Ordinary tenant request paths never set this flag.
   */
  readonly platformAdministration?: true;
}

/**
 * Synchronous because it must run after the tenant write lock is acquired and
 * immediately before the first domain mutation in the same SQLite transaction.
 */
export type AssertAuthTenantMutationAuthority = (
  requiredPermissions: readonly PermissionKey[],
) => AuthTenantMutationAuthority;

/**
 * Capture no bearer credential. The returned assertion resolves the exact
 * session family again and rejects changes to account/session/scope/roles or
 * trusted properties which happened after request authentication.
 */
export function captureAuthTenantMutationAuthority(input: {
  auth: AuthContext;
  tokenService: TokenService;
  kernel: AuthorizationKernel;
  store: UserStore;
  roles: AuthorizationRoleService | null;
}): AssertAuthTenantMutationAuthority {
  const reference = input.tokenService.captureAuthContextAuthority(input.auth);
  if (!reference) throw staleAuthority();
  const capturedFingerprint = authContextAuthorityFingerprint(
    input.auth,
    input.store.getProperties(input.auth.userId),
  );

  return (requiredPermissions) => {
    const current = input.tokenService.resolveAuthContextAuthority(reference);
    if (!current || authContextAuthorityFingerprint(
      current,
      input.store.getProperties(current.userId),
    ) !== capturedFingerprint) throw staleAuthority();

    const access = createRequestAuthorizationAccess({
      authContext: current,
      kernel: input.kernel,
      propertyStore: input.store,
      roleAssignments: input.roles,
    });
    const scope = access.requireTenant();
    const applicationScope = access.applicationAuthorization;
    for (const permission of requiredPermissions) {
      access.requirePermission(permission);
    }
    return Object.freeze({
      auth: current,
      scope,
      applicationScope: applicationScope?.scopeKind === 'application'
        ? applicationScope as AuthorizationScopeSnapshot & { scopeKind: 'application' }
        : null,
    });
  };
}

export function staleAuthority(): AuthError {
  return new AuthError(
    'Authorization changed before the operation could commit',
    'AUTHORIZATION_CHANGED',
    409,
  );
}
