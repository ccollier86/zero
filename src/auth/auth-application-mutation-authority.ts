/** Commit-boundary authority for single-application control-plane mutations. */

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

export interface AuthApplicationMutationAuthority {
  readonly auth: AuthContext;
  readonly scope: AuthorizationScopeSnapshot & {
    readonly scopeKind: 'application';
  };
}

/**
 * Revalidate the exact request identity and application authority immediately
 * before a control-plane write. The closure retains no bearer credential.
 */
export type AssertAuthApplicationMutationAuthority = (
  requiredPermissions: readonly PermissionKey[],
) => AuthApplicationMutationAuthority;

/**
 * Capture a non-secret reference to the request authority. The returned
 * assertion detects session revocation, account changes, assignment changes,
 * and trusted-property changes before the surrounding SQLite transaction
 * performs its first domain mutation.
 */
export function captureAuthApplicationMutationAuthority(input: {
  auth: AuthContext;
  tokenService: TokenService;
  kernel: AuthorizationKernel;
  store: UserStore;
  roles: AuthorizationRoleService | null;
}): AssertAuthApplicationMutationAuthority {
  const reference = input.tokenService.captureAuthContextAuthority(input.auth);
  if (!reference) throw staleApplicationAuthority();
  const capturedFingerprint = authContextAuthorityFingerprint(
    input.auth,
    input.store.getProperties(input.auth.userId),
  );

  return (requiredPermissions) => {
    const current = input.tokenService.resolveAuthContextAuthority(reference);
    if (!current || authContextAuthorityFingerprint(
      current,
      input.store.getProperties(current.userId),
    ) !== capturedFingerprint) throw staleApplicationAuthority();

    const access = createRequestAuthorizationAccess({
      authContext: current,
      kernel: input.kernel,
      propertyStore: input.store,
      roleAssignments: input.roles,
    });
    const scope = access.requireApplicationAuthorization();
    for (const permission of requiredPermissions) {
      access.requirePermission(permission);
    }
    return Object.freeze({
      auth: current,
      scope: scope as AuthorizationScopeSnapshot & { scopeKind: 'application' },
    });
  };
}

export function staleApplicationAuthority(): AuthError {
  return new AuthError(
    'Authorization changed before the operation could commit',
    'AUTHORIZATION_CHANGED',
    409,
  );
}
