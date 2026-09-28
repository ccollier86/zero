/** Server-owned tenant authority captured by native authorization/session rows. */

import type { AuthContext, AuthTenancyMode } from '../types';
import type { TenancyService } from '../tenancy/tenancy-service';
import type { ActiveTenantMembership } from '../tenancy/tenancy-types';

export interface NativeAuthoritySnapshot {
  scopeKind: 'application' | 'tenant';
  scopeId: string;
  tenantId: string | null;
  membershipId: string | null;
  tenantAuthorizationGeneration: number | null;
  membershipAuthorizationGeneration: number | null;
}

export interface NativeActiveTenant {
  tenantId: string;
  slug: string;
  name: string;
  role: string | null;
}

export interface ResolvedNativeAuthority {
  snapshot: NativeAuthoritySnapshot;
  tenantRole: string | null;
  activeTenant: NativeActiveTenant | null;
}

type StoredNativeAuthority = {
  scopeKind: 'application' | 'tenant' | null;
  scopeId: string | null;
  tenantId: string | null;
  membershipId: string | null;
  tenantAuthorizationGeneration: number | null;
  membershipAuthorizationGeneration: number | null;
};

/**
 * Converts page-session and persistence data into one native authority model.
 * Native clients never choose generations or membership IDs themselves.
 */
export class NativeTenantAuthorityService {
  constructor(
    private readonly mode: AuthTenancyMode,
    private readonly tenancy: TenancyService | null,
  ) {}

  capturePageAuthority(auth: AuthContext): NativeAuthoritySnapshot | null {
    if (this.mode === 'single') {
      const legacyApplicationSession = auth.sessionKind === undefined
        && auth.sessionScopeKind === undefined
        && auth.sessionScopeId === undefined;
      const boundedApplicationSession = auth.sessionKind === 'web'
        && auth.sessionScopeKind === 'application'
        && auth.sessionScopeId === 'application';
      return (legacyApplicationSession || boundedApplicationSession)
        && !auth.tenantId
        && !auth.membershipId
        ? applicationAuthority()
        : null;
    }
    if (auth.sessionKind !== 'web'
      || auth.sessionScopeKind !== 'tenant'
      || !auth.tenantId
      || !auth.membershipId
      || auth.sessionScopeId !== auth.tenantId
      || !validGeneration(auth.tenantAuthorizationGeneration)
      || !validGeneration(auth.membershipAuthorizationGeneration)) {
      return null;
    }
    return this.resolve(auth.userId, {
      scopeKind: 'tenant',
      scopeId: auth.tenantId,
      tenantId: auth.tenantId,
      membershipId: auth.membershipId,
      tenantAuthorizationGeneration: auth.tenantAuthorizationGeneration,
      membershipAuthorizationGeneration: auth.membershipAuthorizationGeneration,
    })?.snapshot ?? null;
  }

  pageMatches(auth: AuthContext, stored: StoredNativeAuthority): boolean {
    const captured = this.capturePageAuthority(auth);
    const normalized = this.normalize(stored);
    return Boolean(captured && normalized && sameNativeAuthority(captured, normalized));
  }

  /** Resolve a captured snapshot against live tenant and membership rows. */
  resolve(userId: string, stored: StoredNativeAuthority): ResolvedNativeAuthority | null {
    const snapshot = this.normalize(stored);
    if (!snapshot) return null;
    if (snapshot.scopeKind === 'application') {
      return this.mode === 'single'
        ? { snapshot, tenantRole: null, activeTenant: null }
        : null;
    }
    if (this.mode !== 'multi' || !this.tenancy) return null;
    const tenant = this.tenancy.getTenant(snapshot.tenantId!);
    const membership = this.tenancy.getMembershipById(snapshot.membershipId!);
    if (!tenant || !membership
      || tenant.status !== 'active'
      || membership.status !== 'active'
      || membership.userId !== userId
      || membership.tenantId !== tenant.tenantId
      || tenant.authorizationGeneration !== snapshot.tenantAuthorizationGeneration
      || membership.authorizationGeneration
        !== snapshot.membershipAuthorizationGeneration) {
      return null;
    }
    return {
      snapshot,
      tenantRole: membership.roleKey,
      activeTenant: tenantSummary({ tenant, membership }),
    };
  }

  list(userId: string): NativeActiveTenant[] {
    if (this.mode !== 'multi' || !this.tenancy) return [];
    return this.tenancy.listActiveTenantMembershipsForUser(userId).map(tenantSummary);
  }

  resolveTenant(userId: string, tenantId: string): ResolvedNativeAuthority | null {
    if (this.mode !== 'multi' || !this.tenancy) return null;
    const tenant = this.tenancy.getTenant(tenantId);
    const membership = this.tenancy.getMembership(tenantId, userId);
    if (!tenant || !membership
      || tenant.status !== 'active'
      || membership.status !== 'active') return null;
    const snapshot: NativeAuthoritySnapshot = {
      scopeKind: 'tenant',
      scopeId: tenant.tenantId,
      tenantId: tenant.tenantId,
      membershipId: membership.membershipId,
      tenantAuthorizationGeneration: tenant.authorizationGeneration,
      membershipAuthorizationGeneration: membership.authorizationGeneration,
    };
    return {
      snapshot,
      tenantRole: membership.roleKey,
      activeTenant: tenantSummary({ tenant, membership }),
    };
  }

  private normalize(stored: StoredNativeAuthority): NativeAuthoritySnapshot | null {
    // Rows created before migration 010 are identity-only. They may finish
    // their existing lifetime only in single-tenant mode, where application
    // authority is unambiguous. Multi-tenant mode always fails them closed.
    if (stored.scopeKind === null && this.mode === 'single') return applicationAuthority();
    if (stored.scopeKind === 'application') {
      return stored.scopeId === 'application'
        && stored.tenantId === null
        && stored.membershipId === null
        && stored.tenantAuthorizationGeneration === null
        && stored.membershipAuthorizationGeneration === null
        ? applicationAuthority()
        : null;
    }
    if (stored.scopeKind !== 'tenant'
      || !stored.scopeId
      || stored.scopeId !== stored.tenantId
      || !stored.tenantId
      || !stored.membershipId
      || !validGeneration(stored.tenantAuthorizationGeneration)
      || !validGeneration(stored.membershipAuthorizationGeneration)) {
      return null;
    }
    return {
      scopeKind: 'tenant',
      scopeId: stored.scopeId,
      tenantId: stored.tenantId,
      membershipId: stored.membershipId,
      tenantAuthorizationGeneration: stored.tenantAuthorizationGeneration,
      membershipAuthorizationGeneration: stored.membershipAuthorizationGeneration,
    };
  }
}

export function sameNativeAuthority(
  left: NativeAuthoritySnapshot,
  right: NativeAuthoritySnapshot,
): boolean {
  return left.scopeKind === right.scopeKind
    && left.scopeId === right.scopeId
    && left.tenantId === right.tenantId
    && left.membershipId === right.membershipId
    && left.tenantAuthorizationGeneration === right.tenantAuthorizationGeneration
    && left.membershipAuthorizationGeneration === right.membershipAuthorizationGeneration;
}

function applicationAuthority(): NativeAuthoritySnapshot {
  return {
    scopeKind: 'application',
    scopeId: 'application',
    tenantId: null,
    membershipId: null,
    tenantAuthorizationGeneration: null,
    membershipAuthorizationGeneration: null,
  };
}

function tenantSummary(active: ActiveTenantMembership): NativeActiveTenant {
  return {
    tenantId: active.tenant.tenantId,
    slug: active.tenant.slug,
    name: active.tenant.name,
    role: active.membership.roleKey,
  };
}

function validGeneration(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
