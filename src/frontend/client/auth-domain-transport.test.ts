import { describe, expect, test } from 'bun:test';
import {
  AuthDomainOnboardingTransport,
  AuthTenantDomainTransport,
  parseAuthDomainOnboardingCompletion,
  parseAuthTenantDomainAdministration,
  parseAuthTenantDomainReleaseResult,
} from './auth-domain-transport';

describe('verified-domain browser transports', () => {
  test('uses active-tenant routes and keeps TXT plaintext only in issue responses', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const transport = new AuthTenantDomainTransport({
      baseUrl: 'https://zero.test',
      authenticatedFetch: async (url, init) => {
        requests.push({ url, init });
        if (url.endsWith('/release')) {
          return Response.json({
            release: {
              claimId: 'claim/a',
              domain: 'example.com',
              releasedAt: 2_000,
              quarantineUntil: 3_000,
            },
          });
        }
        return Response.json({
          claim: claim(),
          challenge: {
            recordType: 'TXT',
            name: '_zero-auth.example.com',
            value: 'zero-domain-proof-secret',
            expiresAt: 2_000,
          },
        });
      },
      assertResponseCurrent: () => {},
      createResponseError: () => new Error('unexpected'),
    });

    const created = await transport.createClaim('example.com');
    await transport.issueChallenge('claim/a', 'claim-revision-1');
    await transport.verifyClaim('claim/a', 'claim-revision-1');
    await transport.updatePolicy('claim/a', {
      enabled: true,
      requestRoleKey: 'member',
      expectedRevision: 'policy-revision-1',
    });
    await transport.releaseClaim('claim/a', {
      expectedRevision: 'claim-revision-1',
      expectedPolicyRevision: 'policy-revision-1',
      confirmDomain: 'example.com',
    });

    expect(created.challenge.value).toBe('zero-domain-proof-secret');
    expect(requests.map(({ url, init }) => [url, init?.method, init?.cache])).toEqual([
      ['https://zero.test/auth/tenant/domains', 'POST', 'no-store'],
      ['https://zero.test/auth/tenant/domains/claim%2Fa/challenges', 'POST', 'no-store'],
      ['https://zero.test/auth/tenant/domains/claim%2Fa/verify', 'POST', 'no-store'],
      ['https://zero.test/auth/tenant/domains/claim%2Fa/policy', 'PATCH', 'no-store'],
      ['https://zero.test/auth/tenant/domains/claim%2Fa/release', 'POST', 'no-store'],
    ]);
    expect(requests.every(({ url }) => !url.includes('tenantId'))).toBe(true);
    expect(JSON.parse(String(requests[1]!.init?.body))).toEqual({
      expectedRevision: 'claim-revision-1',
    });
    expect(JSON.parse(String(requests[4]!.init?.body))).toEqual({
      expectedRevision: 'claim-revision-1',
      expectedPolicyRevision: 'policy-revision-1',
      confirmDomain: 'example.com',
    });
    expect(JSON.stringify(requests[4])).not.toContain('tenantId');
  });

  test('start never sends email and admit sends no tenant, domain, or role authority', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const transport = new AuthDomainOnboardingTransport({
      baseUrl: 'https://zero.test',
      optionalAuthenticatedFetch: async (url, init) => {
        requests.push({ url, init });
        if (url.endsWith('/start')) return Response.json({ accepted: true });
        if (url.endsWith('/complete')) return Response.json(completion());
        return Response.json({
          request: {
            joinRequestId: 'join-1',
            status: 'pending',
            createdAt: 100,
            tenant: { name: 'Acme', slug: 'acme' },
          },
        });
      },
      assertResponseCurrent: () => {},
      createResponseError: () => new Error('unexpected'),
    });

    await transport.start('identity-proof');
    await transport.complete('mailbox-proof-token');
    await transport.admit('domain-continuation', 'identity-proof');

    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({
      identityContinuation: 'identity-proof',
    });
    expect(JSON.parse(String(requests[1]!.init?.body))).toEqual({
      proofToken: 'mailbox-proof-token',
    });
    expect(JSON.parse(String(requests[2]!.init?.body))).toEqual({
      continuation: 'domain-continuation',
      identityContinuation: 'identity-proof',
    });
    expect(JSON.stringify(requests)).not.toContain('tenantId');
    expect(JSON.stringify(requests)).not.toContain('roleKey');
    expect(JSON.stringify(requests)).not.toContain('email');
  });

  test('strict parsers reconstruct only safe fields and reject unsupported lifecycle/action values', () => {
    const parsed = parseAuthTenantDomainAdministration({
      actor: { capabilities: capabilities() },
      requestRoles: [{ key: 'member', label: 'Member', tokenDigest: 'secret' }],
      claims: [{
        ...claim(),
        tokenDigest: 'secret',
        leaseOwner: 'worker-1',
        challenge: { value: 'plaintext-must-not-project' },
      }],
      refreshToken: 'never-return-this',
    });
    expect(parsed).toEqual({
      actor: { capabilities: capabilities() },
      requestRoles: [{ key: 'member', label: 'Member' }],
      claims: [claim()],
    });
    expect(JSON.stringify(parsed)).not.toContain('secret');
    expect(JSON.stringify(parsed)).not.toContain('plaintext-must-not-project');
    const postProof = parseAuthDomainOnboardingCompletion({
      ...completion(),
      option: {
        ...completion().option,
        tenant: {
          ...completion().option.tenant,
          tenantId: 'must-not-project',
          domain: 'example.com',
        },
        requestedRoleKey: 'owner',
      },
      refreshToken: 'must-not-project',
    });
    expect(postProof).toEqual(completion());
    expect(JSON.stringify(postProof)).not.toContain('tenantId');
    expect(JSON.stringify(postProof)).not.toContain('requestedRoleKey');
    expect(() => parseAuthTenantDomainAdministration({
      actor: { capabilities: capabilities() },
      requestRoles: [],
      claims: [{ ...claim(), status: 'quarantined' }],
    })).toThrow('invalid verified-domain response');
    expect(() => parseAuthDomainOnboardingCompletion({
      option: { action: 'auto-join', tenant: { name: 'Acme', slug: 'acme' } },
      continuation: 'proof',
      expiresAt: 1,
    })).toThrow('invalid verified-domain response');
    expect(() => parseAuthTenantDomainReleaseResult({
      release: {
        claimId: 'claim/a',
        domain: 'example.com',
        releasedAt: 2_000,
        quarantineUntil: 1_999,
      },
    })).toThrow('invalid verified-domain response');
  });
});

function capabilities() {
  return {
    canReadDomains: true,
    canCreateDomains: true,
    canVerifyDomains: true,
    canManagePolicy: true,
    canReleaseDomains: true,
  };
}

function policy() {
  return {
    enabled: false,
    admission: 'request-to-join',
    requestRoleKey: null,
    revision: 'policy-revision-1',
  } as const;
}

function claim() {
  return {
    claimId: 'claim/a',
    domain: 'example.com',
    status: 'pending',
    proofMethod: 'dns-txt',
    verifiedAt: null,
    lastCheckedAt: null,
    nextCheckAt: null,
    validUntil: null,
    challengeExpiresAt: 2_000,
    policy: policy(),
    revision: 'claim-revision-1',
    createdAt: 1,
    updatedAt: 1,
  } as const;
}

function completion() {
  return {
    option: {
      action: 'request-to-join',
      tenant: { name: 'Acme', slug: 'acme' },
    },
    continuation: 'domain-continuation',
    expiresAt: 2_000,
  } as const;
}
