import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { createAuthPlugin } from './auth.plugin';
import { AUTH_REQUEST_LIMITS as LIMIT } from './auth-request-limits';

let app: any;
let db: ReactiveDB;
let baseUrl: string;
let adminToken: string;

beforeAll(() => {
  db = createReactiveDB({ mode: 'memory' });
  app = new Elysia().use(createAuthPlugin({
    db,
    bootstrap: 'public',
    accountEmails: { passwordReset: false },
  }));
  app.listen(0);
  baseUrl = `http://localhost:${app.server!.port}`;
});

afterAll(async () => {
  await app.stop();
  db.dispose();
});

describe('Auth HTTP request bounds', () => {
  test('accepts exact public boundaries', async () => {
    const registered = await json('POST', '/auth/register', {
      username: 'u'.repeat(LIMIT.username),
      email: 'limits-admin@example.test',
      password: 'p'.repeat(LIMIT.password),
      firstName: 'f'.repeat(LIMIT.displayName),
      lastName: 'l'.repeat(LIMIT.displayName),
    });
    expect(registered.status).toBe(200);
    adminToken = registered.data.accessToken;

    const login = await json('POST', '/auth/login', {
      username: 'u'.repeat(LIMIT.loginIdentifier),
      password: 'p'.repeat(LIMIT.password),
    });
    expect(login.status).toBe(200);

    expect((await json('POST', '/auth/reset-password', {
      token: 't'.repeat(LIMIT.token),
      newPassword: 'p'.repeat(LIMIT.password),
    })).status).not.toBe(422);
    expect((await json('POST', '/auth/mfa/challenge/verify', {
      challengeToken: 't'.repeat(LIMIT.token),
      code: '1'.repeat(LIMIT.mfaCode),
    })).status).not.toBe(422);
    expect((await json('POST', '/auth/forgot-password', {
      email: 'missing@example.test',
      nativeContinuation: 'n'.repeat(LIMIT.nativeContinuation),
    })).status).not.toBe(422);
  });

  test('rejects oversized public and expensive inputs with the stable shape', async () => {
    await expectValidation('/auth/login', {
      username: 'u'.repeat(LIMIT.loginIdentifier + 1), password: 'password123',
    });
    await expectValidation('/auth/login', {
      username: 'missing', password: 'p'.repeat(LIMIT.password + 1),
    });
    await expectValidation('/auth/register', {
      username: 'oversized-name', email: 'oversized-name@example.test',
      password: 'password123', firstName: 'f'.repeat(LIMIT.displayName + 1),
    });
    await expectValidation('/auth/refresh', {
      refreshToken: 't'.repeat(LIMIT.token + 1),
    });
    await expectValidation('/auth/reset-password', {
      token: 't'.repeat(LIMIT.token + 1), newPassword: 'password123',
    });
    await expectValidation('/auth/mfa/challenge/verify', {
      challengeToken: 'token', code: '1'.repeat(LIMIT.mfaCode + 1),
    });
  });

  test('bounds admin query, identity, profile, password, and property inputs', async () => {
    expect((await json('GET', `/auth/admin/users?search=${'s'.repeat(LIMIT.userSearch)}`,
      undefined, adminToken)).status).toBe(200);
    await expectValidation(
      `/auth/admin/users?search=${'s'.repeat(LIMIT.userSearch + 1)}`,
      undefined, adminToken, 'GET'
    );
    expect((await json('GET', `/auth/admin/users/${'i'.repeat(LIMIT.userId)}`,
      undefined, adminToken)).status).toBe(404);
    await expectValidation(`/auth/admin/users/${'i'.repeat(LIMIT.userId + 1)}`,
      undefined, adminToken, 'GET');

    const properties = Object.fromEntries(Array.from(
      { length: LIMIT.propertyCount }, (_, index) => [`key-${index}`, [index]]
    ));
    const created = await json('POST', '/auth/admin/users', {
      username: 'boundary-user', email: 'boundary-user@example.test',
      password: 'p'.repeat(LIMIT.password), role: 'r'.repeat(LIMIT.role), properties,
    }, adminToken);
    expect(created.status).toBe(200);
    const userId = created.data.user.userId;

    await expectValidation('/auth/admin/users', {
      username: 'oversized-role', email: 'oversized-role@example.test',
      password: 'password123', role: 'r'.repeat(LIMIT.role + 1),
    }, adminToken);
    await expectValidation(`/auth/admin/users/${userId}`, {
      properties: { ...properties, overflow: true },
    }, adminToken, 'PATCH');

    expect((await json('PUT', `/auth/admin/users/${userId}/properties/${'k'.repeat(LIMIT.propertyKey)}`,
      { value: 'v'.repeat(LIMIT.propertyValue) }, adminToken)).status).toBe(200);
    await expectValidation(`/auth/admin/users/${userId}/properties/${'k'.repeat(LIMIT.propertyKey + 1)}`,
      { value: true }, adminToken, 'PUT');
    await expectValidation(`/auth/admin/users/${userId}/properties/value`,
      { value: 'v'.repeat(LIMIT.propertyValue + 1) }, adminToken, 'PUT');
    await expectValidation(`/auth/admin/users/${userId}/reset-password`,
      { password: 'p'.repeat(LIMIT.password + 1) }, adminToken);
  });
});

async function expectValidation(
  path: string, body?: object, token?: string, method = 'POST'
): Promise<void> {
  const response = await json(method, path, body, token);
  expect(response.status).toBe(422);
  expect(response.data).toEqual({
    error: 'Invalid auth request',
    code: 'AUTH_VALIDATION_FAILED',
  });
}

async function json(method: string, path: string, body?: object, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json().catch(() => null) as any };
}
