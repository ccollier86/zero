import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { readAuthBearerToken } from './auth-bearer-token';
import { extractAuthContext } from './auth-context';
import { createAuthMiddleware, resolveRequestAuthContext } from './auth.middleware';
import { AUTH_REQUEST_LIMITS } from './auth-request-limits';
import type { TokenService } from './token-service';

describe('bounded auth Bearer extraction', () => {
  test('accepts the exact token boundary and rejects empty or oversized credentials', () => {
    expect(readAuthBearerToken(request('t'.repeat(AUTH_REQUEST_LIMITS.token))))
      .toHaveLength(AUTH_REQUEST_LIMITS.token);
    expect(readAuthBearerToken(request(''))).toBeNull();
    expect(readAuthBearerToken(request('t'.repeat(AUTH_REQUEST_LIMITS.token + 1))))
      .toBeNull();
  });

  test('accepts case-insensitive schemes and repeated RFC spaces', () => {
    expect(readAuthBearerToken(headerRequest('bearer   token-value')))
      .toBe('token-value');
    expect(readAuthBearerToken(headerRequest('Bearer token value'))).toBeNull();
  });

  test('does not invoke JWT verification for an oversized Bearer credential', async () => {
    let calls = 0;
    const tokens = {
      assertCurrentProfile() {},
      resolveAuthContext: async () => {
        calls += 1;
        return null;
      },
    } as unknown as TokenService;
    const auth = await extractAuthContext(
      request('t'.repeat(AUTH_REQUEST_LIMITS.token + 1)),
      tokens
    );
    expect(auth).toBeNull();
    expect(calls).toBe(0);
  });

  test('shares one durable hydration between auth subplugins and global middleware', async () => {
    let calls = 0;
    const context = { userId: 'u_1', email: 'user@test.com', role: 'user' };
    const tokens = {
      assertCurrentProfile() {},
      resolveAuthContext: async () => {
        calls += 1;
        await Promise.resolve();
        return context;
      },
    } as unknown as TokenService;
    const sharedRequest = request('valid-token');

    const [routeContext, middlewareContext, repeatedRouteContext] = await Promise.all([
      extractAuthContext(sharedRequest, tokens),
      resolveRequestAuthContext(sharedRequest, () => tokens),
      extractAuthContext(sharedRequest, tokens),
    ]);

    expect(routeContext).toEqual(context);
    expect(middlewareContext).toEqual(context);
    expect(repeatedRouteContext).toEqual(context);
    expect(calls).toBe(1);
  });

  test('hydrates once when an Elysia auth route and global middleware both resolve', async () => {
    let calls = 0;
    const tokens = {
      assertCurrentProfile() {},
      resolveAuthContext: async () => {
        calls += 1;
        return { userId: 'u_1', email: 'user@test.com', role: 'user' };
      },
    } as unknown as TokenService;
    const app = new Elysia()
      .use(createAuthMiddleware(() => tokens))
      .get('/auth/probe', async ({ request, authContext }) => ({
        middlewareUserId: authContext?.userId,
        routeUserId: (await extractAuthContext(request, tokens))?.userId,
      }));

    const response = await app.handle(new Request('https://app.test/auth/probe', {
      headers: { Authorization: 'Bearer valid-token' },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      middlewareUserId: 'u_1',
      routeUserId: 'u_1',
    });
    expect(calls).toBe(1);
  });
});

function request(token: string): Request {
  return headerRequest(`Bearer ${token}`);
}

function headerRequest(authorization: string): Request {
  return new Request('https://app.test/auth/me', {
    headers: { Authorization: authorization },
  });
}
