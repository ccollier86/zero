import { describe, expect, test } from 'bun:test';
import {
  authorizationScopeTransitionMessage,
  isHydrationScopeRecoverySettled,
  resolveAuthorizationScopeDisplay,
  resolveAuthorizationScopeReloadAction,
  resolveHydrationScopeMatch,
  resolveHydratedAuthorizationWork,
} from './authorization-scope-display';

describe('root authorization-scope display boundary', () => {
  test('authorization revalidation is not a failed session restoration', () => {
    const input = { hasHydrationRoute: true, stable: true, ready: false,
      isRestoring: false, isLoading: false, requiresRouteReload: false,
      browserUserId: 'user-a', browserHasRecoverableSession: true,
      authorizationStatus: 'loading' as const, routeIdentityMatches: true };
    expect(resolveHydratedAuthorizationWork(input)).toBe('wait');
    expect(resolveHydratedAuthorizationWork({ ...input, authorizationStatus: 'error' })).toBe('retry-access');
    expect(resolveHydratedAuthorizationWork({ ...input, authorizationStatus: 'revoked' })).toBe('retry-access');
    expect(resolveHydratedAuthorizationWork({ ...input, authorizationStatus: 'revoked', stable: false })).toBe('wait');
    expect(resolveHydratedAuthorizationWork({ ...input, authorizationStatus: 'revoked', isLoading: true })).toBe('wait');
    expect(resolveHydratedAuthorizationWork({ ...input, browserUserId: null })).toBe('recover-session');
    expect(resolveHydratedAuthorizationWork({ ...input, browserUserId: null, isRestoring: true })).toBe('wait');
    expect(resolveHydratedAuthorizationWork({ ...input, hasHydrationRoute: false })).toBe('none');
  });

  test('stale same-identity loader authority reloads without rotating credentials', () => {
    const input = { hasHydrationRoute: true, stable: true, ready: true,
      isRestoring: false, isLoading: false, requiresRouteReload: true,
      browserUserId: 'user-a', browserHasRecoverableSession: true,
      authorizationStatus: 'ready' as const, routeIdentityMatches: true };
    expect(resolveHydratedAuthorizationWork(input)).toBe('reload-route');
    expect(resolveHydratedAuthorizationWork({ ...input, routeIdentityMatches: false })).toBe('recover-session');
    expect(resolveHydratedAuthorizationWork({ ...input, requiresRouteReload: false })).toBe('none');
    expect(resolveHydratedAuthorizationWork({ ...input, stable: false })).toBe('wait');
    expect(resolveHydratedAuthorizationWork({ ...input, authorizationStatus: 'loading' })).toBe('wait');
    expect(resolveHydratedAuthorizationWork({ ...input, authorizationStatus: 'error' })).toBe('retry-access');
    const signedOut = { ...input, browserUserId: null, browserHasRecoverableSession: false,
      authorizationStatus: 'unauthenticated' as const, routeIdentityMatches: false };
    expect(resolveHydratedAuthorizationWork(signedOut)).toBe('recover-session');
    expect(resolveHydratedAuthorizationWork({ ...signedOut, acknowledgedPageCleanup: false })).toBe('recover-session');
    expect(resolveHydratedAuthorizationWork({ ...signedOut, acknowledgedPageCleanup: true })).toBe('reload-route');
    expect(resolveHydratedAuthorizationWork({ ...input, routeIdentityMatches: false, acknowledgedPageCleanup: true }))
      .toBe('recover-session');
  });
  test('describes masked scope transitions without leaking tenant terminology', () => {
    expect(authorizationScopeTransitionMessage('tenant-switch'))
      .toBe('Switching secure access…');
    expect(authorizationScopeTransitionMessage('external-session'))
      .toBe('Updating your secure session…');
    expect(authorizationScopeTransitionMessage(null))
      .toBe('Restoring your secure session…');
  });

  test('hides initial restoration and adopts the first committed scope without reload', () => {
    expect(resolveAuthorizationScopeDisplay({
      displayedScopeKey: null,
      currentScopeKey: 'restoring',
      ready: false,
      hasHydrationRoute: false,
    })).toEqual({ displayedScopeKey: null, render: false, reload: false });

    expect(resolveAuthorizationScopeDisplay({
      displayedScopeKey: null,
      currentScopeKey: 'tenant-a',
      ready: true,
      hasHydrationRoute: false,
    })).toEqual({ displayedScopeKey: 'tenant-a', render: true, reload: false });
  });

  test('fails closed when a hydrated payload has no server authorization boundary', () => {
    expect(resolveHydrationScopeMatch(true, undefined)).toBe(false);
    expect(resolveHydrationScopeMatch(true, null)).toBe(false);
    expect(resolveHydrationScopeMatch(true, true)).toBe(true);
    expect(resolveHydrationScopeMatch(false, undefined)).toBeUndefined();

    expect(resolveAuthorizationScopeDisplay({
      displayedScopeKey: null,
      currentScopeKey: 'tenant-a',
      ready: true,
      hasHydrationRoute: true,
      hydrationScopeMatches: false,
    })).toEqual({ displayedScopeKey: null, render: false, reload: true });
  });

  test('reloads instead of adopting loader data from a different server session', () => {
    expect(resolveAuthorizationScopeDisplay({
      displayedScopeKey: null,
      currentScopeKey: 'tenant-b',
      ready: true,
      hasHydrationRoute: true,
      hydrationScopeMatches: false,
    })).toEqual({ displayedScopeKey: null, render: false, reload: true });

    expect(resolveAuthorizationScopeDisplay({
      displayedScopeKey: null,
      currentScopeKey: 'tenant-a',
      ready: true,
      hasHydrationRoute: true,
      hydrationScopeMatches: true,
    })).toEqual({ displayedScopeKey: 'tenant-a', render: true, reload: false });
  });

  test('hides transitions and restores the same scope after a pre-commit abort', () => {
    expect(resolveAuthorizationScopeDisplay({
      displayedScopeKey: 'tenant-a',
      currentScopeKey: 'tenant-a',
      ready: false,
      hasHydrationRoute: true,
    })).toEqual({ displayedScopeKey: 'tenant-a', render: false, reload: false });

    expect(resolveAuthorizationScopeDisplay({
      displayedScopeKey: 'tenant-a',
      currentScopeKey: 'tenant-a',
      ready: true,
      hasHydrationRoute: true,
    })).toEqual({ displayedScopeKey: 'tenant-a', render: true, reload: false });
  });

  test('requires a reload before hydrated loader data can enter a replacement scope', () => {
    expect(resolveAuthorizationScopeDisplay({
      displayedScopeKey: 'tenant-a',
      currentScopeKey: 'tenant-b',
      ready: true,
      hasHydrationRoute: true,
    })).toEqual({ displayedScopeKey: 'tenant-a', render: false, reload: true });
  });

  test('uses a keyed remount when no server loader payload exists', () => {
    expect(resolveAuthorizationScopeDisplay({
      displayedScopeKey: 'tenant-a',
      currentScopeKey: 'tenant-b',
      ready: true,
      hasHydrationRoute: false,
    })).toEqual({ displayedScopeKey: 'tenant-b', render: true, reload: false });
  });

  test('clears a server-only page session once and then offers deterministic recovery', () => {
    const reloadKey = 'server-a/browser-anonymous';
    expect(resolveAuthorizationScopeReloadAction({
      recordedReloadKey: null,
      reloadKey,
      serverUserId: 'user-a',
      browserUserId: null,
    })).toBe('clear-page-session-and-reload');

    expect(resolveAuthorizationScopeReloadAction({
      recordedReloadKey: reloadKey,
      reloadKey,
      serverUserId: 'user-a',
      browserUserId: null,
    })).toBe('show-recovery');
  });

  test('repairs a mismatched authenticated browser before reloading without logging it out', () => {
    expect(resolveAuthorizationScopeReloadAction({
      recordedReloadKey: null,
      reloadKey: 'server-a/browser-b',
      serverUserId: 'user-a',
      browserUserId: 'user-b',
    })).toBe('refresh-session-and-reload');
  });

  test('a retained proof without a user is recoverable rather than a server-only page session', () => {
    expect(resolveAuthorizationScopeReloadAction({
      recordedReloadKey: null,
      reloadKey: 'server-a/browser-restoration-failed',
      serverUserId: 'user-a',
      browserUserId: null,
      browserHasRecoverableSession: true,
    })).toBe('refresh-session-and-reload');
  });

  test('does not clear a bounded attempt during restoration, unreadable data or provisional revision matching', () => {
    const settled = {
      ready: true, isRestoring: false, isLoading: false,
      hasHydrationRoute: true, hydrationScopeMatches: true,
      browserUserId: 'user-a', browserHasRecoverableSession: true,
      authorizationReady: true,
    };
    expect(isHydrationScopeRecoverySettled(settled)).toBe(true);
    expect(isHydrationScopeRecoverySettled({ ...settled, isRestoring: true })).toBe(false);
    expect(isHydrationScopeRecoverySettled({ ...settled, isLoading: true })).toBe(false);
    expect(isHydrationScopeRecoverySettled({ ...settled, ready: false })).toBe(false);
    expect(isHydrationScopeRecoverySettled({ ...settled, authorizationReady: false })).toBe(false);
    expect(isHydrationScopeRecoverySettled({ ...settled, hydrationScopeMatches: false })).toBe(false);
    expect(isHydrationScopeRecoverySettled({ ...settled, browserUserId: null })).toBe(false);
    expect(isHydrationScopeRecoverySettled({
      ...settled, browserUserId: null, browserHasRecoverableSession: false,
      authorizationReady: false,
    })).toBe(true);
  });
});
