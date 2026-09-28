/** Public-safe projection of the current request's live authorization. */

import type { RequestAuthorizationAccess } from './authorization-access';
import type { AuthorizationKernel } from './authorization-kernel';
import type { AuthContext, PermissionKey } from './types';

export interface AuthAuthorizationIdentitySnapshot {
  readonly userId: string;
  readonly platformRole: string;
}

export interface AuthAuthorizationScopeSnapshot {
  readonly kind: 'application' | 'tenant';
  readonly scopeId: string;
  readonly roles: readonly string[];
  readonly permissions: readonly PermissionKey[];
  readonly allPermissions: boolean;
  readonly revision: string;
  readonly tenantId?: string;
  readonly membershipId?: string;
}

/**
 * Browser-safe current authority. It intentionally omits bearer/session proof,
 * email, trusted properties, security generations, and native client details.
 */
export interface AuthAuthorizationSnapshot {
  readonly version: 1;
  readonly identity: AuthAuthorizationIdentitySnapshot;
  readonly profile: {
    readonly tenancy: 'single' | 'multi';
    readonly authorization: 'simple' | 'advanced';
  };
  readonly scope: AuthAuthorizationScopeSnapshot | null;
  /** Opaque equality marker covering identity, platform role, and scope authority. */
  readonly revision: string;
}

export function createAuthAuthorizationSnapshot(
  auth: AuthContext,
  kernel: AuthorizationKernel,
  access: RequestAuthorizationAccess,
): AuthAuthorizationSnapshot {
  const current = access.authorization;
  const scope: AuthAuthorizationScopeSnapshot | null = current
    ? Object.freeze({
        kind: current.scopeKind,
        scopeId: current.scopeId,
        roles: Object.freeze([...current.roles]),
        permissions: Object.freeze([...current.permissions]),
        allPermissions: current.allPermissions === true,
        revision: current.revision,
        ...(current.tenantId ? { tenantId: current.tenantId } : {}),
        ...(current.membershipId ? { membershipId: current.membershipId } : {}),
      })
    : null;

  return Object.freeze({
    version: 1,
    identity: Object.freeze({
      userId: auth.userId,
      platformRole: auth.role,
    }),
    profile: Object.freeze({
      tenancy: kernel.tenancy.mode,
      authorization: kernel.authorization.mode,
    }),
    scope,
    revision: authorizationRevision(auth, scope),
  });
}

function authorizationRevision(
  auth: AuthContext,
  scope: AuthAuthorizationScopeSnapshot | null,
): string {
  // JSON encoding avoids delimiter ambiguity. This is an equality marker, not
  // a credential, and deliberately contains only fields already in the body.
  return JSON.stringify([
    1,
    auth.userId,
    auth.role,
    scope?.kind ?? null,
    scope?.scopeId ?? null,
    scope?.revision ?? null,
  ]);
}
