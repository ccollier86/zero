/**
 * auth-policy.test.ts
 *
 * Verifies shared route-auth policy helpers. These tests do not verify tokens,
 * render React, or mount the server router.
 */

import { describe, expect, test } from 'bun:test';

import {
  isPublicPath,
  mergeRouteAuthRequirements,
  resolveRouteAuthMode,
  shouldRequireAuthForRoute,
} from './auth-policy';

describe('route auth policy', () => {
  test('treats an optional trailing slash as the same public route', () => {
    expect(isPublicPath('/login', ['/login/'])).toBe(true);
    expect(isPublicPath('/login/', ['/login'])).toBe(true);
    expect(isPublicPath('/login/help', ['/login/'])).toBe(true);
    expect(isPublicPath('/dashboard', ['/'])).toBe(false);
  });

  test('preserves protected-by-default behavior for auth-enabled apps', () => {
    expect(resolveRouteAuthMode(undefined, true)).toBe('protected-by-default');
    expect(resolveRouteAuthMode(undefined, false)).toBe('explicit');
  });

  test('requires auth for non-public paths in protected-by-default mode', () => {
    expect(shouldRequireAuthForRoute({
      routeAuth: 'protected-by-default',
      pathname: '/dashboard',
      publicPaths: ['/login'],
      routeRequirement: false,
    })).toBe(true);

    expect(shouldRequireAuthForRoute({
      routeAuth: 'protected-by-default',
      pathname: '/login',
      publicPaths: ['/login'],
      routeRequirement: false,
    })).toBe(false);
  });

  test('uses route config only in explicit mode', () => {
    expect(shouldRequireAuthForRoute({
      routeAuth: 'explicit',
      pathname: '/dashboard',
      publicPaths: ['/login'],
      routeRequirement: false,
    })).toBe(false);

    expect(shouldRequireAuthForRoute({
      routeAuth: 'explicit',
      pathname: '/dashboard',
      publicPaths: ['/login'],
      routeRequirement: 'required',
    })).toBe(true);
  });

  test('merges parent and child route requirements without allowing child escape', () => {
    expect(mergeRouteAuthRequirements([undefined, false])).toBe(false);
    expect(mergeRouteAuthRequirements(['required', false])).toBe('required');
    expect(mergeRouteAuthRequirements(['required', 'admin'])).toBe('admin');
  });
});
