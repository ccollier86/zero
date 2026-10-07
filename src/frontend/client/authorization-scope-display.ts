import type { AuthSessionTransitionOperation } from './auth-types';

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
