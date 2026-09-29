import { describe, expect, test } from 'bun:test';
import {
  AuthAuthorizationTransport,
  parseAuthAuthorizationSnapshot,
} from './auth-authorization-transport';
import { hasAuthorizationPermission } from './auth-authorization-types';

describe('AuthAuthorizationTransport', () => {
  test('uses the dedicated authenticated endpoint and parses a safe scope', async () => {
    let requested: { url: string; init?: RequestInit } | null = null;
    const transport = new AuthAuthorizationTransport({
      baseUrl: 'https://zero.test',
      authenticatedFetch: async (url, init) => {
        requested = { url, init };
        return Response.json(validSnapshot());
      },
      assertResponseCurrent: () => {},
      createResponseError: () => new Error('unexpected'),
    });

    await expect(transport.getCurrent()).resolves.toMatchObject({
      identity: { userId: 'user-1' },
      scope: { kind: 'application', permissions: ['records:read'] },
    });
    expect(requested).toMatchObject({
      url: 'https://zero.test/auth/authorization',
      init: { method: 'GET', cache: 'no-store' },
    });
  });

  test('rejects malformed and cross-profile scope projections', () => {
    expect(() => parseAuthAuthorizationSnapshot({})).toThrow('invalid');
    expect(() => parseAuthAuthorizationSnapshot({
      ...validSnapshot(),
      profile: { tenancy: 'single', authorization: 'advanced' },
      scope: {
        ...validSnapshot().scope,
        kind: 'tenant',
        tenantId: 'tenant-1',
        membershipId: 'membership-1',
      },
    })).toThrow('invalid');
    expect(() => parseAuthAuthorizationSnapshot({
      ...validSnapshot(),
      applicationScope: {
        ...validSnapshot().scope,
        kind: 'tenant',
        tenantId: 'tenant-1',
        membershipId: 'membership-1',
      },
    })).toThrow('invalid');
    expect(() => parseAuthAuthorizationSnapshot({
      ...validSnapshot(),
      applicationScope: {
        ...validSnapshot().scope,
        permissions: ['application.users:read'],
      },
    })).toThrow('invalid');
    expect(() => parseAuthAuthorizationSnapshot({
      ...validSnapshot(),
      profile: { tenancy: 'multi', authorization: 'advanced' },
      scope: {
        kind: 'tenant',
        scopeId: 'tenant-admin',
        tenantId: 'tenant-admin',
        membershipId: 'membership-admin',
        roles: ['administrator'],
        permissions: ['tenant:read'],
        allPermissions: false,
        revision: 'tenant-scope-1',
      },
      applicationScope: {
        kind: 'application',
        scopeId: 'wrong-scope',
        roles: ['administrator'],
        permissions: ['application.users:read'],
        allPermissions: false,
        revision: 'application-scope-1',
      },
    })).toThrow('invalid');
    expect(() => parseAuthAuthorizationSnapshot({
      ...validSnapshot(),
      scope: {
        ...validSnapshot().scope,
        roles: ['reader', 'reader'],
      },
    })).toThrow('invalid');
  });

  test('parses a separate administration application scope for permission hints', () => {
    const parsed = parseAuthAuthorizationSnapshot({
      ...validSnapshot(),
      profile: { tenancy: 'multi', authorization: 'advanced' },
      scope: {
        kind: 'tenant',
        scopeId: 'tenant-admin',
        tenantId: 'tenant-admin',
        membershipId: 'membership-admin',
        roles: ['administrator'],
        permissions: ['tenant:read'],
        allPermissions: false,
        revision: 'tenant-scope-1',
      },
      applicationScope: {
        kind: 'application',
        scopeId: 'application',
        roles: ['administrator'],
        permissions: ['application.users:read'],
        allPermissions: false,
        revision: 'application-scope-1',
      },
    });
    expect(hasAuthorizationPermission(parsed, 'tenant:read')).toBe(true);
    expect(hasAuthorizationPermission(parsed, 'application.users:read')).toBe(true);
    expect(hasAuthorizationPermission(parsed, 'application.users:manage')).toBe(false);
  });
});

function validSnapshot() {
  return {
    version: 1,
    identity: { userId: 'user-1', platformRole: 'user' },
    profile: { tenancy: 'single', authorization: 'advanced' },
    scope: {
      kind: 'application',
      scopeId: 'application',
      roles: ['reader'],
      permissions: ['records:read'],
      allPermissions: false,
      revision: 'scope-1',
    },
    revision: 'revision-1',
  };
}
