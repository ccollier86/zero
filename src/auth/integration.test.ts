import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { createReactiveDB, ReactiveDB } from '../sync/reactive-db';
import { createAuthPlugin, getTokenService } from './auth.plugin';
import { createAuthMiddleware } from './auth.middleware';

// ─── Test Setup ───────────────────────────────────────────────────────────

let db: ReactiveDB;
let app: any;
let baseUrl: string;

beforeAll(async () => {
  db = createReactiveDB({ mode: 'memory' });

  app = new Elysia()
    .use(createAuthPlugin({ db }))
    .use(createAuthMiddleware(getTokenService))
    // A protected test route to verify middleware
    .get('/api/whoami', (ctx: any) => {
      if (!ctx.authContext) return new Response('Unauthorized', { status: 401 });
      return { userId: ctx.authContext.userId, role: ctx.authContext.role };
    });

  app.listen(0);
  const server = app.server!;
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  app.stop();
  db.dispose();
});

// ─── Helpers ──────────────────────────────────────────────────────────────

async function post(path: string, body: object, token?: string): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function get(path: string, token?: string): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, { headers });
  return { status: res.status, data: await res.json() };
}

// ─── Registration ─────────────────────────────────────────────────────────

describe('Auth Plugin — Registration', () => {
  test('POST /auth/register creates user and returns tokens', async () => {
    const { status, data } = await post('/auth/register', {
      username: 'alice',
      email: 'alice@test.com',
      password: 'password123',
      firstName: 'Alice',
      lastName: 'Smith',
    });

    expect(status).toBe(200);
    expect(data.user.username).toBe('alice');
    expect(data.user.email).toBe('alice@test.com');
    expect(data.user.firstName).toBe('Alice');
    expect(data.user.lastName).toBe('Smith');
    expect(data.user.role).toBe('user');
    expect(data.accessToken).toBeDefined();
    expect(data.refreshToken).toBeDefined();
  });

  test('POST /auth/register rejects duplicate username', async () => {
    // alice already registered above
    const { status, data } = await post('/auth/register', {
      username: 'alice',
      email: 'other@test.com',
      password: 'password123',
    });

    expect(status).toBe(409);
    expect(data.code).toBe('DUPLICATE_USERNAME');
  });

  test('POST /auth/register rejects duplicate email', async () => {
    const { status, data } = await post('/auth/register', {
      username: 'bob',
      email: 'alice@test.com',
      password: 'password123',
    });

    expect(status).toBe(409);
    expect(data.code).toBe('DUPLICATE_EMAIL');
  });

  test('POST /auth/register validates body schema', async () => {
    // Missing email
    const res1 = await post('/auth/register', {
      username: 'test',
      password: 'password123',
    });
    expect(res1.status).toBe(422);

    // Password too short
    const res2 = await post('/auth/register', {
      username: 'test2',
      email: 'test2@test.com',
      password: 'short',
    });
    expect(res2.status).toBe(422);
  });
});

// ─── Login ────────────────────────────────────────────────────────────────

describe('Auth Plugin — Login', () => {
  test('POST /auth/login with correct credentials', async () => {
    // Register first
    await post('/auth/register', {
      username: 'logintest',
      email: 'login@test.com',
      password: 'password123',
    });

    const { status, data } = await post('/auth/login', {
      username: 'logintest',
      password: 'password123',
    });

    expect(status).toBe(200);
    expect(data.user.username).toBe('logintest');
    expect(data.accessToken).toBeDefined();
    expect(data.refreshToken).toBeDefined();
  });

  test('POST /auth/login with email instead of username', async () => {
    const { status, data } = await post('/auth/login', {
      username: 'login@test.com', // email in username field
      password: 'password123',
    });

    expect(status).toBe(200);
    expect(data.user.username).toBe('logintest');
  });

  test('POST /auth/login with wrong password', async () => {
    const { status, data } = await post('/auth/login', {
      username: 'logintest',
      password: 'wrongpassword',
    });

    expect(status).toBe(401);
    expect(data.code).toBe('INVALID_CREDENTIALS');
  });

  test('POST /auth/login with nonexistent user', async () => {
    const { status, data } = await post('/auth/login', {
      username: 'nobody',
      password: 'password123',
    });

    expect(status).toBe(401);
    expect(data.code).toBe('INVALID_CREDENTIALS');
  });
});

// ─── Token Refresh ────────────────────────────────────────────────────────

describe('Auth Plugin — Refresh', () => {
  test('POST /auth/refresh rotates tokens', async () => {
    const reg = await post('/auth/register', {
      username: 'refreshtest',
      email: 'refresh@test.com',
      password: 'password123',
    });

    const { status, data } = await post('/auth/refresh', {
      refreshToken: reg.data.refreshToken,
    });

    expect(status).toBe(200);
    expect(data.accessToken).toBeDefined();
    expect(data.refreshToken).toBeDefined();
    // New refresh token should be different from original
    expect(data.refreshToken).not.toBe(reg.data.refreshToken);
  });

  test('POST /auth/refresh rejects invalid token', async () => {
    const { status, data } = await post('/auth/refresh', {
      refreshToken: 'invalid-token',
    });

    expect(status).toBe(401);
    expect(data.code).toBe('INVALID_REFRESH_TOKEN');
  });

  test('POST /auth/refresh rejects reused token (replay)', async () => {
    const reg = await post('/auth/register', {
      username: 'replaytest',
      email: 'replay@test.com',
      password: 'password123',
    });

    // First rotation — success
    const rot1 = await post('/auth/refresh', {
      refreshToken: reg.data.refreshToken,
    });
    expect(rot1.status).toBe(200);

    // Second use of same token — replay attack
    const rot2 = await post('/auth/refresh', {
      refreshToken: reg.data.refreshToken,
    });
    expect(rot2.status).toBe(401);

    // The new token from rot1 should also be revoked
    const rot3 = await post('/auth/refresh', {
      refreshToken: rot1.data.refreshToken,
    });
    expect(rot3.status).toBe(401);
  });
});

// ─── Logout ───────────────────────────────────────────────────────────────

describe('Auth Plugin — Logout', () => {
  test('POST /auth/logout revokes refresh token', async () => {
    const reg = await post('/auth/register', {
      username: 'logouttest',
      email: 'logout@test.com',
      password: 'password123',
    });

    const { status, data } = await post('/auth/logout', {
      refreshToken: reg.data.refreshToken,
    });

    expect(status).toBe(200);
    expect(data.ok).toBe(true);

    // Refresh should fail after logout
    const refresh = await post('/auth/refresh', {
      refreshToken: reg.data.refreshToken,
    });
    expect(refresh.status).toBe(401);
  });
});

// ─── Me Endpoint ──────────────────────────────────────────────────────────

describe('Auth Plugin — Me', () => {
  test('GET /auth/me returns user data with valid token', async () => {
    const reg = await post('/auth/register', {
      username: 'metest',
      email: 'me@test.com',
      password: 'password123',
      firstName: 'Me',
      lastName: 'Test',
    });

    const { status, data } = await get('/auth/me', reg.data.accessToken);

    expect(status).toBe(200);
    expect(data.username).toBe('metest');
    expect(data.email).toBe('me@test.com');
    expect(data.firstName).toBe('Me');
    expect(data.role).toBe('user');
    expect(data.properties).toBeDefined();
  });

  test('GET /auth/me returns 401 without token', async () => {
    const { status } = await get('/auth/me');
    expect(status).toBe(401);
  });

  test('GET /auth/me returns 401 with invalid token', async () => {
    const { status } = await get('/auth/me', 'invalid.jwt.token');
    expect(status).toBe(401);
  });
});

// ─── Change Password ──────────────────────────────────────────────────────

describe('Auth Plugin — Change Password', () => {
  test('POST /auth/change-password with correct current password', async () => {
    const reg = await post('/auth/register', {
      username: 'pwchange',
      email: 'pwchange@test.com',
      password: 'oldpassword1',
    });

    const { status, data } = await post(
      '/auth/change-password',
      {
        currentPassword: 'oldpassword1',
        newPassword: 'newpassword1',
      },
      reg.data.accessToken
    );

    expect(status).toBe(200);
    expect(data.accessToken).toBeDefined();
    expect(data.refreshToken).toBeDefined();

    // Old password should no longer work
    const login = await post('/auth/login', {
      username: 'pwchange',
      password: 'oldpassword1',
    });
    expect(login.status).toBe(401);

    // New password should work
    const login2 = await post('/auth/login', {
      username: 'pwchange',
      password: 'newpassword1',
    });
    expect(login2.status).toBe(200);
  });

  test('POST /auth/change-password rejects wrong current password', async () => {
    const reg = await post('/auth/register', {
      username: 'pwfail',
      email: 'pwfail@test.com',
      password: 'password123',
    });

    const { status, data } = await post(
      '/auth/change-password',
      {
        currentPassword: 'wrongpassword',
        newPassword: 'newpassword1',
      },
      reg.data.accessToken
    );

    expect(status).toBe(400);
    expect(data.code).toBe('INVALID_PASSWORD');
  });

  test('POST /auth/change-password requires auth', async () => {
    const { status } = await post('/auth/change-password', {
      currentPassword: 'old',
      newPassword: 'new12345',
    });

    expect(status).toBe(401);
  });
});

// ─── JWKS ─────────────────────────────────────────────────────────────────

describe('Auth Plugin — JWKS', () => {
  test('GET /auth/jwks returns public key', async () => {
    const { status, data } = await get('/auth/jwks');

    expect(status).toBe(200);
    expect(data.keys).toBeArray();
    expect(data.keys).toHaveLength(1);
    expect(data.keys[0].kty).toBe('EC');
    expect(data.keys[0].crv).toBe('P-256');
    expect(data.keys[0].alg).toBe('ES256');
    expect(data.keys[0].d).toBeUndefined(); // No private key!
  });
});

// ─── Auth Middleware ──────────────────────────────────────────────────────

describe('Auth Middleware', () => {
  test('middleware derives authContext for protected routes', async () => {
    const reg = await post('/auth/register', {
      username: 'mwtest',
      email: 'mw@test.com',
      password: 'password123',
    });

    const { status, data } = await get(
      '/api/whoami',
      reg.data.accessToken
    );

    expect(status).toBe(200);
    expect(data.userId).toBeDefined();
    expect(data.role).toBe('user');
  });

  test('middleware sets authContext to null without token', async () => {
    const res = await fetch(`${baseUrl}/api/whoami`);
    expect(res.status).toBe(401);
  });

  test('middleware sets authContext to null with invalid token', async () => {
    const res = await fetch(`${baseUrl}/api/whoami`, {
      headers: { Authorization: 'Bearer invalid.token.here' },
    });
    expect(res.status).toBe(401);
  });
});

// ─── Full Flow ────────────────────────────────────────────────────────────

describe('Auth Plugin — Full Flow', () => {
  test('register → login → use token → refresh → use new token', async () => {
    // 1. Register
    const reg = await post('/auth/register', {
      username: 'fullflow',
      email: 'flow@test.com',
      password: 'password123',
    });
    expect(reg.status).toBe(200);

    // 2. Login
    const login = await post('/auth/login', {
      username: 'fullflow',
      password: 'password123',
    });
    expect(login.status).toBe(200);

    // 3. Use access token
    const me1 = await get('/auth/me', login.data.accessToken);
    expect(me1.status).toBe(200);
    expect(me1.data.username).toBe('fullflow');

    // 4. Refresh
    const refresh = await post('/auth/refresh', {
      refreshToken: login.data.refreshToken,
    });
    expect(refresh.status).toBe(200);

    // 5. Use new access token
    const me2 = await get('/auth/me', refresh.data.accessToken);
    expect(me2.status).toBe(200);
    expect(me2.data.username).toBe('fullflow');

    // 6. Old refresh token should be revoked
    const badRefresh = await post('/auth/refresh', {
      refreshToken: login.data.refreshToken,
    });
    expect(badRefresh.status).toBe(401);
  });
});
