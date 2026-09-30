/**
 * auth-client.test.ts
 *
 * Verifies browser auth-client transport helpers. These tests own SDK request
 * contract checks only; backend route behavior is covered by auth integration
 * tests.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { AuthClient, AuthClientError } from './auth-client';

const originalFetch = globalThis.fetch;
const REFRESH_TOKEN_STORAGE_KEY = '__platform_refresh_token';

beforeEach(() => {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  }
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  }
});

describe('AuthClient admin helpers', () => {
  it('lists admin users with supported query params', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });
      return Response.json({
        users: [],
        page: {
          limit: 25,
          offset: 10,
          count: 0,
          total: 0,
          hasMore: false,
          nextOffset: null,
        },
      });
    });

    const client = new AuthClient('http://zero.test');
    const result = await client.listAdminUsers({
      limit: 25,
      offset: 10,
      search: 'ops',
      role: 'admin',
      status: 'active',
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(
      'http://zero.test/auth/admin/users?limit=25&offset=10&search=ops&role=admin&status=active',
    );
    expect(result.page.limit).toBe(25);
  });

  it('creates admin users with a JSON body', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });
      return Response.json({
        user: {
          userId: 'u_1',
          username: 'ada',
          email: 'ada@example.com',
          firstName: null,
          lastName: null,
          role: 'user',
          status: 'active',
          passwordChangeRequired: true,
          emailVerifiedAt: null,
          emailVerificationRequired: false,
          mfaRequired: false,
          properties: {},
          createdAt: 1,
          updatedAt: null,
        },
        setupEmailSent: true,
      });
    });

    const client = new AuthClient('http://zero.test');
    const result = await client.createAdminUser({
      username: 'ada',
      email: 'ada@example.com',
      sendSetupEmail: true,
    });

    expect(requests[0]!.url).toBe('http://zero.test/auth/admin/users');
    expect(requests[0]!.init?.method).toBe('POST');
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({
      username: 'ada',
      email: 'ada@example.com',
      sendSetupEmail: true,
    });
    expect(result.setupEmailSent).toBe(true);
  });

  it('sets and deletes admin user properties', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });
      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test');
    await client.setAdminUserProperty('u_1', 'department', 'billing');
    await client.deleteAdminUserProperty('u_1', 'department');

    expect(requests[0]!.url).toBe('http://zero.test/auth/admin/users/u_1/properties/department');
    expect(requests[0]!.init?.method).toBe('PUT');
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({ value: 'billing' });
    expect(requests[1]!.url).toBe('http://zero.test/auth/admin/users/u_1/properties/department');
    expect(requests[1]!.init?.method).toBe('DELETE');
  });

  it('manages admin MFA and email-verification lifecycle routes', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/mfa')) {
        return Response.json({ methods: [], required: false, requirement: 'none' });
      }
      if (url.endsWith('/mfa/reset')) {
        return Response.json({ ok: true, deletedMethods: 1, invalidatedChallenges: 2 });
      }
      if (url.endsWith('/send-verification-email')) return Response.json({ ok: true });
      return Response.json({ user: authUser() });
    });

    const client = new AuthClient('http://zero.test');
    const status = await client.getAdminUserMfa('u/1');
    await client.requireAdminUserMfa('u/1');
    await client.clearAdminUserMfaRequirement('u/1');
    const reset = await client.resetAdminUserMfa('u/1');
    await client.sendAdminVerificationEmail('u/1');
    await client.verifyAdminUserEmail('u/1');

    expect(status.requirement).toBe('none');
    expect(reset).toEqual({ ok: true, deletedMethods: 1, invalidatedChallenges: 2 });
    expect(requests.map((request) => [request.url, request.init?.method ?? 'GET'])).toEqual([
      ['http://zero.test/auth/admin/users/u%2F1/mfa', 'GET'],
      ['http://zero.test/auth/admin/users/u%2F1/mfa/require', 'POST'],
      ['http://zero.test/auth/admin/users/u%2F1/mfa/clear-requirement', 'POST'],
      ['http://zero.test/auth/admin/users/u%2F1/mfa/reset', 'POST'],
      ['http://zero.test/auth/admin/users/u%2F1/send-verification-email', 'POST'],
      ['http://zero.test/auth/admin/users/u%2F1/verify-email', 'POST'],
    ]);
  });

  it('surfaces structured admin route errors', async () => {
    mockFetch(() => new Response(
      JSON.stringify({ error: 'Forbidden', code: 'FORBIDDEN' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    ));

    const client = new AuthClient('http://zero.test');
    try {
      await client.getAdminConfig();
      throw new Error('Expected getAdminConfig to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AuthClientError);
      expect((err as AuthClientError).message).toBe('Forbidden');
      expect((err as AuthClientError).status).toBe(403);
      expect((err as AuthClientError).code).toBe('FORBIDDEN');
    }
  });
});

describe('AuthClient token lifecycle', () => {
  it('carries an optional native continuation on password recovery', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });
      return Response.json({ ok: true });
    });

    const continuation = `/auth/oauth/authorize?request_id=${'r'.repeat(43)}`;
    const client = new AuthClient('http://zero.test');
    await client.forgotPassword('ada@example.com', continuation);

    expect(requests[0]!.url).toBe('http://zero.test/auth/forgot-password');
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({
      email: 'ada@example.com',
      nativeContinuation: continuation,
    });
  });

  it('carries an optional native continuation on verification resend', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });
      return Response.json({ ok: true });
    });

    const continuation = `/auth/oauth/authorize?request_id=${'r'.repeat(43)}`;
    const client = new AuthClient('http://zero.test');
    await client.resendVerificationEmail('ada@example.com', continuation);

    expect(requests[0]!.url).toBe('http://zero.test/auth/resend-verification');
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({
      email: 'ada@example.com',
      nativeContinuation: continuation,
    });
  });

  it('does not persist a session when registration requires email verification', async () => {
    mockFetch((url) => {
      if (url.endsWith('/auth/register')) {
        return Response.json({
          user: {
            ...authUser(),
            emailVerifiedAt: null,
            emailVerificationRequired: true,
            mfaRequired: false,
          },
        });
      }

      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test');
    const result = await client.register({
      username: 'ada',
      email: 'ada@example.com',
      password: 'password123',
    });

    expect(result.user.emailVerificationRequired).toBe(true);
    expect(client.isAuthenticated).toBe(false);
    expect(client.accessToken).toBeNull();
    if (typeof localStorage !== 'undefined') {
      expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBeNull();
    }
  });

  it('persists a session after email verification succeeds', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/auth/verify-email')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-verified',
          refreshToken: 'refresh-verified',
        });
      }

      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test');
    const result = await client.verifyEmail('verification-token');

    expect(requests[0]!.url).toBe('http://zero.test/auth/verify-email');
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({
      token: 'verification-token',
    });
    expect(result.user.emailVerificationRequired).toBe(false);
    expect(client.isAuthenticated).toBe(true);
    expect(client.accessToken).toBe('access-verified');
    if (typeof localStorage !== 'undefined') {
      expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('refresh-verified');
    }
  });

  it('does not persist a session while MFA setup is required', async () => {
    mockFetch((url) => {
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: { ...authUser(), mfaRequired: true },
          mfaSetupRequired: true,
          mfaSetupToken: 'setup-token',
          mfa: {
            methods: ['totp', 'email'],
            allowUserChoice: true,
          },
        });
      }

      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test');
    const result = await client.login('ada', 'password');

    expect('mfaSetupRequired' in result && result.mfaSetupRequired).toBe(true);
    expect(client.isAuthenticated).toBe(false);
    expect(client.accessToken).toBeNull();
    if (typeof localStorage !== 'undefined') {
      expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBeNull();
    }
  });

  it('persists a session after MFA challenge verification succeeds', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/auth/mfa/challenge/verify')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-mfa',
          refreshToken: 'refresh-mfa',
        });
      }

      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test');
    const result = await client.verifyMfaChallenge({
      challengeToken: 'challenge-token',
      code: '123456',
    });

    expect(requests[0]!.url).toBe('http://zero.test/auth/mfa/challenge/verify');
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({
      challengeToken: 'challenge-token',
      code: '123456',
    });
    expect(result.accessToken).toBe('access-mfa');
    expect(client.isAuthenticated).toBe(true);
    expect(client.accessToken).toBe('access-mfa');
    if (typeof localStorage !== 'undefined') {
      expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('refresh-mfa');
    }
  });

  it('refreshes an expired access token and retries authenticated requests', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });

      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
        });
      }

      if (url.endsWith('/api/protected') && requests.filter((r) => r.url.endsWith('/api/protected')).length === 1) {
        return new Response(JSON.stringify({ error: 'Expired' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.endsWith('/auth/refresh')) {
        return Response.json({
          accessToken: 'access-2',
          refreshToken: 'refresh-2',
        });
      }

      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test');
    await client.login('ada', 'password');
    const response = await client.fetchWithAuth('http://zero.test/api/protected');

    expect(response.ok).toBe(true);
    expect(requests.map((request) => request.url)).toEqual([
      'http://zero.test/auth/login',
      'http://zero.test/api/protected',
      'http://zero.test/auth/refresh',
      'http://zero.test/api/protected',
    ]);
    expect(new Headers(requests[1]!.init?.headers).get('authorization')).toBe(
      'Bearer access-1',
    );
    expect(new Headers(requests[3]!.init?.headers).get('authorization')).toBe(
      'Bearer access-2',
    );
    expect(client.isAuthenticated).toBe(true);
  });

  it('serializes persisted refresh-token rotation across concurrent clients', async () => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'refresh-0');
    const rotatedTokens: string[] = [];

    mockFetch((url, init) => {
      if (url.endsWith('/auth/refresh')) {
        const token = JSON.parse(String(init?.body)).refreshToken as string;
        rotatedTokens.push(token);
        const sequence = rotatedTokens.length;
        return Response.json({
          accessToken: `access-${sequence}`,
          refreshToken: `refresh-${sequence}`,
        });
      }

      if (url.endsWith('/auth/me')) return Response.json(authUser());
      return Response.json({ ok: true });
    });

    const first = new AuthClient('http://zero.test');
    const second = new AuthClient('http://zero.test/');

    await Promise.all([first.refresh(), second.refresh()]);
    await Promise.all([
      waitForAuthenticated(first),
      waitForAuthenticated(second),
    ]);

    expect(rotatedTokens).toEqual(['refresh-0', 'refresh-1']);
    expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('refresh-2');
    expect(first.isAuthenticated).toBe(true);
    expect(second.isAuthenticated).toBe(true);
  });

  it('replaces an existing bearer header case-insensitively', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-current',
          refreshToken: 'refresh-current',
        });
      }
      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test');
    await client.login('ada', 'password');
    await client.fetchWithAuth('http://zero.test/api/protected', {
      headers: new Headers({
        authorization: 'Bearer stale',
        'x-request-id': 'request-1',
      }),
    });

    const headers = new Headers(requests[1]!.init?.headers);
    expect(headers.get('authorization')).toBe('Bearer access-current');
    expect(headers.get('x-request-id')).toBe('request-1');
  });

  it('clears auth state when refresh is rejected', async () => {
    mockFetch((url) => {
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
        });
      }

      if (url.endsWith('/auth/refresh')) {
        return new Response(JSON.stringify({ error: 'Invalid refresh token' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'Expired' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new AuthClient('http://zero.test');
    await client.login('ada', 'password');

    const response = await client.fetchWithAuth('http://zero.test/api/protected');

    expect(response.status).toBe(401);
    expect(client.isAuthenticated).toBe(false);
    expect(client.accessToken).toBeNull();
    if (typeof localStorage !== 'undefined') {
      expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBeNull();
    }
  });

  it('notifies the server on logout even without a local refresh token', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });
      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test');
    await client.logout();

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('http://zero.test/auth/logout');
    expect(requests[0]!.init?.method).toBe('POST');
  });

  it('includes the current refresh token when notifying the server on logout', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-logout',
          refreshToken: 'refresh-logout',
        });
      }

      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test');
    await client.login('ada', 'password');
    await client.logout();

    expect(requests.map((request) => request.url)).toEqual([
      'http://zero.test/auth/login',
      'http://zero.test/auth/logout',
    ]);
    expect(requests[1]!.init?.method).toBe('POST');
    expect(JSON.parse(String(requests[1]!.init?.body))).toEqual({
      refreshToken: 'refresh-logout',
    });
  });

  it('waits for the logout response before clearing auth state and completing', async () => {
    let resolveLogout!: (response: Response) => void;
    const logoutResponse = new Promise<Response>((resolve) => {
      resolveLogout = resolve;
    });

    mockFetch((url) => {
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-pending-logout',
          refreshToken: 'refresh-pending-logout',
        });
      }

      if (url.endsWith('/auth/logout')) return logoutResponse;
      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test');
    await client.login('ada', 'password');

    let completed = false;
    const logout = client.logout().then(() => {
      completed = true;
    });
    await Promise.resolve();

    expect(completed).toBe(false);
    expect(client.isAuthenticated).toBe(true);
    expect(client.accessToken).toBe('access-pending-logout');
    if (typeof localStorage !== 'undefined') {
      expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('refresh-pending-logout');
    }

    resolveLogout(Response.json({ ok: true }));
    await logout;

    expect(completed).toBe(true);
    expect(client.isAuthenticated).toBe(false);
    expect(client.accessToken).toBeNull();
    if (typeof localStorage !== 'undefined') {
      expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBeNull();
    }
  });

  it('clears local auth state when the logout request fails', async () => {
    mockFetch((url) => {
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-failed-logout',
          refreshToken: 'refresh-failed-logout',
        });
      }

      if (url.endsWith('/auth/logout')) {
        return Promise.reject(new Error('Network unavailable'));
      }

      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test');
    await client.login('ada', 'password');

    await expect(client.logout()).resolves.toBeUndefined();

    expect(client.isAuthenticated).toBe(false);
    expect(client.accessToken).toBeNull();
    if (typeof localStorage !== 'undefined') {
      expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBeNull();
    }
  });
});

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    return Promise.resolve(handler(url, init));
  }) as typeof fetch;
}

async function waitForAuthenticated(client: AuthClient): Promise<void> {
  if (client.isAuthenticated) return;
  await new Promise<void>((resolve) => {
    const unsubscribe = client.subscribe(() => {
      if (!client.isAuthenticated) return;
      unsubscribe();
      resolve();
    });
  });
}

function authUser() {
  return {
    userId: 'u_1',
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
