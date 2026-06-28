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
    expect(requests[1]!.init?.headers).toMatchObject({
      Authorization: 'Bearer access-1',
    });
    expect(requests[3]!.init?.headers).toMatchObject({
      Authorization: 'Bearer access-2',
    });
    expect(client.isAuthenticated).toBe(true);
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
});

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    return Promise.resolve(handler(url, init));
  }) as typeof fetch;
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
    properties: {},
    createdAt: 1,
    updatedAt: null,
  };
}
