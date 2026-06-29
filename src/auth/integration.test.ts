import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { createReactiveDB, ReactiveDB } from '../sync/reactive-db';
import { createAuthPlugin, getTokenService } from './auth.plugin';
import { createAuthMiddleware } from './auth.middleware';
import { configureEmail, MemoryEmailProvider } from '../email';

// ─── Test Setup ───────────────────────────────────────────────────────────

let db: ReactiveDB;
let app: any;
let baseUrl: string;
let bootstrapAdminToken: string;

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

async function requestJson(
  url: string,
  method: string,
  path: string,
  body?: object,
  token?: string
): Promise<{ status: number; data: any }> {
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
  return { status: res.status, data };
}

async function post(path: string, body: object, token?: string): Promise<{ status: number; data: any }> {
  return requestJson(baseUrl, 'POST', path, body, token);
}

async function patch(path: string, body: object, token?: string): Promise<{ status: number; data: any }> {
  return requestJson(baseUrl, 'PATCH', path, body, token);
}

async function put(path: string, body: object, token?: string): Promise<{ status: number; data: any }> {
  return requestJson(baseUrl, 'PUT', path, body, token);
}

async function del(path: string, token?: string): Promise<{ status: number; data: any }> {
  return requestJson(baseUrl, 'DELETE', path, undefined, token);
}

async function get(path: string, token?: string): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, { headers });
  return { status: res.status, data: await res.json() };
}

async function startAuthApp(config: Omit<Parameters<typeof createAuthPlugin>[0], 'db'> = {}) {
  const localDb = createReactiveDB({ mode: 'memory' });
  const localApp = new Elysia()
    .use(createAuthPlugin({ db: localDb, ...config }))
    .use(createAuthMiddleware(getTokenService))
    .get('/api/whoami', (ctx: any) => {
      if (!ctx.authContext) return new Response('Unauthorized', { status: 401 });
      return { userId: ctx.authContext.userId, role: ctx.authContext.role };
    });
  localApp.listen(0);
  const url = `http://localhost:${localApp.server!.port}`;

  return {
    db: localDb,
    app: localApp,
    url,
    async stop() {
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

// ─── Registration ─────────────────────────────────────────────────────────

describe('Auth Plugin — Registration', () => {
  test('GET /auth/config reports first-user bootstrap before users exist', async () => {
    const { status, data } = await get('/auth/config');

    expect(status).toBe(200);
    expect(data.registration.bootstrapRequired).toBe(true);
    expect(data.registration.publicRegistrationEnabled).toBe(true);
    expect(data.registration.userCount).toBe(0);
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
    expect(data.registration.userCount).toBeGreaterThan(0);
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

// ─── Admin Users ──────────────────────────────────────────────────────────

describe('Auth Plugin — Admin Users', () => {
  test('admin can inspect config and manage users/properties/passwords', async () => {
    const config = await get('/auth/admin/config', bootstrapAdminToken);
    expect(config.status).toBe(200);
    expect(config.data.registration.publicRegistrationEnabled).toBe(true);

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

// ─── Registration Policy And Configured Properties ────────────────────────

describe('Auth Plugin — Registration Policy And Configured Properties', () => {
  test('admin-only mode keeps bootstrap open, then requires admin-created users', async () => {
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
    } finally {
      await local.stop();
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
      expect(reset.data.accessToken).toBeDefined();
      expect(reset.data.user.passwordChangeRequired).toBe(false);

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
