import { describe, expect, test } from 'bun:test';
import type { RequestAuthorizationAccess } from '../../auth/authorization-access';
import type { AuthClient } from '../client/auth-client';
import {
  createRouteAuthorizationBoundary,
  readBrowserRouteAuthorizationBoundary,
  routeAuthorizationBoundaryMatches,
  type BrowserRouteAuthorizationBoundary,
  type RouteAuthorizationBoundary,
} from './authorization-route-boundary';

describe('server/browser route authorization boundary', () => {
  test('embeds only the public identity, scope, and authorization revision', () => {
    const server = createRouteAuthorizationBoundary({
      userId: 'user-a',
      email: 'private@example.test',
      role: 'admin',
      sessionScopeKind: 'tenant',
      sessionScopeId: 'tenant-a',
      tenantId: 'tenant-a',
    }, {
      authorization: {
        scopeKind: 'tenant',
        scopeId: 'tenant-a',
        revision: 'tenant:tenant-a:membership-a:4',
      },
    } as RequestAuthorizationAccess);

    expect(server).toEqual({
      userId: 'user-a',
      platformRole: 'admin',
      scopeKind: 'tenant',
      scopeId: 'tenant-a',
      scopeRevision: 'tenant:tenant-a:membership-a:4',
    });
    expect(JSON.stringify(server)).not.toContain('private@example.test');
  });

  test('matches a restored browser session only to the same user and tenant', () => {
    const server = tenantBoundary();
    const browser = browserBoundary();
    expect(routeAuthorizationBoundaryMatches(server, browser)).toBe(true);
    expect(routeAuthorizationBoundaryMatches(server, {
      ...browser,
      userId: 'user-b',
    })).toBe(false);
    expect(routeAuthorizationBoundaryMatches(server, {
      ...browser,
      scopeId: 'tenant-b',
    })).toBe(false);
    expect(routeAuthorizationBoundaryMatches(server, {
      ...browser,
      platformRole: 'user',
    })).toBe(false);
    expect(routeAuthorizationBoundaryMatches(server, {
      userId: null,
      platformRole: null,
      scopeKind: null,
      scopeId: null,
      scopeRevision: null,
      authorizationReady: true,
    })).toBe(false);
  });

  test('defers revision comparison while authorization restores, then rejects stale loader data', () => {
    const server = tenantBoundary();
    expect(routeAuthorizationBoundaryMatches(server, {
      ...browserBoundary(),
      authorizationReady: false,
      scopeRevision: null,
    })).toBe(true);
    expect(routeAuthorizationBoundaryMatches(server, {
      ...browserBoundary(),
      scopeRevision: 'tenant:tenant-a:membership-a:5',
    })).toBe(false);
  });

  test('derives application and tenant identities without exposing browser credentials', () => {
    const application = readBrowserRouteAuthorizationBoundary({
      user: { userId: 'user-a', role: 'admin' },
      activeTenant: null,
      authorizationState: { status: 'loading', snapshot: null, error: null },
    } as unknown as AuthClient);
    expect(application).toEqual({
      userId: 'user-a',
      platformRole: 'admin',
      scopeKind: 'application',
      scopeId: 'application',
      scopeRevision: null,
      authorizationReady: false,
    });

    const tenant = readBrowserRouteAuthorizationBoundary({
      user: { userId: 'user-a', role: 'admin' },
      activeTenant: { tenantId: 'tenant-a' },
      authorizationState: {
        status: 'ready',
        snapshot: { scope: { revision: 'revision-a' } },
        error: null,
      },
    } as unknown as AuthClient);
    expect(tenant.scopeKind).toBe('tenant');
    expect(tenant.scopeId).toBe('tenant-a');
    expect(tenant.scopeRevision).toBe('revision-a');
    expect('accessToken' in tenant).toBe(false);
  });
});

function tenantBoundary(): RouteAuthorizationBoundary {
  return {
    userId: 'user-a',
    platformRole: 'admin',
    scopeKind: 'tenant',
    scopeId: 'tenant-a',
    scopeRevision: 'tenant:tenant-a:membership-a:4',
  };
}

function browserBoundary(): BrowserRouteAuthorizationBoundary {
  return {
    ...tenantBoundary(),
    authorizationReady: true,
  };
}
