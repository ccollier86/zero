import { describe, expect, test } from 'bun:test';
import { AuthApplicationAdministrationTransport } from './auth-application-administration-transport';

describe('AuthApplicationAdministrationTransport', () => {
  test('uses only application routes and bounded list query fields', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const transport = createTransport(async (url, init) => {
      requests.push({ url, init });
      return Response.json({
        users: [],
        page: { limit: 25, count: 0, hasMore: false, nextCursor: null },
      });
    });

    const untrustedParams = {
      limit: 25,
      cursor: 'cursor/value',
      search: 'Ada & Grace',
      status: 'active' as const,
      tenantId: 'must-not-cross-this-boundary',
    };
    await transport.listUsers(untrustedParams);
    expect(requests[0]?.url).toBe(
      'https://zero.test/auth/application/users?limit=25&cursor=cursor%2Fvalue&search=Ada+%26+Grace&status=active',
    );
    expect(requests[0]?.url).not.toContain('tenant');
    expect(requests[0]?.init?.cache).toBe('no-store');
  });

  test('encodes user ids and refreshes only an actor-authority mutation', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let expirations = 0;
    const transport = createTransport(async (url, init) => {
      requests.push({ url, init });
      return Response.json({
        user: applicationUser('u/target'),
        actorAuthorizationChanged: requests.length === 2,
      });
    }, async () => { expirations += 1; return true; });

    await transport.replaceUserRoles('u/target', ['reader'], 'application:application:2');
    await transport.replaceUserRoles('u/self', [], 'application:application:4');
    expect(requests.map(({ url, init }) => [url, init?.method])).toEqual([
      ['https://zero.test/auth/application/users/u%2Ftarget/roles', 'PATCH'],
      ['https://zero.test/auth/application/users/u%2Fself/roles', 'PATCH'],
    ]);
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      roles: ['reader'],
      expectedRevision: 'application:application:2',
    });
    expect(expirations).toBe(1);
  });

  test('normalizes failures without refreshing the current session', async () => {
    const normalized = new Error('normalized application failure');
    let expirations = 0;
    const transport = new AuthApplicationAdministrationTransport({
      baseUrl: 'https://zero.test',
      authenticatedFetch: async () => Response.json(
        { code: 'FORBIDDEN', error: 'Forbidden' },
        { status: 403 },
      ),
      assertResponseCurrent: () => {},
      createResponseError: (_response, body, fallback) => {
        expect(body).toEqual({ code: 'FORBIDDEN', error: 'Forbidden' });
        expect(fallback).toBe('Failed to transfer application ownership');
        return normalized;
      },
      refreshAuthorization: async () => { expirations += 1; return true; },
    });

    await expect(transport.transferOwnership('u_target')).rejects.toBe(normalized);
    expect(expirations).toBe(0);
  });

  test('does not report a committed mutation as failed when refresh is unavailable', async () => {
    const transport = createTransport(
      async () => Response.json({
        user: applicationUser('u_self'),
        actorAuthorizationChanged: true,
      }),
      async () => { throw new Error('offline during best-effort refresh'); },
    );

    await expect(transport.replaceUserRoles(
      'u_self',
      ['reader'],
      'application:application:1',
    )).resolves.toMatchObject({
      user: { identity: { userId: 'u_self' } },
      actorAuthorizationChanged: true,
    });
  });

  test('returns a committed result when its own authorization refresh logs the actor out', async () => {
    let responseScopeInvalidated = false;
    const transport = new AuthApplicationAdministrationTransport({
      baseUrl: 'https://zero.test',
      authenticatedFetch: async () => Response.json({
        user: applicationUser('u_self'),
        actorAuthorizationChanged: true,
      }),
      assertResponseCurrent: () => {
        if (responseScopeInvalidated) throw new Error('stale response');
      },
      createResponseError: () => new Error('unexpected response error'),
      refreshAuthorization: async () => {
        responseScopeInvalidated = true;
        return false;
      },
    });

    await expect(transport.replaceUserRoles(
      'u_self',
      ['reader'],
      'application:application:1',
    )).resolves.toMatchObject({ actorAuthorizationChanged: true });
  });
});

function createTransport(
  authenticatedFetch: (url: string, init?: RequestInit) => Promise<Response>,
  refreshAuthorization: () => Promise<boolean> = async () => true,
) {
  return new AuthApplicationAdministrationTransport({
    baseUrl: 'https://zero.test',
    authenticatedFetch,
    assertResponseCurrent: () => {},
    createResponseError: () => new Error('unexpected response error'),
    refreshAuthorization,
  });
}

function applicationUser(userId: string) {
  return {
    identity: {
      userId,
      username: 'target',
      email: 'target@example.test',
      firstName: null,
      lastName: null,
    },
    status: 'active',
    roles: ['reader'],
    roleRevision: 'application:application:1',
    createdAt: 1,
    updatedAt: null,
  };
}
