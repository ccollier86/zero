import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia, type AnyElysia } from 'elysia';

import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { AuthRuntime } from './auth-runtime';
import { createAuthPlugin } from './auth.plugin';

interface Harness {
  app: AnyElysia;
  db: ReactiveDB;
  runtime: AuthRuntime;
  url: string;
}

const active: Harness[] = [];

afterEach(async () => {
  for (const harness of active.splice(0).reverse()) {
    await harness.app.stop();
    harness.db.dispose();
  }
});

describe('auth private response cache policy', () => {
  test('marks credential and identity/scope-dependent responses private and no-store', async () => {
    const harness = await start();
    const publicConfig = await fetch(`${harness.url}/auth/config`);
    expectPrivateNoStore(publicConfig);

    const registration = await json(harness, 'POST', '/auth/register', {
      username: 'cache-policy-owner',
      email: 'cache-policy-owner@example.test',
      password: 'password123',
      organizationName: 'Cache Policy Organization',
    });
    expect(registration.status).toBe(200);
    expectPrivateNoStore(registration.response, '/auth/register');
    const accessToken = String(registration.body.accessToken);
    const refreshToken = String(registration.body.refreshToken);
    const userId = String((registration.body.user as { userId?: unknown }).userId);

    const login = await json(harness, 'POST', '/auth/login', {
      username: 'cache-policy-owner',
      password: 'password123',
    });
    expect(login.status).toBe(200);
    expectPrivateNoStore(login.response, '/auth/login');

    const tenantList = await json(harness, 'POST', '/auth/tenants/list', {
      refreshToken,
    });
    expect(tenantList.status).toBe(200);
    expectPrivateNoStore(tenantList.response, '/auth/tenants/list');

    const refresh = await json(harness, 'POST', '/auth/refresh', {
      refreshToken,
    });
    expect(refresh.status).toBe(200);
    expectPrivateNoStore(refresh.response, '/auth/refresh');

    const scopedPaths = [
      '/auth/me',
      '/auth/authorization',
      '/auth/me/properties',
      '/auth/me/properties/not-configured',
      '/auth/mfa/methods',
      '/auth/admin/config',
      '/auth/admin/users',
      `/auth/admin/users/${userId}`,
      `/auth/admin/users/${userId}/mfa`,
      '/auth/tenant/config',
      '/auth/tenant/members',
      '/auth/tenant/invitations',
      '/auth/tenant/join-requests',
      '/auth/tenant/domains',
      '/auth/audit/platform/events',
      '/auth/audit/platform/export?limit=10',
      '/auth/audit/tenant/events',
      '/auth/audit/tenant/export?limit=10',
    ];
    for (const path of scopedPaths) {
      const response = await fetch(`${harness.url}${path}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      expect(response.status, path).toBeLessThan(500);
      expectPrivateNoStore(response, path);
      await response.arrayBuffer();
    }

    const actionToken = await fetch(
      `${harness.url}/auth/action-token/${'a'.repeat(64)}`,
    );
    expect(actionToken.status).toBeGreaterThanOrEqual(400);
    expectPrivateNoStore(actionToken, '/auth/action-token/:token');

    // Public key material is deliberately outside the private response policy.
    const jwks = await fetch(`${harness.url}/auth/jwks`);
    expect(jwks.status).toBe(200);
    expect(jwks.headers.get('cache-control')).not.toBe('private, no-store');

    const outside = await fetch(`${harness.url}/public-cache-probe`);
    expect(outside.status).toBe(200);
    expect(outside.headers.get('cache-control')).toBeNull();
    expect(outside.headers.get('pragma')).toBeNull();
  }, 60_000);
});

async function start(): Promise<Harness> {
  const db = createReactiveDB({ mode: 'memory' });
  let runtime: AuthRuntime | null = null;
  const app = new Elysia()
    .use(createAuthPlugin({
      db,
      tenancy: 'multi',
      bootstrap: 'public',
      registration: { mode: 'public' },
      onRuntimeCreated(created) {
        runtime = created;
      },
    }))
    .get('/public-cache-probe', () => ({ ok: true }));
  app.listen(0);
  const createdRuntime = runtime as AuthRuntime | null;
  if (!createdRuntime) throw new Error('Auth runtime was not created');
  const harness = {
    app,
    db,
    runtime: createdRuntime,
    url: `http://localhost:${app.server!.port}`,
  };
  active.push(harness);
  const deadline = Date.now() + 2_000;
  while (!createdRuntime.getStore() || !createdRuntime.getTokenService()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for auth runtime');
    await Bun.sleep(5);
  }
  return harness;
}

async function json(
  harness: Harness,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{
  status: number;
  body: Record<string, unknown>;
  response: Response;
}> {
  const response = await fetch(`${harness.url}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
    response,
  };
}

function expectPrivateNoStore(response: Response, label = response.url): void {
  expect(response.headers.get('cache-control'), label).toBe('private, no-store');
  expect(response.headers.get('pragma'), label).toBe('no-cache');
}
