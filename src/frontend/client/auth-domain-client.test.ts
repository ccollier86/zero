import { afterEach, describe, expect, test } from 'bun:test';
import { AuthClient } from './auth-client';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('AuthClient verified-domain integration', () => {
  test('wires optional and required auth without treating mailbox proof as login', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' || input instanceof URL
        ? String(input)
        : input.url;
      requests.push({ url, init });

      if (url.endsWith('/auth/onboarding/domain/start')) {
        return Response.json({ accepted: true });
      }
      if (url.endsWith('/auth/onboarding/domain/complete')) {
        return Response.json({
          option: {
            action: 'request-to-join',
            tenant: { name: 'Acme', slug: 'acme' },
          },
          continuation: 'domain-continuation',
          expiresAt: 2_000,
        });
      }
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          accessToken: 'browser-access-token',
          refreshToken: 'browser-refresh-token',
        });
      }
      if (url.endsWith('/auth/tenant/domains')) {
        return Response.json({
          actor: { capabilities: capabilities() },
          requestRoles: [],
          claims: [],
        });
      }
      if (url.endsWith('/auth/onboarding/domain/admit')) {
        return Response.json({
          request: {
            joinRequestId: 'request-1',
            status: 'pending',
            createdAt: 100,
            tenant: { name: 'Acme', slug: 'acme' },
          },
        });
      }
      return Response.json({ error: 'unexpected request' }, { status: 500 });
    }) as typeof fetch;

    const client = new AuthClient('https://zero.test', {
      authorizationRevalidationIntervalMs: 0,
    });
    try {
      await client.startDomainOnboarding('identity-continuation');
      const completion = await client.completeDomainOnboarding('mailbox-proof');
      expect(client.isAuthenticated).toBe(false);
      expect(completion.option.action).toBe('request-to-join');

      await client.login('ada', 'password');
      await client.getTenantDomainAdministration();
      await client.admitDomainOnboarding(
        'domain-continuation',
        'identity-continuation',
      );

      expect(new Headers(requests[0]!.init?.headers).has('Authorization')).toBe(false);
      expect(new Headers(requests[1]!.init?.headers).has('Authorization')).toBe(false);
      expect(new Headers(requests[3]!.init?.headers).get('Authorization'))
        .toBe('Bearer browser-access-token');
      expect(new Headers(requests[4]!.init?.headers).get('Authorization'))
        .toBe('Bearer browser-access-token');
    } finally {
      client.dispose();
    }
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

function authUser() {
  return {
    userId: 'user-1',
    username: 'ada',
    email: 'ada@example.com',
    firstName: null,
    lastName: null,
    role: 'user',
    status: 'active',
    passwordChangeRequired: false,
    emailVerifiedAt: 1,
    emailVerificationRequired: false,
    mfaRequired: false,
    properties: {},
    createdAt: 1,
    updatedAt: null,
  };
}
