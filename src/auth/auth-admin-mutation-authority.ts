/** Commit-boundary authority for platform-administrator mutations. */

import type { TokenService } from './token-service';
import { AuthError, type AuthContext } from './types';
import type { AuthorizationKernel } from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import { authContextAuthorityFingerprint } from './auth-context-authority';
import { createRequestAuthorizationAccess } from './authorization-access';
import type { UserStore } from './user-store';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';

/**
 * Re-resolve the exact request session immediately before an administrator
 * control-plane write. The callback retains no bearer credential.
 */
export interface AuthAdminMutationBoundary {
  /** Existing target account, resolved again inside the mutation transaction. */
  readonly targetUserId?: string;
  /** Requested legacy global role for create/update operations. */
  readonly requestedPlatformRole?: string;
}

export type AssertAuthAdminMutationAuthority = (
  boundary?: AuthAdminMutationBoundary,
) => AuthContext;

/** Invoke a public admin authority callback without allowing Promise escape. */
export function invokeAuthAdminMutationAuthority(
  assertion: AssertAuthAdminMutationAuthority,
  boundary: AuthAdminMutationBoundary | undefined,
  options: {
    component: string;
    emitCode?: AuthPlatformCodeEmitter;
  },
): AuthContext {
  return invokeSynchronousAuthCallback(
    () => assertion(boundary),
    {
      component: options.component,
      invariant: 'authority-callback-async',
      message: '[auth] Administrator authority callback must be synchronous.',
      emitCode: options.emitCode,
    },
  );
}

/**
 * Capture a secret-free reference to the authenticated administrator session.
 * Session revocation/expiry and every account or scope revision fail closed.
 */
export function captureAuthAdminMutationAuthority(input: {
  auth: AuthContext;
  tokenService: TokenService;
  kernel: AuthorizationKernel;
  store: UserStore;
  roles: AuthorizationRoleService | null;
  permission?:
    | 'application.users:read'
    | 'application.users:manage'
    | 'application.audit:read'
    | 'application.audit:manage';
}): AssertAuthAdminMutationAuthority {
  const reference = input.tokenService.captureAuthContextAuthority(input.auth);
  if (!reference) throw staleAdminAuthority();
  const capturedFingerprint = authContextAuthorityFingerprint(
    input.auth,
    input.store.getProperties(input.auth.userId),
  );

  return (boundary) => {
    const current = input.tokenService.resolveAuthContextAuthority(reference);
    if (!current || authContextAuthorityFingerprint(
      current,
      input.store.getProperties(current.userId),
    ) !== capturedFingerprint) throw staleAdminAuthority();

    if (input.kernel.tenancy.mode === 'single') {
      if (current.role !== 'admin') throw staleAdminAuthority();
      return current;
    }

    try {
      const access = createRequestAuthorizationAccess({
        authContext: current,
        kernel: input.kernel,
        propertyStore: input.store,
        roleAssignments: input.roles,
      });
      access.requireApplicationAuthorization();
      access.requirePermission(input.permission ?? 'application.users:manage');
    } catch {
      throw staleAdminAuthority();
    }
    assertLegacyGlobalRoleBoundary(input.store, current, boundary);
    return current;
  };
}

function assertLegacyGlobalRoleBoundary(
  store: UserStore,
  actor: AuthContext,
  boundary: AuthAdminMutationBoundary | undefined,
): void {
  if (!boundary || actor.role === 'admin') return;
  const target = boundary.targetUserId
    ? store.getUserById(boundary.targetUserId)
    : null;
  if (boundary.requestedPlatformRole === 'admin' || target?.role === 'admin') {
    throw new AuthError(
      'A global administrator is required to manage the legacy global administrator role',
      'GLOBAL_ADMIN_AUTHORITY_REQUIRED',
      403,
    );
  }
}

function staleAdminAuthority(): AuthError {
  return new AuthError(
    'Administrator authorization changed before the operation could commit',
    'AUTHORIZATION_CHANGED',
    409,
  );
}
