/**
 * Server-owned data boundary for framework services.
 *
 * This is deliberately projected from a live request/sync identity. Built-in
 * services never accept a tenant id from request input, and multi-tenant
 * requests without a validated tenant-bound parent session fail closed.
 */

import type { RequestAuthorizationAccess } from './authorization-access';
import type { AuthorizationKernel } from './authorization-kernel';

const SERVICE_DATA_SCOPE = Symbol('zero.service-data-scope');

export type ServiceDataScope = Readonly<
  | {
      readonly [SERVICE_DATA_SCOPE]: true;
      readonly scopeKind: 'application';
      readonly scopeId: string;
      readonly tenantId: null;
    }
  | {
      readonly [SERVICE_DATA_SCOPE]: true;
      readonly scopeKind: 'tenant';
      readonly scopeId: string;
      readonly tenantId: string;
    }
>;

/** Identity fields shared by HTTP auth and authenticated Sync sockets. */
export interface ServiceDataScopeIdentity {
  readonly sessionScopeKind?: 'application' | 'tenant';
  readonly sessionScopeId?: string;
  readonly tenantId?: string;
  readonly membershipId?: string;
}

const APPLICATION_SCOPE: ServiceDataScope = Object.freeze({
  [SERVICE_DATA_SCOPE]: true as const,
  scopeKind: 'application',
  scopeId: 'application',
  tenantId: null,
});

/** Stable single-tenant/legacy application boundary. */
export function applicationServiceDataScope(): ServiceDataScope {
  return APPLICATION_SCOPE;
}

/**
 * Explicit trusted-server constructor for background/system work.
 *
 * Never pass a request-body/query tenant id to this function. Request and Sync
 * code must use their live identity projection helpers instead; this escape
 * hatch exists for auditable schedulers, migrations, and workflow system
 * principals which have no end-user session by design.
 */
export function trustedSystemServiceDataScope(
  input: { scopeKind: 'application' } | { scopeKind: 'tenant'; tenantId: string },
): ServiceDataScope {
  if (input.scopeKind === 'application') return APPLICATION_SCOPE;
  const tenantId = input.tenantId.trim();
  if (!tenantId || tenantId.length > 256) {
    throw new Error('Trusted system tenant scope requires a valid tenant id');
  }
  return Object.freeze({
    [SERVICE_DATA_SCOPE]: true as const,
    scopeKind: 'tenant',
    scopeId: tenantId,
    tenantId,
  });
}

/**
 * Resolve the boundary for an authenticated HTTP request.
 *
 * A missing kernel is accepted only for legacy/application-scoped identities.
 * A tenant-shaped identity without the app-local kernel cannot prove its live
 * membership scope and is therefore rejected by `access.requireTenant()`.
 */
export function requireRequestServiceDataScope(
  access: RequestAuthorizationAccess,
  getKernel: () => AuthorizationKernel | null,
): ServiceDataScope {
  const identity = access.requireUser();
  const kernel = getKernel();
  const tenantShaped = kernel?.tenancy.mode === 'multi'
    || identity.sessionScopeKind === 'tenant'
    || identity.tenantId !== undefined
    || identity.membershipId !== undefined;

  if (tenantShaped) {
    const tenant = access.requireTenant();
    return Object.freeze({
      [SERVICE_DATA_SCOPE]: true as const,
      scopeKind: 'tenant',
      scopeId: tenant.tenantId,
      tenantId: tenant.tenantId,
    });
  }

  // A configured single-mode kernel should still validate the live
  // application authorization projection. Standalone legacy middleware has
  // no kernel and retains the existing authenticated-user behavior.
  if (kernel) access.requireAuthorizationScope();
  return APPLICATION_SCOPE;
}

/**
 * Project an already server-validated Sync identity into the same boundary.
 * Returns null for partial or contradictory tenant claims.
 */
export function serviceDataScopeFromIdentity(
  identity: ServiceDataScopeIdentity | null,
  tenancyMode: 'single' | 'multi' = 'single',
): ServiceDataScope | null {
  if (!identity) return null;

  if (identity.sessionScopeKind === 'tenant'
    || identity.tenantId !== undefined
    || identity.membershipId !== undefined) {
    if (
      identity.sessionScopeKind !== 'tenant'
      || !identity.sessionScopeId
      || !identity.tenantId
      || identity.sessionScopeId !== identity.tenantId
      || !identity.membershipId
    ) return null;

    return Object.freeze({
      [SERVICE_DATA_SCOPE]: true as const,
      scopeKind: 'tenant',
      scopeId: identity.tenantId,
      tenantId: identity.tenantId,
    });
  }

  if (
    identity.sessionScopeKind === 'application'
    && identity.sessionScopeId
    && identity.sessionScopeId !== 'application'
  ) return null;

  // Multi-tenant application/selection sessions authenticate identity only.
  // They cannot become an application data scope merely because their tenant
  // fields are absent; built-in data requires a fully validated membership.
  if (tenancyMode === 'multi') return null;

  // Legacy single-mode token verifiers do not expose durable scope fields.
  return APPLICATION_SCOPE;
}

/** SQLite discriminator used by tenant-owned framework records. */
export function serviceDataTenantId(scope: ServiceDataScope): string | null {
  return scope.tenantId;
}

/** Compare a nullable persisted discriminator to a validated request scope. */
export function serviceDataScopeMatchesTenant(
  scope: ServiceDataScope,
  tenantId: unknown,
): boolean {
  return scope.tenantId === normalizeTenantId(tenantId);
}

/** Stable internal namespace component for state and ephemeral channels. */
export function serviceDataScopeKey(scope: ServiceDataScope): string {
  return scope.scopeKind === 'tenant'
    ? `tenant:${scope.tenantId}`
    : 'application';
}

function normalizeTenantId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
