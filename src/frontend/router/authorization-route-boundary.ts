import type { RequestAuthorizationAccess } from '../../auth/authorization-access';
import type { AuthContext } from '../../auth/types';
import type { AuthClient } from '../client/auth-client';

/** Public-safe identity/scope marker attached to server-produced route data. */
export interface RouteAuthorizationBoundary {
  readonly userId: string | null;
  readonly platformRole: string | null;
  readonly scopeKind: 'application' | 'tenant' | null;
  readonly scopeId: string | null;
  readonly scopeRevision: string | null;
}

export interface BrowserRouteAuthorizationBoundary extends RouteAuthorizationBoundary {
  /** Scope revision is comparable only after the live authorization hint loads. */
  readonly authorizationReady: boolean;
}

/** Derive the secret-free boundary for loader data produced by this request. */
export function createRouteAuthorizationBoundary(
  auth: AuthContext | null | undefined,
  access: RequestAuthorizationAccess,
): RouteAuthorizationBoundary {
  const authorization = auth ? access.authorization : null;
  const scopeKind = auth
    ? authorization?.scopeKind ?? auth.sessionScopeKind ?? (auth.tenantId ? 'tenant' : 'application')
    : null;
  const scopeId = auth
    ? authorization?.scopeId ?? auth.sessionScopeId ?? auth.tenantId ?? 'application'
    : null;
  return Object.freeze({
    userId: auth?.userId ?? null,
    platformRole: auth?.role ?? null,
    scopeKind,
    scopeId,
    scopeRevision: authorization?.revision ?? null,
  });
}

/** Derive the corresponding boundary from the restored browser session. */
export function readBrowserRouteAuthorizationBoundary(
  auth: AuthClient | null,
): BrowserRouteAuthorizationBoundary {
  const authorizationState = auth?.authorizationState;
  const authorization = authorizationState?.snapshot?.scope ?? null;
  const user = auth?.user ?? null;
  const activeTenant = auth?.activeTenant ?? null;
  return Object.freeze({
    userId: user?.userId ?? null,
    platformRole: user?.role ?? null,
    scopeKind: user ? (activeTenant ? 'tenant' : 'application') : null,
    scopeId: user ? (activeTenant?.tenantId ?? 'application') : null,
    scopeRevision: authorization?.revision ?? null,
    authorizationReady: authorizationState?.status === 'ready'
      || authorizationState?.status === 'refreshing',
  });
}

/**
 * Loader data may enter the browser only when its page-session identity and
 * scope agree with the restored client session. Revision comparison becomes
 * strict once the browser has loaded its live authorization projection.
 */
export function routeAuthorizationBoundaryMatches(
  server: RouteAuthorizationBoundary,
  browser: BrowserRouteAuthorizationBoundary,
): boolean {
  if (server.userId !== browser.userId
    || server.platformRole !== browser.platformRole
    || server.scopeKind !== browser.scopeKind
    || server.scopeId !== browser.scopeId) return false;

  if (!browser.authorizationReady) return true;
  return server.scopeRevision === browser.scopeRevision;
}
