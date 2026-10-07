import type { AuthSessionTransitionOperation } from './auth-types';
import type { AuthAuthorizationStatus } from './auth-authorization-types';

/**
 * Pure display decision for the root browser authorization boundary.
 *
 * Keeping this state transition independent from React makes the two security
 * properties easy to prove: an unstable scope never renders, and hydrated
 * server data is never reused after a committed identity/tenant replacement.
 */
export interface AuthorizationScopeDisplayDecision {
  readonly displayedScopeKey: string | null;
  readonly render: boolean;
  readonly reload: boolean;
}

export type AuthorizationScopeReloadAction =
  | 'reload'
  | 'refresh-session-and-reload'
  | 'clear-page-session-and-reload'
  | 'show-recovery';

export type HydratedAuthorizationWork = 'none' | 'wait' | 'retry-access' | 'reload-route' | 'recover-session';

/**
 * Separate unsafe live-policy loading from a failed session restoration.
 * A policy purge still masks application data, but never rotates credentials
 * merely because its replacement authorization projection has not arrived.
 */
export function resolveHydratedAuthorizationWork(input: {
  hasHydrationRoute: boolean;
  stable: boolean;
  ready: boolean;
  isRestoring: boolean;
  isLoading: boolean;
  requiresRouteReload: boolean;
  browserUserId: string | null;
  browserHasRecoverableSession: boolean;
  authorizationStatus: AuthAuthorizationStatus;
  routeIdentityMatches: boolean;
  /** Exact current-anonymous cleanup receipt owned by the core AuthClient. */
  acknowledgedPageCleanup?: boolean;
}): HydratedAuthorizationWork {
  if (!input.hasHydrationRoute) return 'none';
  if (!input.stable || input.isRestoring || input.isLoading) return 'wait';
  if (!input.browserUserId && input.browserHasRecoverableSession) return 'recover-session';
  if (!input.ready) {
    // Definitive-denial cleanup may have retained proof because its shared
    // credential lock was unavailable. Only a settled scope offers retry;
    // an admitted cleanup remains masked by the earlier stable/loading fence.
    return input.browserUserId && (input.authorizationStatus === 'error'
      || input.authorizationStatus === 'revoked') ? 'retry-access' : 'wait';
  }
  if (input.requiresRouteReload && input.browserUserId) {
    // A provisional identity match is sufficient for ordinary initial UI,
    // not for declaring a mismatched document repaired. Validate its current
    // grants before reloading or reusing server-produced loader data.
    if (input.authorizationStatus === 'error') return 'retry-access';
    if (input.authorizationStatus !== 'ready' && input.authorizationStatus !== 'refreshing') return 'wait';
  }
  if (!input.requiresRouteReload) return 'none';
  // Only the core's server-acknowledged, current-anonymous receipt can avoid
  // another cookie-clearing writer. Display history is not cleanup evidence.
  if (!input.browserUserId && !input.browserHasRecoverableSession
    && input.acknowledgedPageCleanup) return 'reload-route';
  return input.routeIdentityMatches ? 'reload-route' : 'recover-session';
}

/** Accessible status copy while the protected subtree is intentionally masked. */
export function authorizationScopeTransitionMessage(
  operation: AuthSessionTransitionOperation | null,
): string {
  if (operation === 'authentication') return 'Signing in securely…';
  if (operation === 'logout') return 'Signing out securely…';
  if (operation === 'tenant-switch') return 'Switching secure access…';
  if (operation === 'tenant-select') return 'Opening secure access…';
  if (operation === 'tenant-create') return 'Opening your new secure workspace…';
  if (operation === 'external-session') return 'Updating your secure session…';
  return 'Restoring your secure session…';
}

/**
 * Normalize the initial SSR comparison. A route payload from an older cached
 * renderer has no trustworthy origin when it omits the boundary, so a
 * hydrated route treats both `undefined` and `null` as a mismatch.
 */
export function resolveHydrationScopeMatch(
  hasHydrationRoute: boolean,
  boundaryMatches: boolean | null | undefined,
): boolean | undefined {
  if (!hasHydrationRoute) return undefined;
  return boundaryMatches === true;
}

/** Decide one bounded recovery action for an initial server/browser mismatch. */
export function resolveAuthorizationScopeReloadAction(input: {
  recordedReloadKey: string | null;
  reloadKey: string;
  serverUserId: string | null;
  browserUserId: string | null;
  browserHasRecoverableSession?: boolean;
}): AuthorizationScopeReloadAction {
  if (input.recordedReloadKey === input.reloadKey) return 'show-recovery';
  // A transient restore can retain rotating proof without a hydrated user.
  // That is recoverable authentication, not a server-only cookie to discard.
  if (input.browserUserId || input.browserHasRecoverableSession) {
    return 'refresh-session-and-reload';
  }
  if (input.serverUserId && !input.browserUserId) {
    return 'clear-page-session-and-reload';
  }
  return 'reload';
}

/** An attempt marker survives provisional restoration and access-hint states. */
export function isHydrationScopeRecoverySettled(input: {
  ready: boolean;
  isRestoring: boolean;
  isLoading: boolean;
  hasHydrationRoute: boolean;
  hydrationScopeMatches?: boolean;
  browserUserId: string | null;
  browserHasRecoverableSession: boolean;
  authorizationReady: boolean;
}): boolean {
  if (!input.ready || input.isRestoring || input.isLoading) return false;
  if (input.hasHydrationRoute && input.hydrationScopeMatches !== true) return false;
  return input.browserUserId
    ? input.authorizationReady
    : !input.browserHasRecoverableSession;
}

export function resolveAuthorizationScopeDisplay(input: {
  displayedScopeKey: string | null;
  currentScopeKey: string;
  ready: boolean;
  hasHydrationRoute: boolean;
  hydrationScopeMatches?: boolean;
}): AuthorizationScopeDisplayDecision {
  if (!input.ready) {
    return Object.freeze({
      displayedScopeKey: input.displayedScopeKey,
      render: false,
      reload: false,
    });
  }

  if (input.hasHydrationRoute && input.hydrationScopeMatches === false) {
    return Object.freeze({
      displayedScopeKey: input.displayedScopeKey,
      render: false,
      reload: true,
    });
  }

  if (input.displayedScopeKey === null) {
    return Object.freeze({
      displayedScopeKey: input.currentScopeKey,
      render: true,
      reload: false,
    });
  }

  if (input.displayedScopeKey === input.currentScopeKey) {
    return Object.freeze({
      displayedScopeKey: input.displayedScopeKey,
      render: true,
      reload: false,
    });
  }

  if (input.hasHydrationRoute) {
    return Object.freeze({
      displayedScopeKey: input.displayedScopeKey,
      render: false,
      reload: true,
    });
  }

  return Object.freeze({
    displayedScopeKey: input.currentScopeKey,
    render: true,
    reload: false,
  });
}
