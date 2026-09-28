import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { createReactiveDB, ReactiveDB } from '../sync/reactive-db';
import { createAuthPlugin } from './auth.plugin';
import { createAuthMiddleware } from './auth.middleware';
import type { AuthRuntime } from './auth-runtime';
import {
  configureEmail,
  MemoryEmailProvider,
  type EmailMessage,
  type EmailProvider,
} from '../email';
import {
  configureObservability,
  getObservabilityRuntime,
  MemoryEventStore,
  OBS_CODES,
} from '../observability';
import { defineAuthEmailTemplates } from './auth-email-templates';
import { generateTotpCode } from './mfa-totp';
import { PAGE_SESSION_COOKIE_NAME } from './page-session';

// ─── Test Setup ───────────────────────────────────────────────────────────

let db: ReactiveDB;
let app: any;
let baseUrl: string;
let bootstrapAdminToken: string;
let authRuntime: AuthRuntime;
const authRuntimesByUrl = new Map<string, AuthRuntime>();

beforeAll(async () => {
  db = createReactiveDB({ mode: 'memory' });

  app = new Elysia()
    .use(createAuthPlugin({
      db,
      bootstrap: 'public',
      onRuntimeCreated(runtime) {
        authRuntime = runtime;
      },
    }))
    .use(createAuthMiddleware(() => authRuntime.getTokenService()))
    // A protected test route to verify middleware
    .get('/api/whoami', (ctx: any) => {
      if (!ctx.authContext) return new Response('Unauthorized', { status: 401 });
      return { userId: ctx.authContext.userId, role: ctx.authContext.role };
    });

  app.listen(0);
  const server = app.server!;
  baseUrl = `http://localhost:${server.port}`;
  authRuntimesByUrl.set(baseUrl, authRuntime);
});

afterAll(() => {
  authRuntimesByUrl.delete(baseUrl);
  app.stop();
  db.dispose();
});

// ─── Helpers ──────────────────────────────────────────────────────────────

interface JsonResponse {
  status: number;
  data: any;
  headers: Headers;
}

async function requestJson(
  url: string,
  method: string,
  path: string,
  body?: object,
  token?: string
): Promise<JsonResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${url}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (path === '/auth/forgot-password' || path === '/auth/resend-verification') {
    await authRuntimesByUrl.get(url)?.getAuthEmailOutbox()?.processDue();
  }
  return { status: res.status, data, headers: res.headers };
}

async function post(path: string, body: object, token?: string): Promise<JsonResponse> {
  return requestJson(baseUrl, 'POST', path, body, token);
}

async function patch(path: string, body: object, token?: string): Promise<JsonResponse> {
  return requestJson(baseUrl, 'PATCH', path, body, token);
}

async function put(path: string, body: object, token?: string): Promise<JsonResponse> {
  return requestJson(baseUrl, 'PUT', path, body, token);
}

async function del(path: string, token?: string): Promise<JsonResponse> {
  return requestJson(baseUrl, 'DELETE', path, undefined, token);
}

async function get(path: string, token?: string): Promise<JsonResponse> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, { headers });
  return { status: res.status, data: await res.json(), headers: res.headers };
}

async function startAuthApp(config: Omit<Parameters<typeof createAuthPlugin>[0], 'db'> = {}) {
  const localDb = createReactiveDB({ mode: 'memory' });
  let localRuntime!: AuthRuntime;
  const configuredRuntimeCallback = config.onRuntimeCreated;
  const localApp = new Elysia()
    .use(createAuthPlugin({
      db: localDb,
      bootstrap: 'public',
      ...config,
      onRuntimeCreated(runtime) {
        localRuntime = runtime;
        configuredRuntimeCallback?.(runtime);
      },
    }))
    .use(createAuthMiddleware(() => localRuntime.getTokenService()))
    .get('/api/whoami', (ctx: any) => {
      if (!ctx.authContext) return new Response('Unauthorized', { status: 401 });
      return { userId: ctx.authContext.userId, role: ctx.authContext.role };
    });
  localApp.listen(0);
  const url = `http://localhost:${localApp.server!.port}`;
  authRuntimesByUrl.set(url, localRuntime);

  return {
    db: localDb,
    app: localApp,
    runtime: localRuntime,
    url,
    async stop() {
      authRuntimesByUrl.delete(url);
      await localApp.stop();
      localDb.dispose();
    },
  };
}

function extractTokenFromEmail(text: string): string {
  const match = text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error(`No token found in email text: ${text}`);
  return match[1];
}

function extractOtpFromEmail(text: string): string {
  const match = text.match(/\b\d{6}\b/);
  if (!match) throw new Error(`No OTP code found in email text: ${text}`);
  return match[0];
}

function cookiePair(setCookie: string): string {
  return setCookie.split(';', 1)[0]!;
}

function cookieValue(cookie: string): string {
  return decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for async auth work');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function expectActivePageSession(response: JsonResponse): void {
  const setCookie = response.headers.get('set-cookie');
  expect(setCookie).toContain(`${PAGE_SESSION_COOKIE_NAME}=`);
  expect(setCookie).toContain('HttpOnly');
  expect(setCookie).not.toContain('Max-Age=0');
}

function expectClearedPageSession(response: JsonResponse): void {
  const setCookie = response.headers.get('set-cookie');
  expect(setCookie).toContain(`${PAGE_SESSION_COOKIE_NAME}=`);
  expect(setCookie).toContain('HttpOnly');
  expect(setCookie).toContain('Max-Age=0');
}

// ─── Registration ─────────────────────────────────────────────────────────

describe('Auth Plugin — Registration', () => {
  test('GET /auth/config reports first-user bootstrap before users exist', async () => {
    const { status, data } = await get('/auth/config');

    expect(status).toBe(200);
    expect(data.registration.bootstrapRequired).toBe(true);
    expect(data.registration.publicRegistrationEnabled).toBe(true);
    expect(data.registration.userCount).toBeUndefined();
    expect(data.tenancy).toEqual({
      mode: 'single',
      terminology: { singular: 'organization', plural: 'organizations' },
      creation: { mode: 'disabled' },
    });
    expect(data.authorization).toEqual({ mode: 'simple' });
    expect(data.mfa).toMatchObject({
      enabled: false,
      policy: 'optional',
      methods: ['email', 'totp'],
      availableMethods: [],
      allowUserChoice: true,
      allowMultipleMethods: false,
      ready: true,
    });
  });

  test('POST /auth/register bootstraps first user as admin and returns tokens', async () => {
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
    expect(data.user.role).toBe('admin');
    expect(data.accessToken).toBeDefined();
    expect(data.refreshToken).toBeDefined();
    bootstrapAdminToken = data.accessToken;
  });

  test('GET /auth/config reports public registration after bootstrap by default', async () => {
    const { status, data } = await get('/auth/config');

    expect(status).toBe(200);
    expect(data.registration.bootstrapRequired).toBe(false);
    expect(data.registration.publicRegistrationEnabled).toBe(true);
    expect(data.registration.userCount).toBeUndefined();
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
    expect(res1.data).toEqual({
      error: 'Invalid auth request',
      code: 'AUTH_VALIDATION_FAILED',
    });

    // Password too short
    const res2 = await post('/auth/register', {
      username: 'test2',
      email: 'test2@test.com',
      password: 'short',
    });
    expect(res2.status).toBe(422);
    expect(res2.data).toEqual({
      error: 'Invalid auth request',
      code: 'AUTH_VALIDATION_FAILED',
    });
  });
});

// ─── Admin Users ──────────────────────────────────────────────────────────

describe('Auth Plugin — Admin Users', () => {
  test('admin can inspect config and manage users/properties/passwords', async () => {
    const config = await get('/auth/admin/config', bootstrapAdminToken);
    expect(config.status).toBe(200);
    expect(config.data.tenancy).toEqual({
      mode: 'single',
      terminology: { singular: 'organization', plural: 'organizations' },
      creation: { mode: 'disabled' },
    });
    expect(config.data.authorization).toEqual({ mode: 'simple' });
    expect(config.data.registration.publicRegistrationEnabled).toBe(true);
    expect(config.data.mfa).toMatchObject({
      enabled: false,
      policy: 'optional',
      methods: ['email', 'totp'],
      availableMethods: [],
      ready: true,
    });
    expect(config.data.capabilities.mfa).toBe(false);

    const created = await post(
      '/auth/admin/users',
      {
        username: 'managed',
        email: 'managed@test.com',
        password: 'oldpassword1',
        firstName: 'Managed',
        lastName: 'User',
        properties: { department: 'ops' },
      },
      bootstrapAdminToken
    );
    expect(created.status).toBe(200);
    expect(created.data.user.role).toBe('user');
    expect(created.data.user.properties.department).toBe('ops');

    const userId = created.data.user.userId;

    const property = await put(
      `/auth/admin/users/${userId}/properties/plan`,
      { value: 'pro' },
      bootstrapAdminToken
    );
    expect(property.status).toBe(200);

    const updated = await patch(
      `/auth/admin/users/${userId}`,
      {
        lastName: 'Updated',
        properties: { featureFlag: 'enabled' },
      },
      bootstrapAdminToken
    );
    expect(updated.status).toBe(200);
    expect(updated.data.user.lastName).toBe('Updated');
    expect(updated.data.user.properties.plan).toBe('pro');
    expect(updated.data.user.properties.featureFlag).toBe('enabled');

    const reset = await post(
      `/auth/admin/users/${userId}/reset-password`,
      { password: 'newpassword1' },
      bootstrapAdminToken
    );
    expect(reset.status).toBe(200);

    const oldLogin = await post('/auth/login', {
      username: 'managed',
      password: 'oldpassword1',
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await post('/auth/login', {
      username: 'managed',
      password: 'newpassword1',
    });
    expect(newLogin.status).toBe(200);

    const revoked = await post(
      `/auth/admin/users/${userId}/revoke-sessions`,
      {},
      bootstrapAdminToken
    );
    expect(revoked.status).toBe(200);

    const refresh = await post('/auth/refresh', {
      refreshToken: newLogin.data.refreshToken,
    });
    expect(refresh.status).toBe(401);

    const deleted = await del(`/auth/admin/users/${userId}`, bootstrapAdminToken);
    expect(deleted.status).toBe(200);

    const missing = await get(`/auth/admin/users/${userId}`, bootstrapAdminToken);
    expect(missing.status).toBe(404);
  });

  test('non-admin cannot access admin user routes', async () => {
    const reg = await post('/auth/register', {
      username: 'notadmin',
      email: 'notadmin@test.com',
      password: 'password123',
    });

    const res = await get('/auth/admin/users', reg.data.accessToken);
    expect(res.status).toBe(403);
  });

  test('admin can promote a user to admin', async () => {
    const created = await post(
      '/auth/admin/users',
      {
        username: 'promoteme',
        email: 'promoteme@test.com',
        password: 'password123',
      },
      bootstrapAdminToken
    );
    expect(created.status).toBe(200);
    expect(created.data.user.role).toBe('user');

    const promoted = await patch(
      `/auth/admin/users/${created.data.user.userId}`,
      { role: 'admin' },
      bootstrapAdminToken
    );
    expect(promoted.status).toBe(200);
    expect(promoted.data.user.role).toBe('admin');

    const login = await post('/auth/login', {
      username: 'promoteme',
      password: 'password123',
    });
    expect(login.status).toBe(200);

    const adminRoute = await get('/auth/admin/users', login.data.accessToken);
    expect(adminRoute.status).toBe(200);
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

describe('Auth Plugin — Page Session Cookie', () => {
  test('login, refresh, and logout synchronize a refresh-bound HttpOnly cookie', async () => {
    await post('/auth/register', {
      username: 'page-cookie-flow',
      email: 'page-cookie-flow@test.com',
      password: 'password123',
    });

    const loginResponse = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'page-cookie-flow',
        password: 'password123',
      }),
    });
    const login = await loginResponse.json();
    const loginSetCookie = loginResponse.headers.get('set-cookie');

    expect(loginResponse.status).toBe(200);
    expect(loginSetCookie).toContain(`${PAGE_SESSION_COOKIE_NAME}=`);
    expect(loginSetCookie).toContain('HttpOnly');
    expect(loginSetCookie).toContain('SameSite=Lax');
    expect(loginSetCookie).toContain('Path=/');

    const loginCookie = cookiePair(loginSetCookie!);
    const loginPageToken = cookieValue(loginCookie);
    expect(await authRuntime.getTokenService()!.resolvePageSessionToken(loginPageToken)).toMatchObject({
      userId: login.user.userId,
      role: login.user.role,
    });

    // Ambient page identity must not authenticate ordinary auth APIs.
    const cookieOnlyMe = await fetch(`${baseUrl}/auth/me`, {
      headers: { Cookie: loginCookie },
    });
    expect(cookieOnlyMe.status).toBe(401);

    const refreshResponse = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: loginCookie,
      },
      body: JSON.stringify({ refreshToken: login.refreshToken }),
    });
    const refreshed = await refreshResponse.json();
    const refreshSetCookie = refreshResponse.headers.get('set-cookie');
    const refreshedCookie = cookiePair(refreshSetCookie!);
    const refreshedPageToken = cookieValue(refreshedCookie);

    expect(refreshResponse.status).toBe(200);
    expect(refreshedCookie).not.toBe(loginCookie);
    expect(await authRuntime.getTokenService()!.resolvePageSessionToken(loginPageToken)).toBeNull();
    expect(await authRuntime.getTokenService()!.resolvePageSessionToken(refreshedPageToken)).toMatchObject({
      userId: login.user.userId,
    });

    const logoutResponse = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: refreshedCookie,
      },
      body: JSON.stringify({ refreshToken: refreshed.refreshToken }),
    });
    const logoutSetCookie = logoutResponse.headers.get('set-cookie');

    expect(logoutResponse.status).toBe(200);
    expect(logoutSetCookie).toContain(`${PAGE_SESSION_COOKIE_NAME}=`);
    expect(logoutSetCookie).toContain('Max-Age=0');
    expect(await authRuntime.getTokenService()!.resolvePageSessionToken(refreshedPageToken)).toBeNull();
  });

  test('a rejected refresh clears and revokes the cookie-bound session', async () => {
    const loginResponse = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'page-cookie-flow',
        password: 'password123',
      }),
    });
    const loginCookie = cookiePair(loginResponse.headers.get('set-cookie')!);
    const pageToken = cookieValue(loginCookie);

    const refreshResponse = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: loginCookie,
      },
      body: JSON.stringify({ refreshToken: 'invalid-refresh-token' }),
    });

    expect(refreshResponse.status).toBe(401);
    expect(refreshResponse.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await authRuntime.getTokenService()!.resolvePageSessionToken(pageToken)).toBeNull();
  });

  test('generic admin eligibility updates revoke rather than temporarily gate page sessions', async () => {
    const created = await post(
      '/auth/admin/users',
      {
        username: 'page-cookie-admin-update',
        email: 'page-cookie-admin-update@test.com',
        password: 'password123',
      },
      bootstrapAdminToken
    );
    const loginResponse = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'page-cookie-admin-update',
        password: 'password123',
      }),
    });
    const pageToken = cookieValue(
      cookiePair(loginResponse.headers.get('set-cookie')!)
    );
    expect(await authRuntime.getTokenService()!.resolvePageSessionToken(pageToken)).not.toBeNull();

    const suspended = await patch(
      `/auth/admin/users/${created.data.user.userId}`,
      { status: 'suspended' },
      bootstrapAdminToken
    );
    expect(suspended.status).toBe(200);
    expect(await authRuntime.getTokenService()!.resolvePageSessionToken(pageToken)).toBeNull();

    const reactivated = await patch(
      `/auth/admin/users/${created.data.user.userId}`,
      { status: 'active' },
      bootstrapAdminToken
    );
    expect(reactivated.status).toBe(200);
    expect(await authRuntime.getTokenService()!.resolvePageSessionToken(pageToken)).toBeNull();
  });
});

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

    const changed = await post(
      '/auth/change-password',
      {
        currentPassword: 'oldpassword1',
        newPassword: 'newpassword1',
      },
      reg.data.accessToken
    );

    expect(changed.status).toBe(200);
    expect(changed.data.accessToken).toBeDefined();
    expect(changed.data.refreshToken).toBeDefined();
    expectActivePageSession(changed);

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

// ─── Registration Policy And Configured Properties ────────────────────────

describe('Auth Plugin — Registration Policy And Configured Properties', () => {
  test('public registration applies configured default user properties', async () => {
    const local = await startAuthApp({
      userProperties: {
        department: {
          type: 'enum',
          values: ['operations', 'clinical'],
          default: 'operations',
          editableBy: 'admin',
        },
        notificationsEnabled: {
          type: 'boolean',
          default: true,
          editableBy: 'user',
        },
      },
    });

    try {
      const owner = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'property-owner',
        email: 'property-owner@test.com',
        password: 'password123',
      });
      expect(owner.status).toBe(200);
      expect(owner.data.user.properties.department).toBe('operations');
      expect(owner.data.user.properties.notificationsEnabled).toBe('true');

      const user = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'property-user',
        email: 'property-user@test.com',
        password: 'password123',
      });
      expect(user.status).toBe(200);
      expect(user.data.user.properties.department).toBe('operations');
      expect(user.data.user.properties.notificationsEnabled).toBe('true');
    } finally {
      await local.stop();
    }
  });

  test('admin-only mode with explicit public bootstrap then requires admin-created users', async () => {
    const local = await startAuthApp({
      registration: {
        mode: 'admin-only',
      },
      userProperties: {
        plan: {
          type: 'enum',
          values: ['free', 'pro'],
          default: 'free',
          editableBy: 'admin',
          useInPolicies: true,
        },
        notificationsEnabled: {
          type: 'boolean',
          default: true,
          editableBy: 'user',
        },
      },
    });

    try {
      const bootstrap = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'owner',
        email: 'owner@test.com',
        password: 'password123',
      });
      expect(bootstrap.status).toBe(200);
      expect(bootstrap.data.user.role).toBe('admin');
      expect(bootstrap.data.user.properties.plan).toBe('free');
      expect(bootstrap.data.user.properties.notificationsEnabled).toBe('true');

      const closed = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'closed',
        email: 'closed@test.com',
        password: 'password123',
      });
      expect(closed.status).toBe(403);
      expect(closed.data.code).toBe('REGISTRATION_DISABLED');

      const publicConfig = await requestJson(local.url, 'GET', '/auth/config');
      expect(publicConfig.status).toBe(200);
      expect(publicConfig.data.userProperties.notificationsEnabled.type).toBe('boolean');
      expect(publicConfig.data.userProperties.notificationsEnabled.useInPolicies).toBe(false);
      expect(publicConfig.data.userProperties.plan).toBeUndefined();

      const adminConfig = await requestJson(
        local.url,
        'GET',
        '/auth/admin/config',
        undefined,
        bootstrap.data.accessToken
      );
      expect(adminConfig.status).toBe(200);
      expect(adminConfig.data.registration.publicRegistrationEnabled).toBe(false);
      expect(adminConfig.data.userProperties.plan.values).toEqual(['free', 'pro']);
      expect(adminConfig.data.userProperties.plan.useInPolicies).toBe(true);

      const created = await requestJson(
        local.url,
        'POST',
        '/auth/admin/users',
        {
          username: 'worker',
          email: 'worker@test.com',
          password: 'password123',
          properties: { plan: 'pro' },
        },
        bootstrap.data.accessToken
      );
      expect(created.status).toBe(200);
      expect(created.data.user.properties.plan).toBe('pro');
      expect(created.data.user.properties.notificationsEnabled).toBe('true');

      const workerLogin = await requestJson(local.url, 'POST', '/auth/login', {
        username: 'worker',
        password: 'password123',
      });
      expect(workerLogin.status).toBe(200);

      const forbiddenProperty = await requestJson(
        local.url,
        'PUT',
        '/auth/me/properties/plan',
        { value: 'free' },
        workerLogin.data.accessToken
      );
      expect(forbiddenProperty.status).toBe(403);
      expect(forbiddenProperty.data.code).toBe('PROPERTY_FORBIDDEN');

      const userEditableProperty = await requestJson(
        local.url,
        'PUT',
        '/auth/me/properties/notificationsEnabled',
        { value: false },
        workerLogin.data.accessToken
      );
      expect(userEditableProperty.status).toBe(200);

      const me = await requestJson(
        local.url,
        'GET',
        '/auth/me',
        undefined,
        workerLogin.data.accessToken
      );
      expect(me.status).toBe(200);
      expect(me.data.properties.notificationsEnabled).toBe('false');

      const invalidAdminProperty = await requestJson(
        local.url,
        'PUT',
        `/auth/admin/users/${created.data.user.userId}/properties/plan`,
        { value: 'enterprise' },
        bootstrap.data.accessToken
      );
      expect(invalidAdminProperty.status).toBe(400);
      expect(invalidAdminProperty.data.code).toBe('INVALID_PROPERTY_VALUE');

      const customProperty = await requestJson(
        local.url,
        'PUT',
        `/auth/admin/users/${created.data.user.userId}/properties/shift`,
        { value: 'night' },
        bootstrap.data.accessToken
      );
      expect(customProperty.status).toBe(200);

      const customSaved = await requestJson(
        local.url,
        'GET',
        `/auth/admin/users/${created.data.user.userId}`,
        undefined,
        bootstrap.data.accessToken
      );
      expect(customSaved.data.user.properties.shift).toBe('night');

      const customDeleted = await requestJson(
        local.url,
        'DELETE',
        `/auth/admin/users/${created.data.user.userId}/properties/shift`,
        undefined,
        bootstrap.data.accessToken
      );
      expect(customDeleted.status).toBe(200);

      const afterDelete = await requestJson(
        local.url,
        'GET',
        `/auth/admin/users/${created.data.user.userId}`,
        undefined,
        bootstrap.data.accessToken
      );
      expect(afterDelete.data.user.properties.shift).toBeUndefined();
    } finally {
      await local.stop();
    }
  });

  test('disabled registration mode with explicit public bootstrap then blocks all user creation', async () => {
    const local = await startAuthApp({
      registration: {
        mode: 'disabled',
      },
    });

    try {
      const bootstrap = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'disabled-owner',
        email: 'disabled-owner@test.com',
        password: 'password123',
      });
      expect(bootstrap.status).toBe(200);
      expect(bootstrap.data.user.role).toBe('admin');

      const closed = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'closed-disabled',
        email: 'closed-disabled@test.com',
        password: 'password123',
      });
      expect(closed.status).toBe(403);
      expect(closed.data.code).toBe('REGISTRATION_DISABLED');

      const adminCreated = await requestJson(
        local.url,
        'POST',
        '/auth/admin/users',
        {
          username: 'blocked-worker',
          email: 'blocked-worker@test.com',
          password: 'password123',
        },
        bootstrap.data.accessToken
      );
      expect(adminCreated.status).toBe(403);
      expect(adminCreated.data.code).toBe('REGISTRATION_DISABLED');
    } finally {
      await local.stop();
    }
  });
});

// ─── MFA Flows ────────────────────────────────────────────────────────────

describe('Auth Plugin — MFA Flows', () => {
  test('required TOTP setup gates registration and login until MFA succeeds', async () => {
    const local = await startAuthApp({
      mfa: {
        enabled: true,
        policy: 'required',
        methods: ['totp'],
        totp: {
          issuer: 'Zero Tests',
          encryptionKey: 'totp-secret-key',
        },
      },
    });

    try {
      const registered = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'mfa-owner',
        email: 'mfa-owner@test.com',
        password: 'password123',
      });
      expect(registered.status).toBe(200);
      expect(registered.data.accessToken).toBeUndefined();
      expect(registered.data.mfaSetupRequired).toBe(true);
      expect(registered.data.mfaSetupToken).toBeString();

      const setup = await requestJson(local.url, 'POST', '/auth/mfa/setup', {
        setupToken: registered.data.mfaSetupToken,
        method: 'totp',
      });
      expect(setup.status).toBe(200);
      expect(setup.data.method.type).toBe('totp');
      expect(setup.data.totp.secret).toBeString();
      expect(setup.data.totp.otpauthUrl).toContain('otpauth://totp/');

      const setupCode = generateTotpCode({ secret: setup.data.totp.secret });
      const verifiedSetup = await requestJson(local.url, 'POST', '/auth/mfa/setup/verify', {
        verificationToken: setup.data.verificationToken,
        code: setupCode,
      });
      expect(verifiedSetup.status).toBe(200);
      expect(verifiedSetup.data.accessToken).toBeDefined();
      expect(verifiedSetup.data.refreshToken).toBeDefined();
      expect(verifiedSetup.data.method.status).toBe('active');
      expectActivePageSession(verifiedSetup);

      const login = await requestJson(local.url, 'POST', '/auth/login', {
        username: 'mfa-owner',
        password: 'password123',
      });
      expect(login.status).toBe(200);
      expect(login.data.accessToken).toBeUndefined();
      expect(login.data.mfaChallengeRequired).toBe(true);
      expect(login.data.mfaChallenge.method.type).toBe('totp');
      expect(login.data.mfaChallenge.challengeToken).toBeString();

      const challengeCode = generateTotpCode({ secret: setup.data.totp.secret });
      const verifiedChallenge = await requestJson(local.url, 'POST', '/auth/mfa/challenge/verify', {
        challengeToken: login.data.mfaChallenge.challengeToken,
        code: challengeCode,
      });
      expect(verifiedChallenge.status).toBe(200);
      expect(verifiedChallenge.data.accessToken).toBeDefined();
      expect(verifiedChallenge.data.refreshToken).toBeDefined();
      expect(verifiedChallenge.data.user.username).toBe('mfa-owner');
      expectActivePageSession(verifiedChallenge);
    } finally {
      await local.stop();
    }
  });

  test('email MFA sends a one-time code without requiring a public app URL', async () => {
    const provider = new MemoryEmailProvider();
    configureEmail({
      from: 'Zero <noreply@test.com>',
      provider,
    }, {
      name: 'Zero Test',
    });

    const local = await startAuthApp({
      mfa: {
        enabled: true,
        policy: 'required',
        methods: ['email'],
      },
    });

    try {
      const registered = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'email-mfa-owner',
        email: 'email-mfa-owner@test.com',
        password: 'password123',
      });
      expect(registered.status).toBe(200);
      expect(registered.data.mfaSetupRequired).toBe(true);

      const setup = await requestJson(local.url, 'POST', '/auth/mfa/setup', {
        setupToken: registered.data.mfaSetupToken,
        method: 'email',
      });
      expect(setup.status).toBe(200);
      expect(setup.data.challenge.delivery).toBe('email');
      expect(provider.messages).toHaveLength(1);

      const setupCode = extractOtpFromEmail(provider.messages[0].message.text);
      const verifiedSetup = await requestJson(local.url, 'POST', '/auth/mfa/setup/verify', {
        verificationToken: setup.data.verificationToken,
        code: setupCode,
      });
      expect(verifiedSetup.status).toBe(200);
      expect(verifiedSetup.data.accessToken).toBeDefined();
      expectActivePageSession(verifiedSetup);

      const login = await requestJson(local.url, 'POST', '/auth/login', {
        username: 'email-mfa-owner',
        password: 'password123',
      });
      expect(login.status).toBe(200);
      expect(login.data.mfaChallengeRequired).toBe(true);
      expect(provider.messages).toHaveLength(2);

      const challengeCode = extractOtpFromEmail(provider.messages[1].message.text);
      const verifiedChallenge = await requestJson(local.url, 'POST', '/auth/mfa/challenge/verify', {
        challengeToken: login.data.mfaChallenge.challengeToken,
        code: challengeCode,
      });
      expect(verifiedChallenge.status).toBe(200);
      expect(verifiedChallenge.data.accessToken).toBeDefined();
      expectActivePageSession(verifiedChallenge);
    } finally {
      await local.stop();
      configureEmail(false);
    }
  });

  test('optional MFA requested during email-gated registration starts after email verification', async () => {
    const provider = new MemoryEmailProvider();
    configureEmail({
      from: 'Zero <noreply@test.com>',
      provider,
    }, {
      name: 'Zero Test',
      publicUrl: 'https://app.test',
    });

    const local = await startAuthApp({
      account: {
        requireEmailVerification: true,
      },
      mfa: {
        enabled: true,
        policy: 'optional',
        methods: ['totp'],
        totp: {
          issuer: 'Zero Tests',
          encryptionKey: 'totp-secret-key',
        },
      },
    });

    try {
      const admin = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'optional-mfa-owner',
        email: 'optional-mfa-owner@test.com',
        password: 'password123',
      });
      expect(admin.status).toBe(200);
      expect(admin.data.accessToken).toBeDefined();
      expect(provider.messages).toHaveLength(0);

      const registered = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'optional-mfa-user',
        email: 'optional-mfa-user@test.com',
        password: 'password123',
        mfaEnrollment: true,
      });
      expect(registered.status).toBe(200);
      expect(registered.data.accessToken).toBeUndefined();
      expect(registered.data.user.emailVerificationRequired).toBe(true);
      expect(provider.messages).toHaveLength(1);

      const blockedLogin = await requestJson(local.url, 'POST', '/auth/login', {
        username: 'optional-mfa-user',
        password: 'password123',
      });
      expect(blockedLogin.status).toBe(403);
      expect(blockedLogin.data.code).toBe('EMAIL_VERIFICATION_REQUIRED');

      const token = extractTokenFromEmail(provider.messages[0].message.text);
      const verifiedEmail = await requestJson(local.url, 'POST', '/auth/verify-email', {
        token,
      });
      expect(verifiedEmail.status).toBe(200);
      expect(verifiedEmail.data.accessToken).toBeUndefined();
      expect(verifiedEmail.data.refreshToken).toBeUndefined();
      expect(verifiedEmail.data.mfaSetupRequired).toBe(true);
      expect(verifiedEmail.data.mfaSetupToken).toBeString();
      expect(verifiedEmail.data.mfa.methods).toEqual(['totp']);

      const setup = await requestJson(local.url, 'POST', '/auth/mfa/setup', {
        setupToken: verifiedEmail.data.mfaSetupToken,
        method: 'totp',
      });
      expect(setup.status).toBe(200);
      expect(setup.data.totp.secret).toBeString();

      const setupCode = generateTotpCode({ secret: setup.data.totp.secret });
      const verifiedSetup = await requestJson(local.url, 'POST', '/auth/mfa/setup/verify', {
        verificationToken: setup.data.verificationToken,
        code: setupCode,
      });
      expect(verifiedSetup.status).toBe(200);
      expect(verifiedSetup.data.accessToken).toBeDefined();
      expect(verifiedSetup.data.refreshToken).toBeDefined();
      expect(verifiedSetup.data.user.username).toBe('optional-mfa-user');
      expectActivePageSession(verifiedSetup);
    } finally {
      await local.stop();
      configureEmail(false);
    }
  });
});

// ─── Account Lifecycle Email Flows ────────────────────────────────────────

describe('Auth Plugin — Account Lifecycle Email Flows', () => {
  test('forgot password sends a reset email and token resets the password once', async () => {
    const provider = new MemoryEmailProvider();
    configureEmail({
      from: 'Zero <noreply@test.com>',
      provider,
    }, {
      name: 'Zero Test',
      publicUrl: 'https://app.test',
    });

    const local = await startAuthApp({
      accountEmails: {
        passwordReset: true,
      },
    });

    try {
      const registered = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'resetme',
        email: 'resetme@test.com',
        password: 'oldpassword1',
      });
      expect(registered.status).toBe(200);

      const forgot = await requestJson(local.url, 'POST', '/auth/forgot-password', {
        email: 'resetme@test.com',
      });
      expect(forgot.status).toBe(200);
      expect(forgot.data.ok).toBe(true);
      expect(provider.messages).toHaveLength(1);
      expect(provider.messages[0].message.to).toBe('resetme@test.com');

      const token = extractTokenFromEmail(provider.messages[0].message.text);
      const inspected = await requestJson(local.url, 'GET', `/auth/action-token/${token}`);
      expect(inspected.status).toBe(200);
      expect(inspected.data.type).toBe('password_reset');

      const reset = await requestJson(local.url, 'POST', '/auth/reset-password', {
        token,
        newPassword: 'newpassword1',
      });
      expect(reset.status).toBe(200);
      expect(reset.data.accessToken).toBeUndefined();
      expect(reset.data.passwordUpdated).toBe(true);
      expect(reset.data.signInRequired).toBe(true);
      expect(reset.data.user.passwordChangeRequired).toBe(false);
      expectClearedPageSession(reset);

      const oldLogin = await requestJson(local.url, 'POST', '/auth/login', {
        username: 'resetme',
        password: 'oldpassword1',
      });
      expect(oldLogin.status).toBe(401);

      const newLogin = await requestJson(local.url, 'POST', '/auth/login', {
        username: 'resetme',
        password: 'newpassword1',
      });
      expect(newLogin.status).toBe(200);

      const replay = await requestJson(local.url, 'POST', '/auth/reset-password', {
        token,
        newPassword: 'anotherpassword1',
      });
      expect(replay.status).toBe(400);
      expect(replay.data.code).toBe('ACTION_TOKEN_CONSUMED');
    } finally {
      await local.stop();
      configureEmail(false);
    }
  });

  test('password reset completes before a fresh-login MFA challenge is attempted', async () => {
    let failDelivery = false;
    let deliveryAttempts = 0;
    const deliveredMessages: EmailMessage[] = [];
    const provider: EmailProvider = {
      name: 'switchable-mfa-delivery',
      async send(message) {
        deliveryAttempts += 1;
        if (failDelivery) throw new Error('Simulated provider outage');
        deliveredMessages.push(message);
        return {
          provider: this.name,
          accepted: Array.isArray(message.to) ? message.to : [message.to],
        };
      },
    };
    configureEmail({
      from: 'Zero <noreply@test.com>',
      provider,
    }, {
      name: 'Zero Test',
      publicUrl: 'https://app.test',
    });

    const local = await startAuthApp({
      accountEmails: { passwordReset: true },
      mfa: {
        enabled: true,
        policy: 'required',
        methods: ['email'],
      },
    });

    try {
      const registered = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'mfa-reset-owner',
        email: 'mfa-reset-owner@test.com',
        password: 'oldpassword1',
      });
      expect(registered.status).toBe(200);
      expect(registered.data.mfaSetupRequired).toBe(true);

      const mfaSetup = await requestJson(local.url, 'POST', '/auth/mfa/setup', {
        setupToken: registered.data.mfaSetupToken,
        method: 'email',
      });
      expect(mfaSetup.status).toBe(200);

      const setupCode = extractOtpFromEmail(deliveredMessages[0]!.text);
      const verifiedSetup = await requestJson(local.url, 'POST', '/auth/mfa/setup/verify', {
        verificationToken: mfaSetup.data.verificationToken,
        code: setupCode,
      });
      expect(verifiedSetup.status).toBe(200);

      const forgot = await requestJson(local.url, 'POST', '/auth/forgot-password', {
        email: 'mfa-reset-owner@test.com',
      });
      expect(forgot.status).toBe(200);
      expect(deliveredMessages).toHaveLength(2);

      const token = extractTokenFromEmail(deliveredMessages[1]!.text);
      failDelivery = true;
      const reset = await requestJson(local.url, 'POST', '/auth/reset-password', {
        token,
        newPassword: 'newpassword1',
      });
      expect(reset.status).toBe(200);
      expect(reset.data).toMatchObject({
        passwordUpdated: true,
        signInRequired: true,
      });
      expect(deliveryAttempts).toBe(2);
      expectClearedPageSession(reset);

      const oldLogin = await requestJson(local.url, 'POST', '/auth/login', {
        username: 'mfa-reset-owner',
        password: 'oldpassword1',
      });
      expect(oldLogin.status).toBe(401);
      expect(oldLogin.data.code).toBe('INVALID_CREDENTIALS');

      failDelivery = false;
      const newLogin = await requestJson(local.url, 'POST', '/auth/login', {
        username: 'mfa-reset-owner',
        password: 'newpassword1',
      });
      expect(newLogin.status).toBe(200);
      expect(newLogin.data.mfaChallengeRequired).toBe(true);
      expect(deliveryAttempts).toBe(3);
    } finally {
      await local.stop();
      configureEmail(false);
    }
  });

  test('forgot password requires ready email config before creating a token', async () => {
    configureEmail(false);
    const local = await startAuthApp({
      accountEmails: {
        passwordReset: true,
      },
    });

    try {
      const registered = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'reset-config',
        email: 'reset-config@test.com',
        password: 'oldpassword1',
      });
      expect(registered.status).toBe(200);

      const forgot = await requestJson(local.url, 'POST', '/auth/forgot-password', {
        email: 'reset-config@test.com',
      });
      expect(forgot.status).toBe(503);
      expect(forgot.data.code).toBe('EMAIL_NOT_CONFIGURED');

      const row = local.db
        .prepare('SELECT COUNT(*) as count FROM _auth_action_tokens')
        .get() as { count: number };
      expect(row.count).toBe(0);
    } finally {
      await local.stop();
      configureEmail(false);
    }
  });

  test('forgot password hides unknown users and cooldown repeats', async () => {
    const provider = new MemoryEmailProvider();
    configureEmail({
      from: 'Zero <noreply@test.com>',
      provider,
    }, {
      name: 'Zero Test',
      publicUrl: 'https://app.test',
    });

    const local = await startAuthApp({
      accountEmails: {
        passwordReset: true,
        requestCooldown: '5m',
      },
    });

    try {
      const unknown = await requestJson(local.url, 'POST', '/auth/forgot-password', {
        email: 'missing@test.com',
      });
      expect(unknown.status).toBe(200);
      expect(unknown.data.ok).toBe(true);
      expect(provider.messages).toHaveLength(0);

      const registered = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'cooldown-reset',
        email: 'cooldown-reset@test.com',
        password: 'oldpassword1',
      });
      expect(registered.status).toBe(200);

      const first = await requestJson(local.url, 'POST', '/auth/forgot-password', {
        email: 'cooldown-reset@test.com',
      });
      const second = await requestJson(local.url, 'POST', '/auth/forgot-password', {
        email: 'cooldown-reset@test.com',
      });
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(provider.messages).toHaveLength(1);
    } finally {
      await local.stop();
      configureEmail(false);
    }
  });

  test('forgot password logs privacy-safe sent and suppressed outcomes', async () => {
    const previousObservabilityConfig = getObservabilityRuntime().config;
    const events = new MemoryEventStore();
    configureObservability({ console: false, store: events });

    const provider = new MemoryEmailProvider();
    configureEmail({
      from: 'Zero <noreply@test.com>',
      provider,
    }, {
      name: 'Zero Test',
      publicUrl: 'https://app.test',
    });

    const local = await startAuthApp({
      accountEmails: {
        passwordReset: true,
        requestCooldown: '5m',
      },
    });

    try {
      const active = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'logged-reset',
        email: 'logged-reset@test.com',
        password: 'oldpassword1',
      });
      const suspended = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'suspended-reset',
        email: 'suspended-reset@test.com',
        password: 'oldpassword1',
      });
      expect(active.status).toBe(200);
      expect(suspended.status).toBe(200);
      local.db.prepare("UPDATE users SET status = 'suspended' WHERE user_id = ?")
        .run(suspended.data.user.userId);

      const unknownReset = await requestJson(local.url, 'POST', '/auth/forgot-password', {
        email: 'private-missing-address@test.com',
      });
      const suspendedReset = await requestJson(local.url, 'POST', '/auth/forgot-password', {
        email: 'suspended-reset@test.com',
      });
      const deliveredReset = await requestJson(local.url, 'POST', '/auth/forgot-password', {
        email: 'logged-reset@test.com',
      });
      const cooldownReset = await requestJson(local.url, 'POST', '/auth/forgot-password', {
        email: 'logged-reset@test.com',
      });

      expect(unknownReset.status).toBe(200);
      expect(suspendedReset.status).toBe(200);
      expect(deliveredReset.status).toBe(200);
      expect(cooldownReset.status).toBe(200);
      expect(provider.messages).toHaveLength(1);

      const suppressedEvents = events.query({
        code: OBS_CODES.AUTH_PASSWORD_RESET_SUPPRESSED.code,
      }).events;
      expect(suppressedEvents.map((event) => event.metadata?.reason)).toEqual([
        'account_not_found',
        'account_suspended',
        'cooldown',
      ]);

      const sentEvents = events.query({
        code: OBS_CODES.AUTH_PASSWORD_RESET_SENT.code,
      }).events;
      expect(sentEvents).toHaveLength(1);
      expect(sentEvents[0].userId).toBe(active.data.user.userId);

      const outcomeLog = JSON.stringify([...suppressedEvents, ...sentEvents]);
      expect(outcomeLog).not.toContain('private-missing-address@test.com');
      expect(outcomeLog).not.toContain('suspended-reset@test.com');
      expect(outcomeLog).not.toContain('logged-reset@test.com');
    } finally {
      await local.stop();
      configureEmail(false);
      configureObservability(previousObservabilityConfig);
    }
  });

  test('forgot password cleans failed tokens and retries durably in the background', async () => {
    const previousObservabilityConfig = getObservabilityRuntime().config;
    const events = new MemoryEventStore();
    configureObservability({ console: false, store: events });

    let attempts = 0;
    const deliveredMessages: EmailMessage[] = [];
    const provider: EmailProvider = {
      name: 'fail-once',
      async send(message) {
        attempts += 1;
        if (attempts === 1) throw new Error('Simulated provider failure');
        deliveredMessages.push(message);
        return {
          provider: this.name,
          accepted: Array.isArray(message.to) ? message.to : [message.to],
        };
      },
    };
    configureEmail({
      from: 'Zero <noreply@test.com>',
      provider,
    }, {
      name: 'Zero Test',
      publicUrl: 'https://app.test',
    });

    const local = await startAuthApp({
      accountEmails: {
        passwordReset: true,
        requestCooldown: '5m',
      },
    });

    try {
      const registered = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'retry-reset',
        email: 'retry-reset@test.com',
        password: 'oldpassword1',
      });
      expect(registered.status).toBe(200);

      const unknown = await requestJson(local.url, 'POST', '/auth/forgot-password', {
        email: 'unknown-retry-reset@test.com',
      });
      const failed = await requestJson(local.url, 'POST', '/auth/forgot-password', {
        email: 'retry-reset@test.com',
      });
      expect(failed.status).toBe(unknown.status);
      expect(failed.data).toEqual(unknown.data);
      expect(failed.status).toBe(200);
      expect(failed.data.ok).toBe(true);

      const failedEvents = events.query({
        code: OBS_CODES.AUTH_PASSWORD_RESET_DELIVERY_FAILED.code,
      }).events;
      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0].userId).toBe(registered.data.user.userId);
      expect(failedEvents[0].metadata).toEqual({
        source: 'forgot-password',
        cleanupSucceeded: true,
      });
      const failedOutcomeLog = JSON.stringify(failedEvents[0]);
      expect(failedOutcomeLog).not.toContain('retry-reset@test.com');
      expect(failedOutcomeLog).not.toContain('fail-once');

      const retried = await requestJson(local.url, 'POST', '/auth/forgot-password', {
        email: 'retry-reset@test.com',
      });
      expect(retried.status).toBe(200);
      expect(retried.data.ok).toBe(true);
      await waitUntil(() => attempts === 2);
      expect(attempts).toBe(2);
      expect(deliveredMessages).toHaveLength(1);

      const activeTokens = local.db.prepare(
        `SELECT COUNT(*) as count
         FROM _auth_action_tokens
         WHERE type = 'password_reset' AND consumed_at IS NULL`
      ).get() as { count: number };
      expect(activeTokens.count).toBe(1);
    } finally {
      await local.stop();
      configureEmail(false);
      configureObservability(previousObservabilityConfig);
    }
  });

  test('email verification gates public registration until the emailed token is consumed', async () => {
    const provider = new MemoryEmailProvider();
    configureEmail({
      from: 'Zero <noreply@test.com>',
      provider,
    }, {
      name: 'Zero Test',
      publicUrl: 'https://app.test',
    });

    const local = await startAuthApp({
      account: {
        requireEmailVerification: true,
      },
    });

    try {
      const admin = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'verify-owner',
        email: 'verify-owner@test.com',
        password: 'password123',
      });
      expect(admin.status).toBe(200);
      expect(admin.data.accessToken).toBeDefined();
      expect(provider.messages).toHaveLength(0);

      const registered = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'verify-me',
        email: 'verify-me@test.com',
        password: 'password123',
      });
      expect(registered.status).toBe(200);
      expect(registered.data.accessToken).toBeUndefined();
      expect(registered.data.refreshToken).toBeUndefined();
      expect(registered.data.user.emailVerificationRequired).toBe(true);
      expect(registered.data.user.emailVerifiedAt).toBeNull();
      expect(provider.messages).toHaveLength(1);
      expect(provider.messages[0].message.to).toBe('verify-me@test.com');
      expect(provider.messages[0].message.subject).toBe('Verify your Zero Test email');

      const blockedLogin = await requestJson(local.url, 'POST', '/auth/login', {
        username: 'verify-me',
        password: 'password123',
      });
      expect(blockedLogin.status).toBe(403);
      expect(blockedLogin.data.code).toBe('EMAIL_VERIFICATION_REQUIRED');

      const token = extractTokenFromEmail(provider.messages[0].message.text);
      const inspected = await requestJson(local.url, 'GET', `/auth/action-token/${token}`);
      expect(inspected.status).toBe(200);
      expect(inspected.data.type).toBe('email_verification');

      const verified = await requestJson(local.url, 'POST', '/auth/verify-email', {
        token,
      });
      expect(verified.status).toBe(200);
      expect(verified.data.accessToken).toBeDefined();
      expect(verified.data.refreshToken).toBeDefined();
      expect(verified.data.user.emailVerificationRequired).toBe(false);
      expect(typeof verified.data.user.emailVerifiedAt).toBe('number');
      expectActivePageSession(verified);

      const protectedRoute = await requestJson(
        local.url,
        'GET',
        '/api/whoami',
        undefined,
        verified.data.accessToken
      );
      expect(protectedRoute.status).toBe(200);

      const replay = await requestJson(local.url, 'POST', '/auth/verify-email', {
        token,
      });
      expect(replay.status).toBe(400);
      expect(replay.data.code).toBe('ACTION_TOKEN_CONSUMED');
    } finally {
      await local.stop();
      configureEmail(false);
    }
  });

  test('email verification validates email config before creating gated users', async () => {
    configureEmail(false);
    const local = await startAuthApp({
      account: {
        requireEmailVerification: true,
      },
    });

    try {
      const admin = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'verify-config-owner',
        email: 'verify-config-owner@test.com',
        password: 'password123',
      });
      expect(admin.status).toBe(200);

      const gated = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'verify-config-user',
        email: 'verify-config-user@test.com',
        password: 'password123',
      });
      expect(gated.status).toBe(503);
      expect(gated.data.code).toBe('EMAIL_NOT_CONFIGURED');

      const row = local.db
        .prepare("SELECT COUNT(*) as count FROM users WHERE email = 'verify-config-user@test.com'")
        .get() as { count: number };
      expect(row.count).toBe(0);
    } finally {
      await local.stop();
      configureEmail(false);
    }
  });

  test('resend verification hides unknown and cooldown repeat requests', async () => {
    const provider = new MemoryEmailProvider();
    configureEmail({
      from: 'Zero <noreply@test.com>',
      provider,
    }, {
      name: 'Zero Test',
      publicUrl: 'https://app.test',
    });

    const local = await startAuthApp({
      account: {
        requireEmailVerification: true,
      },
      accountEmails: {
        requestCooldown: '5m',
      },
    });

    try {
      const admin = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'verify-resend-owner',
        email: 'verify-resend-owner@test.com',
        password: 'password123',
      });
      expect(admin.status).toBe(200);

      const unknown = await requestJson(local.url, 'POST', '/auth/resend-verification', {
        email: 'missing@test.com',
      });
      expect(unknown.status).toBe(200);
      expect(provider.messages).toHaveLength(0);

      const registered = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'verify-resend-user',
        email: 'verify-resend-user@test.com',
        password: 'password123',
      });
      expect(registered.status).toBe(200);
      expect(provider.messages).toHaveLength(1);

      const first = await requestJson(local.url, 'POST', '/auth/resend-verification', {
        email: 'verify-resend-user@test.com',
      });
      const second = await requestJson(local.url, 'POST', '/auth/resend-verification', {
        email: 'verify-resend-user@test.com',
      });
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(provider.messages).toHaveLength(1);
    } finally {
      await local.stop();
      configureEmail(false);
    }
  });

  test('forgot password uses auth branding and custom email template overrides', async () => {
    const provider = new MemoryEmailProvider();
    configureEmail({
      from: 'Zero <noreply@test.com>',
      provider,
    }, {
      name: 'Runtime Name',
      publicUrl: 'https://app.test',
    });

    const local = await startAuthApp({
      branding: {
        appName: 'Branded Auth',
        brandColor: '#155eef',
      },
      accountEmails: {
        passwordReset: true,
      },
      emails: defineAuthEmailTemplates({
        passwordReset: (ctx) => ({
          subject: `Custom ${ctx.branding.appName}`,
          text: `${ctx.defaultText}\n\nTemplate key: ${ctx.key}`,
          html: ctx.defaultHtml,
        }),
      }),
    });

    try {
      const registered = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'custom-template-reset',
        email: 'custom-template-reset@test.com',
        password: 'oldpassword1',
      });
      expect(registered.status).toBe(200);

      const forgot = await requestJson(local.url, 'POST', '/auth/forgot-password', {
        email: 'custom-template-reset@test.com',
      });
      expect(forgot.status).toBe(200);
      expect(provider.messages).toHaveLength(1);

      const message = provider.messages[0].message;
      expect(message.subject).toBe('Custom Branded Auth');
      expect(message.text).toContain('A password reset was requested for your Branded Auth account.');
      expect(message.text).toContain('Template key: passwordReset');
      expect(extractTokenFromEmail(message.text)).toBeTruthy();
    } finally {
      await local.stop();
      configureEmail(false);
    }
  });

  test('admin-forced reset emails revoke sessions and block old access tokens', async () => {
    const provider = new MemoryEmailProvider();
    configureEmail({
      from: 'Zero <noreply@test.com>',
      provider,
    }, {
      name: 'Zero Test',
      publicUrl: 'https://app.test',
    });

    const local = await startAuthApp({
      registration: { mode: 'admin-only' },
      accountEmails: {
        passwordReset: true,
      },
    });

    try {
      const admin = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'owner',
        email: 'owner-reset@test.com',
        password: 'password123',
      });
      expect(admin.status).toBe(200);

      const created = await requestJson(
        local.url,
        'POST',
        '/auth/admin/users',
        {
          username: 'worker-reset',
          email: 'worker-reset@test.com',
          password: 'oldpassword1',
        },
        admin.data.accessToken
      );
      expect(created.status).toBe(200);

      const login = await requestJson(local.url, 'POST', '/auth/login', {
        username: 'worker-reset',
        password: 'oldpassword1',
      });
      expect(login.status).toBe(200);

      const forced = await requestJson(
        local.url,
        'POST',
        `/auth/admin/users/${created.data.user.userId}/send-password-reset`,
        {},
        admin.data.accessToken
      );
      expect(forced.status).toBe(200);
      expect(provider.messages).toHaveLength(1);

      const refresh = await requestJson(local.url, 'POST', '/auth/refresh', {
        refreshToken: login.data.refreshToken,
      });
      expect(refresh.status).toBe(401);

      const protectedRoute = await requestJson(
        local.url,
        'GET',
        '/api/whoami',
        undefined,
        login.data.accessToken
      );
      expect(protectedRoute.status).toBe(401);

      const blockedLogin = await requestJson(local.url, 'POST', '/auth/login', {
        username: 'worker-reset',
        password: 'oldpassword1',
      });
      expect(blockedLogin.status).toBe(403);
      expect(blockedLogin.data.code).toBe('PASSWORD_CHANGE_REQUIRED');

      const token = extractTokenFromEmail(provider.messages[0].message.text);
      const reset = await requestJson(local.url, 'POST', '/auth/reset-password', {
        token,
        newPassword: 'newpassword1',
      });
      expect(reset.status).toBe(200);
      expect(reset.data.passwordUpdated).toBe(true);
      expect(reset.data.signInRequired).toBe(true);
      expectClearedPageSession(reset);

      const newLogin = await requestJson(local.url, 'POST', '/auth/login', {
        username: 'worker-reset',
        password: 'newpassword1',
      });
      expect(newLogin.status).toBe(200);
    } finally {
      await local.stop();
      configureEmail(false);
    }
  });

  test('admin email reset validates email links before forcing password changes', async () => {
    const provider = new MemoryEmailProvider();
    configureEmail({
      from: 'Zero <noreply@test.com>',
      provider,
    }, {
      name: 'Zero Test',
    });

    const local = await startAuthApp({
      registration: { mode: 'admin-only' },
      accountEmails: {
        passwordReset: true,
      },
    });

    try {
      const admin = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'owner-misconfigured-email',
        email: 'owner-misconfigured-email@test.com',
        password: 'password123',
      });
      expect(admin.status).toBe(200);

      const created = await requestJson(
        local.url,
        'POST',
        '/auth/admin/users',
        {
          username: 'worker-misconfigured-email',
          email: 'worker-misconfigured-email@test.com',
          password: 'oldpassword1',
        },
        admin.data.accessToken
      );
      expect(created.status).toBe(200);

      const forced = await requestJson(
        local.url,
        'POST',
        `/auth/admin/users/${created.data.user.userId}/send-password-reset`,
        {},
        admin.data.accessToken
      );
      expect(forced.status).toBe(500);
      expect(forced.data.code).toBe('EMAIL_PUBLIC_URL_REQUIRED');
      expect(provider.messages).toHaveLength(0);

      const user = await requestJson(
        local.url,
        'GET',
        `/auth/admin/users/${created.data.user.userId}`,
        undefined,
        admin.data.accessToken
      );
      expect(user.status).toBe(200);
      expect(user.data.user.passwordChangeRequired).toBe(false);
    } finally {
      await local.stop();
      configureEmail(false);
    }
  });

  test('manual admin password reset can be disabled by config', async () => {
    const local = await startAuthApp({
      registration: { mode: 'admin-only' },
      accountEmails: {
        manualPasswordReset: false,
      },
    });

    try {
      const admin = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'manual-reset-owner',
        email: 'manual-reset-owner@test.com',
        password: 'password123',
      });
      expect(admin.status).toBe(200);

      const created = await requestJson(
        local.url,
        'POST',
        '/auth/admin/users',
        {
          username: 'manual-reset-worker',
          email: 'manual-reset-worker@test.com',
          password: 'oldpassword1',
        },
        admin.data.accessToken
      );
      expect(created.status).toBe(200);

      const reset = await requestJson(
        local.url,
        'POST',
        `/auth/admin/users/${created.data.user.userId}/reset-password`,
        { password: 'newpassword1' },
        admin.data.accessToken
      );
      expect(reset.status).toBe(403);
      expect(reset.data.code).toBe('MANUAL_PASSWORD_RESET_DISABLED');
    } finally {
      await local.stop();
    }
  });

  test('admin-created account can be completed through setup email without exposing a password', async () => {
    const provider = new MemoryEmailProvider();
    configureEmail({
      from: 'Zero <noreply@test.com>',
      provider,
    }, {
      name: 'Zero Test',
      publicUrl: 'https://app.test',
    });

    const local = await startAuthApp({
      registration: { mode: 'admin-only' },
      accountEmails: {
        adminCreatedUser: true,
      },
    });

    try {
      const admin = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'setup-owner',
        email: 'setup-owner@test.com',
        password: 'password123',
      });
      expect(admin.status).toBe(200);

      const created = await requestJson(
        local.url,
        'POST',
        '/auth/admin/users',
        {
          username: 'setup-worker',
          email: 'setup-worker@test.com',
          sendSetupEmail: true,
        },
        admin.data.accessToken
      );
      expect(created.status).toBe(200);
      expect(created.data.setupEmailSent).toBe(true);
      expect(created.data.user.passwordChangeRequired).toBe(true);
      expect(provider.messages).toHaveLength(1);

      const token = extractTokenFromEmail(provider.messages[0].message.text);
      const setup = await requestJson(local.url, 'POST', '/auth/setup-password', {
        token,
        newPassword: 'firstpassword1',
      });
      expect(setup.status).toBe(200);
      expect(setup.data.user.passwordChangeRequired).toBe(false);
      expect(setup.data.passwordUpdated).toBe(true);
      expect(setup.data.signInRequired).toBe(true);
      expectClearedPageSession(setup);

      const login = await requestJson(local.url, 'POST', '/auth/login', {
        username: 'setup-worker',
        password: 'firstpassword1',
      });
      expect(login.status).toBe(200);
    } finally {
      await local.stop();
      configureEmail(false);
    }
  });

  test('suspended accounts cannot log in or use old tokens', async () => {
    const local = await startAuthApp({
      registration: { mode: 'admin-only' },
    });

    try {
      const admin = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'suspend-owner',
        email: 'suspend-owner@test.com',
        password: 'password123',
      });
      expect(admin.status).toBe(200);

      const created = await requestJson(
        local.url,
        'POST',
        '/auth/admin/users',
        {
          username: 'suspended-worker',
          email: 'suspended-worker@test.com',
          password: 'password123',
        },
        admin.data.accessToken
      );
      const login = await requestJson(local.url, 'POST', '/auth/login', {
        username: 'suspended-worker',
        password: 'password123',
      });
      expect(login.status).toBe(200);

      const suspended = await requestJson(
        local.url,
        'POST',
        `/auth/admin/users/${created.data.user.userId}/suspend`,
        {},
        admin.data.accessToken
      );
      expect(suspended.status).toBe(200);
      expect(suspended.data.user.status).toBe('suspended');

      const blockedLogin = await requestJson(local.url, 'POST', '/auth/login', {
        username: 'suspended-worker',
        password: 'password123',
      });
      expect(blockedLogin.status).toBe(403);
      expect(blockedLogin.data.code).toBe('ACCOUNT_SUSPENDED');

      const protectedRoute = await requestJson(
        local.url,
        'GET',
        '/api/whoami',
        undefined,
        login.data.accessToken
      );
      expect(protectedRoute.status).toBe(401);

      const activated = await requestJson(
        local.url,
        'POST',
        `/auth/admin/users/${created.data.user.userId}/activate`,
        {},
        admin.data.accessToken
      );
      expect(activated.status).toBe(200);
      expect(activated.data.user.status).toBe('active');

      const allowedLogin = await requestJson(local.url, 'POST', '/auth/login', {
        username: 'suspended-worker',
        password: 'password123',
      });
      expect(allowedLogin.status).toBe(200);
    } finally {
      await local.stop();
    }
  });

  test('admin user list supports paging and filters', async () => {
    const local = await startAuthApp({
      registration: { mode: 'admin-only' },
    });

    try {
      const admin = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'list-owner',
        email: 'list-owner@test.com',
        password: 'password123',
      });
      expect(admin.status).toBe(200);

      const active = await requestJson(
        local.url,
        'POST',
        '/auth/admin/users',
        {
          username: 'ops-active',
          email: 'ops-active@test.com',
          password: 'password123',
        },
        admin.data.accessToken
      );
      const suspended = await requestJson(
        local.url,
        'POST',
        '/auth/admin/users',
        {
          username: 'ops-suspended',
          email: 'ops-suspended@test.com',
          password: 'password123',
        },
        admin.data.accessToken
      );
      expect(active.status).toBe(200);
      expect(suspended.status).toBe(200);

      await requestJson(
        local.url,
        'POST',
        `/auth/admin/users/${suspended.data.user.userId}/suspend`,
        {},
        admin.data.accessToken
      );

      const filtered = await requestJson(
        local.url,
        'GET',
        '/auth/admin/users?search=ops&status=active&limit=1&offset=0',
        undefined,
        admin.data.accessToken
      );
      expect(filtered.status).toBe(200);
      expect(filtered.data.users).toHaveLength(1);
      expect(filtered.data.users[0].username).toBe('ops-active');
      expect(filtered.data.page.total).toBe(1);
      expect(filtered.data.page.hasMore).toBe(false);
    } finally {
      await local.stop();
    }
  });
});
