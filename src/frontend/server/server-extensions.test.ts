/**
 * server-extensions.test.ts
 *
 * Verifies Zero-native backend extensions through Elysia's request lifecycle.
 * Pure matcher and policy behavior lives in dedicated tests; this file proves
 * middleware policy wiring, auth integration, and app-owned scoping.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia, type AnyElysia } from 'elysia';

import { createAuthPlugin, getAuthStore } from '../../auth/auth.plugin';
import type { ReactiveDB } from '../../sync';
import { createSyncPlugin } from '../../sync';
import {
  createServerExtensionApp,
  defineEndpoint,
  defineMiddleware,
} from './server-extensions';

const policyApps: AnyElysia[] = [];

afterEach(async () => {
  for (const app of policyApps.splice(0)) {
    await app.stop();
  }
});

describe('server extensions middleware policy', () => {
  test('enforces matcher auth, admin role, and method policy through middleware', async () => {
    let app = await createPolicyApp([
      defineMiddleware({
        name: 'admin-policy',
        matcher: {
          path: '/api/admin/:path*',
          method: 'GET',
          auth: 'user',
          role: 'admin',
        },
        run({ set }) {
          (set as { headers: Record<string, string> }).headers['x-admin-policy'] = 'yes';
        },
      }),
      defineEndpoint({
        method: 'GET',
        path: '/api/admin/secure',
        handler: () => ({ ok: true }),
      }),
      defineEndpoint({
        method: 'POST',
        path: '/api/admin/secure',
        handler: () => ({ method: 'post' }),
      }),
    ]);

    const admin = await register(app, 'owner');
    const user = await register(app, 'worker');

    const anonymous = await fetch(`${baseUrl(app)}/api/admin/secure`);
    const forbidden = await fetch(`${baseUrl(app)}/api/admin/secure`, {
      headers: bearer(user.accessToken),
    });
    const allowed = await fetch(`${baseUrl(app)}/api/admin/secure`, {
      headers: bearer(admin.accessToken),
    });
    const methodMiss = await fetch(`${baseUrl(app)}/api/admin/secure`, {
      method: 'POST',
    });

    expect(anonymous.status).toBe(401);
    await expect(anonymous.json()).resolves.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toMatchObject({ code: 'FORBIDDEN' });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('x-admin-policy')).toBe('yes');
    await expect(allowed.json()).resolves.toEqual({ ok: true });
    expect(methodMiss.status).toBe(200);
    expect(methodMiss.headers.get('x-admin-policy')).toBeNull();
    await expect(methodMiss.json()).resolves.toEqual({ method: 'post' });
  });

  test('uses existing auth user properties for property matcher policy', async () => {
    let app = await createPolicyApp([
      defineMiddleware({
        name: 'department-policy',
        matcher: {
          path: '/api/accounting',
          properties: {
            department: 'accounting',
          },
        },
        run({ set, user }) {
          (set as { headers: Record<string, string> }).headers['x-user-id'] = user.userId;
        },
      }),
      defineEndpoint({
        method: 'GET',
        path: '/api/accounting',
        handler: () => ({ area: 'accounting' }),
      }),
    ]);

    const user = await register(app, 'analyst');
    const denied = await fetch(`${baseUrl(app)}/api/accounting`, {
      headers: bearer(user.accessToken),
    });
    expect(denied.status).toBe(403);

    getAuthStore()?.setProperty(user.user.userId, 'department', 'accounting');

    const allowed = await fetch(`${baseUrl(app)}/api/accounting`, {
      headers: bearer(user.accessToken),
    });

    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('x-user-id')).toBe(user.user.userId);
    await expect(allowed.json()).resolves.toEqual({ area: 'accounting' });
  });

  test('does not authorize middleware from a user-editable property', async () => {
    const app = await createPolicyApp([
      defineMiddleware({
        name: 'unsafe-department-policy',
        matcher: {
          path: '/api/accounting',
          properties: { department: 'accounting' },
        },
        run() {},
      }),
      defineEndpoint({
        method: 'GET',
        path: '/api/accounting',
        handler: () => ({ area: 'accounting' }),
      }),
    ], {
      departmentEditableBy: 'user',
      departmentPolicyTrusted: false,
    });

    const user = await register(app, 'self-editor');
    getAuthStore()?.setProperty(user.user.userId, 'department', 'accounting');

    const response = await fetch(`${baseUrl(app)}/api/accounting`, {
      headers: bearer(user.accessToken),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_POLICY_UNAVAILABLE',
    });
  });

  test('preserves legacy path and auth middleware aliases', async () => {
    let app = await createPolicyApp([
      defineMiddleware({
        name: 'legacy-policy',
        path: '/api/legacy/*',
        auth: 'user',
        run({ set }) {
          (set as { headers: Record<string, string> }).headers['x-legacy-policy'] = 'yes';
        },
      }),
      defineEndpoint({
        method: 'GET',
        path: '/api/legacy/check',
        handler: () => ({ legacy: true }),
      }),
    ]);

    const user = await register(app, 'legacy');

    const anonymous = await fetch(`${baseUrl(app)}/api/legacy/check`);
    const allowed = await fetch(`${baseUrl(app)}/api/legacy/check`, {
      headers: bearer(user.accessToken),
    });

    expect(anonymous.status).toBe(401);
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('x-legacy-policy')).toBe('yes');
  });

  test('keeps middleware scoped to the app-owned extension bundle', async () => {
    let app = await createPolicyApp([
      defineMiddleware({
        name: 'extension-only',
        path: '/api/*',
        run({ set }) {
          (set as { headers: Record<string, string> }).headers['x-extension-only'] = 'yes';
        },
      }),
      defineEndpoint({
        method: 'GET',
        path: '/api/inside',
        handler: () => ({ inside: true }),
      }),
    ]);

    app = app.get('/api/outside', () => ({ outside: true }));

    const inside = await fetch(`${baseUrl(app)}/api/inside`);
    const outside = await fetch(`${baseUrl(app)}/api/outside`);

    expect(inside.headers.get('x-extension-only')).toBe('yes');
    expect(outside.headers.get('x-extension-only')).toBeNull();
  });
});

async function createPolicyApp(
  extensions: Parameters<typeof createServerExtensionApp>[0]['extensions'],
  options: {
    departmentEditableBy?: 'user' | 'admin';
    departmentPolicyTrusted?: boolean;
  } = {}
): Promise<AnyElysia> {
  let db!: ReactiveDB;
  let app = new Elysia()
    .use(createSyncPlugin({
      db: { mode: 'memory' },
      tables: {
        customers: {
          customer_id: 'text primary key',
          name: 'text not null',
        },
      },
      onDatabaseCreated(created) {
        db = created;
      },
    })) as AnyElysia;

  if (!db) throw new Error('Sync DB failed to initialize for test.');

  app = app.use(createAuthPlugin({
    db,
    bootstrap: 'public',
    registration: { mode: 'public' },
    userProperties: {
      department: {
        type: 'enum',
        values: ['operations', 'accounting'],
        default: 'operations',
        editableBy: options.departmentEditableBy ?? 'admin',
        useInPolicies: options.departmentPolicyTrusted ?? true,
      },
    },
  }));

  app = app.use(await createServerExtensionApp({ extensions }) as any);
  app.listen(0);
  policyApps.push(app);

  return app;
}

async function register(app: AnyElysia, username: string): Promise<{
  accessToken: string;
  user: { userId: string; role: string };
}> {
  const response = await fetch(`${baseUrl(app)}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      email: `${username}@test.com`,
      password: 'password123',
    }),
  });

  const data = await response.json();
  if (response.status !== 200) {
    throw new Error(`Registration failed with ${response.status}: ${JSON.stringify(data)}`);
  }

  return data as {
    accessToken: string;
    user: { userId: string; role: string };
  };
}

function bearer(token: string): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
  };
}

function baseUrl(app: AnyElysia): string {
  return `http://localhost:${app.server!.port}`;
}
