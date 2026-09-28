import { describe, expect, test } from 'bun:test';
import { AuthTenantOnboardingTransport } from './auth-tenant-onboarding-transport';
import type { AuthTenantJoinRequest } from './auth-types';

const projectedRequest: AuthTenantJoinRequest = {
  joinRequestId: 'tjoin_1',
  applicant: {
    userId: 'usr_1',
    username: 'applicant',
    email: 'applicant@example.test',
    firstName: null,
    lastName: null,
  },
  status: 'pending',
  requestRevision: 1,
  requestedAt: 1,
  createdAt: 1,
  updatedAt: 1,
  reviewedAt: null,
  lastDecision: null,
  membership: null,
  reactivationRequired: false,
  approvalPolicy: {
    canApprove: true,
    roleSelection: {
      mode: 'selectable',
      defaultRoleKeys: ['member'],
      maxRoleCount: 32,
      roles: [{ key: 'member', label: 'Member' }],
    },
  },
};

describe('AuthTenantOnboardingTransport', () => {
  test('uses active-tenant routes, bounded query fields, and encoded opaque ids', async () => {
    const requests: Array<{ kind: 'auth' | 'optional'; url: string; init?: RequestInit }> = [];
    const transport = createTransport(requests);
    await transport.listInvitations({
      status: 'pending',
      limit: 25,
      cursor: 'cursor/value',
    });
    await transport.issueInvitation({
      email: 'person@example.test',
      roles: ['member'],
      delivery: 'email',
    });
    await transport.revokeInvitation('tinv/a');
    await transport.approveJoinRequest('tjoin/a', {
      expectedRequestRevision: 7,
      roles: ['member'],
      reactivateMembership: true,
    });
    await transport.denyJoinRequest('tjoin/b', {
      expectedRequestRevision: 8,
    });

    expect(requests.map(({ kind, url, init }) => [kind, url, init?.method])).toEqual([
      [
        'auth',
        'https://zero.test/auth/tenant/invitations?status=pending&limit=25&cursor=cursor%2Fvalue',
        undefined,
      ],
      ['auth', 'https://zero.test/auth/tenant/invitations', 'POST'],
      ['auth', 'https://zero.test/auth/tenant/invitations/tinv%2Fa', 'DELETE'],
      ['auth', 'https://zero.test/auth/tenant/join-requests/tjoin%2Fa/approve', 'POST'],
      ['auth', 'https://zero.test/auth/tenant/join-requests/tjoin%2Fb/deny', 'POST'],
    ]);
    expect(requests.every(({ url }) => !url.includes('tenantId'))).toBe(true);
    expect(JSON.parse(String(requests[1]!.init!.body))).toEqual({
      email: 'person@example.test',
      roles: ['member'],
      delivery: 'email',
    });
    expect(JSON.parse(String(requests[3]!.init!.body))).toEqual({
      expectedRequestRevision: 7,
      roles: ['member'],
      reactivateMembership: true,
    });
    expect(JSON.parse(String(requests[4]!.init!.body))).toEqual({
      expectedRequestRevision: 8,
    });
  });

  test('preserves the reviewer-safe per-request approval policy', async () => {
    const requests: Array<{ kind: 'auth' | 'optional'; url: string; init?: RequestInit }> = [];
    const transport = createTransport(requests, {}, {
      requests: [projectedRequest],
      page: { limit: 25, count: 1, hasMore: false, nextCursor: null },
    });

    const result = await transport.listJoinRequests({ status: 'pending' });

    expect(result.requests[0]).toEqual(projectedRequest);
  });

  test('rejects malformed join pages and mutation approval policies', async () => {
    const malformedPolicies = [
      { canApprove: 'yes', roleSelection: projectedRequest.approvalPolicy.roleSelection },
      {
        canApprove: true,
        roleSelection: {
          mode: 'selectable',
          defaultRoleKeys: ['owner'],
          maxRoleCount: 32,
          roles: [{ key: 'member', label: 'Member' }],
        },
      },
      {
        canApprove: true,
        roleSelection: {
          mode: 'fixed',
          roles: [],
        },
      },
      {
        canApprove: true,
        roleSelection: {
          mode: 'default',
          roles: [{ key: 'member', label: 'Member' }],
          injected: true,
        },
      },
    ];

    for (const approvalPolicy of malformedPolicies) {
      const requests: Array<{ kind: 'auth' | 'optional'; url: string; init?: RequestInit }> = [];
      const malformed = { ...projectedRequest, approvalPolicy };
      const transport = createTransport(requests, {}, {
        requests: [malformed],
        page: { limit: 25, count: 1, hasMore: false, nextCursor: null },
      });
      await expect(transport.listJoinRequests()).rejects.toThrow(
        'invalid tenant join-request response',
      );

      const mutation = createTransport(requests, {}, { request: malformed });
      await expect(mutation.approveJoinRequest('tjoin_1', {
        expectedRequestRevision: 1,
      })).rejects.toThrow('invalid tenant join-request response');
      await expect(mutation.denyJoinRequest('tjoin_1', {
        expectedRequestRevision: 1,
      })).rejects.toThrow('invalid tenant join-request response');
    }
  });

  test('commits invitation acceptance through the shared auth session boundary', async () => {
    const requests: Array<{ kind: 'auth' | 'optional'; url: string; init?: RequestInit }> = [];
    let began = 0;
    let completed = 0;
    const transport = createTransport(requests, {
      beginAuthentication: () => {
        began += 1;
        return authenticationAttempt();
      },
      completeAuthentication: async (result) => {
        completed += 1;
        return result;
      },
    });
    const result = await transport.acceptInvitation({
      token: `zinv_${'A'.repeat(43)}`,
      continuation: 'onboarding-proof',
    });
    expect('invitationAccepted' in result && result.invitationAccepted).toBe(true);
    expect(began).toBe(1);
    expect(completed).toBe(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      kind: 'optional',
      url: 'https://zero.test/auth/invitations/accept',
      init: { method: 'POST' },
    });
  });
});

function createTransport(
  requests: Array<{ kind: 'auth' | 'optional'; url: string; init?: RequestInit }>,
  overrides: Partial<ConstructorParameters<typeof AuthTenantOnboardingTransport>[0]> = {},
  responseBody: Record<string, unknown> = {
    invitationAccepted: true,
    invitation: { invitationId: 'tinv_1' },
    invitations: [],
    requests: [],
    request: projectedRequest,
    page: { limit: 25, count: 0, hasMore: false, nextCursor: null },
  },
) {
  const response = (url: string) => Response.json(
    /\/auth\/tenant\/join-requests\/[^/]+\/(?:approve|deny)$/.test(url)
      ? { request: responseBody.request ?? projectedRequest }
      : responseBody,
  );
  return new AuthTenantOnboardingTransport({
    baseUrl: 'https://zero.test',
    authenticatedFetch: async (url, init) => {
      requests.push({ kind: 'auth', url, init });
      return response(url);
    },
    optionalAuthenticatedFetch: async (url, init) => {
      requests.push({ kind: 'optional', url, init });
      return response(url);
    },
    assertResponseCurrent: () => {},
    createResponseError: () => new Error('unexpected response error'),
    beginAuthentication: authenticationAttempt,
    failAuthentication: () => {},
    completeAuthentication: async (result) => result,
    ...overrides,
  });
}

function authenticationAttempt() {
  return {
    signal: new AbortController().signal,
    assertCurrent: () => {},
    dispose: () => {},
  };
}
