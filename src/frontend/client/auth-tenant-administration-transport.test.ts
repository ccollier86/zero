import { describe, expect, test } from 'bun:test';
import { AuthTenantAdministrationTransport } from './auth-tenant-administration-transport';

describe('AuthTenantAdministrationTransport', () => {
  test('uses only active-tenant routes and bounded list query fields', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const transport = createTransport(async (url, init) => {
      requests.push({ url, init });
      return Response.json({
        members: [],
        page: { limit: 25, count: 0, hasMore: false, nextCursor: null },
      });
    });

    await transport.listMembers({
      limit: 25,
      cursor: 'cursor/value',
      search: 'Ada & Grace',
      status: 'active',
    });

    expect(requests[0]?.url).toBe(
      'https://zero.test/auth/tenant/members?limit=25&cursor=cursor%2Fvalue&search=Ada+%26+Grace&status=active',
    );
    expect(requests[0]?.url).not.toContain('tenantId');
  });

  test('encodes membership ids, uses one mode-neutral roles array, and expires self-mutated sessions', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let expirations = 0;
    const transport = createTransport(async (url, init) => {
      requests.push({ url, init });
      return Response.json({
        member: member('tmem/a'),
        actorSessionInvalidated: requests.length === 2,
      });
    }, () => { expirations += 1; });

    await transport.addMember({
      email: 'member@example.test',
      roles: ['member'],
    });
    await transport.updateMember('tmem/a', {
      status: 'suspended',
      roles: ['manager'],
      expectedRoleRevision: 'tenant:t_a:tmem/a:4',
    });

    expect(requests.map(({ url, init }) => [url, init?.method])).toEqual([
      ['https://zero.test/auth/tenant/members', 'POST'],
      ['https://zero.test/auth/tenant/members/tmem%2Fa', 'PATCH'],
    ]);
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      email: 'member@example.test',
      roles: ['member'],
    });
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
      status: 'suspended',
      roles: ['manager'],
      expectedRoleRevision: 'tenant:t_a:tmem/a:4',
    });
    expect(expirations).toBe(1);
  });

  test('returns the committed receipt after its own actor-session invalidation', async () => {
    let expired = false;
    const transport = new AuthTenantAdministrationTransport({
      baseUrl: 'https://zero.test',
      authenticatedFetch: async () => Response.json({
        member: member('tmem/self'),
        actorSessionInvalidated: true,
      }),
      createResponseError: () => new Error('unexpected response error'),
      assertResponseCurrent: () => {
        if (expired) throw new Error('stale response');
      },
      expireSession: () => { expired = true; },
    });

    await expect(transport.removeMember('tmem/self')).resolves.toMatchObject({
      actorSessionInvalidated: true,
    });
    expect(expired).toBe(true);
  });

  test('normalizes response failures without leaking into session invalidation', async () => {
    const normalized = new Error('normalized tenant failure');
    let expirations = 0;
    const transport = new AuthTenantAdministrationTransport({
      baseUrl: 'https://zero.test',
      authenticatedFetch: async () => Response.json(
        { code: 'FORBIDDEN', error: 'Forbidden' },
        { status: 403 },
      ),
      assertResponseCurrent: () => {},
      createResponseError: (_response, body, fallback) => {
        expect(body).toEqual({ code: 'FORBIDDEN', error: 'Forbidden' });
        expect(fallback).toBe('Failed to transfer tenant ownership');
        return normalized;
      },
      expireSession: () => { expirations += 1; },
    });

    await expect(transport.transferOwnership('tmem_target')).rejects.toBe(normalized);
    expect(expirations).toBe(0);
  });
});

function createTransport(
  authenticatedFetch: (url: string, init?: RequestInit) => Promise<Response>,
  expireSession: () => void = () => {},
) {
  return new AuthTenantAdministrationTransport({
    baseUrl: 'https://zero.test',
    authenticatedFetch,
    assertResponseCurrent: () => {},
    createResponseError: () => new Error('unexpected response error'),
    expireSession,
  });
}

function member(membershipId: string) {
  return {
    membershipId,
    identity: {
      userId: 'u_member',
      username: 'member',
      email: 'member@example.test',
      firstName: null,
      lastName: null,
    },
    status: 'active',
    roles: ['member'],
    roleRevision: `tenant:t_a:${membershipId}:1`,
    joinedAt: 1,
    updatedAt: 1,
  };
}
