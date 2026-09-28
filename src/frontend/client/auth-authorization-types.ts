/** Browser-safe contracts for Zero's live current-authorization projection. */

export interface AuthAuthorizationIdentitySnapshot {
  readonly userId: string;
  readonly platformRole: string;
}

export interface AuthAuthorizationScopeSnapshot {
  readonly kind: 'application' | 'tenant';
  readonly scopeId: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly allPermissions: boolean;
  readonly revision: string;
  readonly tenantId?: string;
  readonly membershipId?: string;
}

export interface AuthAuthorizationSnapshot {
  readonly version: 1;
  readonly identity: AuthAuthorizationIdentitySnapshot;
  readonly profile: {
    readonly tenancy: 'single' | 'multi';
    readonly authorization: 'simple' | 'advanced';
  };
  readonly scope: AuthAuthorizationScopeSnapshot | null;
  /** Opaque equality marker; never use this value as authorization proof. */
  readonly revision: string;
}

export type AuthAuthorizationStatus =
  | 'disabled'
  | 'unauthenticated'
  | 'loading'
  | 'refreshing'
  | 'ready'
  | 'error'
  | 'revoked';

/** Observable state owned by AuthClient's authorization cache. */
export interface AuthAuthorizationState {
  readonly status: AuthAuthorizationStatus;
  readonly snapshot: AuthAuthorizationSnapshot | null;
  readonly error: string | null;
}

export function hasAuthorizationPermission(
  snapshot: AuthAuthorizationSnapshot | null,
  permission: string,
): boolean {
  if (!snapshot?.scope || !permission) return false;
  // Even an all-permissions role only covers keys declared by the application.
  // The server projects that registry into `permissions`; unknown/typo keys fail
  // closed instead of being treated as capabilities.
  return snapshot.scope.permissions.includes(permission);
}

export function hasEveryAuthorizationPermission(
  snapshot: AuthAuthorizationSnapshot | null,
  permissions: readonly string[],
): boolean {
  return permissions.length > 0
    && permissions.every((permission) => hasAuthorizationPermission(snapshot, permission));
}

export function hasAnyAuthorizationPermission(
  snapshot: AuthAuthorizationSnapshot | null,
  permissions: readonly string[],
): boolean {
  return permissions.length > 0
    && permissions.some((permission) => hasAuthorizationPermission(snapshot, permission));
}
