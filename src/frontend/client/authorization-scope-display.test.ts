import { describe, expect, test } from 'bun:test';
import {
  authorizationScopeTransitionMessage,
  resolveAuthorizationScopeDisplay,
  resolveAuthorizationScopeReloadAction,
  resolveHydrationScopeMatch,
} from './authorization-scope-display';

describe('root authorization-scope display boundary', () => {
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

  test('reloads a mismatched authenticated browser without logging it out', () => {
    expect(resolveAuthorizationScopeReloadAction({
      recordedReloadKey: null,
      reloadKey: 'server-a/browser-b',
      serverUserId: 'user-a',
      browserUserId: 'user-b',
    })).toBe('reload');
  });
});
