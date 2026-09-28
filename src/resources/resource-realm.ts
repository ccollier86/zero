/**
 * Mandatory resource data-realm enforcement shared by HTTP CRUD, /api/data,
 * and WebSocket Sync. Realm checks are deliberately separate from app policy:
 * no `anyOf()` branch or custom callback can widen this boundary.
 */

import type { ResourceDataConstraint } from './resource-policy-types';
import type { RegisteredResourceDefinition } from './resource-registry';

/** Narrow session authority needed to bind one request/socket to a tenant. */
export interface ResourceRealmAuthContext {
  sessionKind?: 'web' | 'native';
  clientId?: string;
  sessionId?: string;
  sessionGeneration?: number;
  sessionScopeKind?: 'application' | 'tenant';
  sessionScopeId?: string;
  tenantId?: string;
  membershipId?: string;
  tenantAuthorizationGeneration?: number;
  membershipAuthorizationGeneration?: number;
}

export interface ResourceTenantScope {
  readonly kind: 'tenant';
  readonly field: string;
  readonly tenantId: string;
  readonly fingerprint: string;
}

export type ResourceRealmResolution =
  | { ok: true; scope: ResourceTenantScope | null }
  | {
    ok: false;
    status: 403;
    code: 'resource-tenant-context-required';
    message: string;
  };

/** Resolve and validate the non-discretionary realm for one live authority. */
export function resolveResourceRealm(
  resource: RegisteredResourceDefinition,
  authContext: ResourceRealmAuthContext | null | undefined,
): ResourceRealmResolution {
  // Missing realms are legacy single-tenant definitions. Multi-mode startup
  // validation prevents them from reaching this boundary.
  if (!resource.realm || resource.realm.kind === 'global') {
    return { ok: true, scope: null };
  }

  if (!hasLiveTenantAuthority(authContext)) {
    return {
      ok: false,
      status: 403,
      code: 'resource-tenant-context-required',
      message: 'A live tenant-bound session is required for this resource',
    };
  }

  const tenantId = authContext.tenantId;
  return {
    ok: true,
    scope: Object.freeze({
      kind: 'tenant',
      field: resource.realm.field,
      tenantId,
      fingerprint: JSON.stringify([
        authContext.sessionKind,
        authContext.clientId,
        authContext.sessionId,
        authContext.sessionGeneration,
        tenantId,
        authContext.membershipId,
        authContext.tenantAuthorizationGeneration,
        authContext.membershipAuthorizationGeneration,
      ]),
    }),
  };
}

/**
 * Convert a mandatory tenant realm into an ANDed server-owned constraint.
 * SQL planners compile this channel with storage-class/BINARY equality;
 * in-memory Sync filters apply the equivalent strict scalar comparison.
 */
export function resourceRealmConstraint(
  scope: ResourceTenantScope | null,
): ResourceDataConstraint[] {
  return scope
    ? [{ type: 'field', field: scope.field, operator: 'eq', value: scope.tenantId }]
    : [];
}

/** True only when the row belongs to the currently resolved tenant realm. */
export function resourceRowMatchesRealm(
  row: Record<string, unknown>,
  scope: ResourceTenantScope | null,
): boolean {
  return !scope || row[scope.field] === scope.tenantId;
}

/**
 * Stamp an insert and reject a conflicting browser-provided discriminator.
 * Equal caller values are accepted but replaced with the trusted value.
 */
export function stampResourceCreateRealm(
  input: Record<string, unknown>,
  scope: ResourceTenantScope | null,
): { ok: true; input: Record<string, unknown> } | {
  ok: false;
  status: 400;
  code: 'resource-tenant-conflict';
  message: string;
} {
  if (!scope) return { ok: true, input };
  if (scope.field in input && input[scope.field] !== scope.tenantId) {
    return {
      ok: false,
      status: 400,
      code: 'resource-tenant-conflict',
      message: `Field "${scope.field}" conflicts with the active tenant`,
    };
  }
  return { ok: true, input: { ...input, [scope.field]: scope.tenantId } };
}

/** Tenant discriminators are immutable through ordinary update operations. */
export function rejectResourceRealmUpdate(
  input: Record<string, unknown>,
  scope: ResourceTenantScope | null,
): { ok: true } | {
  ok: false;
  status: 400;
  code: 'resource-tenant-immutable';
  message: string;
} {
  if (!scope || !(scope.field in input)) return { ok: true };
  return {
    ok: false,
    status: 400,
    code: 'resource-tenant-immutable',
    message: `Field "${scope.field}" is server-managed and cannot be updated`,
  };
}

function hasLiveTenantAuthority(
  auth: ResourceRealmAuthContext | null | undefined,
): auth is ResourceRealmAuthContext & Required<Pick<
  ResourceRealmAuthContext,
  | 'sessionId'
  | 'sessionScopeKind'
  | 'sessionScopeId'
  | 'tenantId'
  | 'membershipId'
  | 'tenantAuthorizationGeneration'
  | 'membershipAuthorizationGeneration'
>> {
  return Boolean(
    auth
    && hasDurableSessionShape(auth)
    && nonEmpty(auth.sessionId)
    && auth.sessionScopeKind === 'tenant'
    && nonEmpty(auth.sessionScopeId)
    && nonEmpty(auth.tenantId)
    && auth.sessionScopeId === auth.tenantId
    && nonEmpty(auth.membershipId)
    && nonNegativeInteger(auth.tenantAuthorizationGeneration)
    && nonNegativeInteger(auth.membershipAuthorizationGeneration),
  );
}

/**
 * Browser parents carry a numeric generation; native refresh families carry
 * an audience-bound public client id instead. Both have already been resolved
 * against their durable server-side owner before reaching resource policy.
 * Keep the legacy generation-only shape for standalone verifiers which predate
 * explicit `sessionKind`, while rejecting contradictory native/web mixtures.
 */
function hasDurableSessionShape(auth: ResourceRealmAuthContext): boolean {
  if (auth.sessionKind === 'web') {
    return nonNegativeInteger(auth.sessionGeneration) && auth.clientId === undefined;
  }
  if (auth.sessionKind === 'native') {
    return nonEmpty(auth.clientId) && auth.sessionGeneration === undefined;
  }
  if (auth.sessionKind !== undefined) return false;
  return nonNegativeInteger(auth.sessionGeneration) && auth.clientId === undefined;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
