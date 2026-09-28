import { describe, expect, test } from 'bun:test';
import {
  AuthAuthorizationTransport,
  parseAuthAuthorizationSnapshot,
} from './auth-authorization-transport';

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
