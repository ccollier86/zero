/**
 * server-extensions.test.ts
 *
 * Verifies Zero-native backend extensions through Elysia's request lifecycle.
 * Pure matcher and policy behavior lives in dedicated tests; this file proves
 * middleware policy wiring, auth integration, and app-owned scoping.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia, t, type AnyElysia } from 'elysia';

import { createAuthPlugin, getAuthStore } from '../../auth/auth.plugin';
import { OBS_CODES } from '../../observability/codes';
import { MemoryEventStore } from '../../observability/memory-event-store';
import { createObservabilityPlugin } from '../../observability/plugin';
import type { ReactiveDB } from '../../sync';
import { createSyncPlugin } from '../../sync';
import {
  ZERO_REQUEST_PARSE_FAILED,
  ZERO_REQUEST_VALIDATION_FAILED,
  ZERO_RESPONSE_VALIDATION_FAILED,
} from './server-extension-error-handler';
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
  test('sanitizes validation and parse failures without reflecting request values', async () => {
    const events = new MemoryEventStore();
    const observability = {
      sink: events,
      store: events,
      config: { console: false },
    };
    const extensions = await createServerExtensionApp({
      extensions: [defineEndpoint({
        method: 'POST',
        path: '/api/private-values',
        body: t.Object({
          operationId: t.String({ minLength: 1 }),
          values: t.Record(t.String(), t.Unknown()),
        }),
        handler: () => ({ ok: true }),
      }), defineEndpoint({
        method: 'GET',
        path: '/api/invalid-server-response',
        response: t.Object({ ok: t.Boolean() }),
        handler: () => ({ privateResult: 'must-not-leak-from-response-validation' }),
      })],
    });
    const app = new Elysia()
      .use(createObservabilityPlugin({ runtime: observability, config: { endpoint: false } }))
      .use(extensions as AnyElysia)
      .listen(0) as AnyElysia;
    policyApps.push(app);

    const validationSecret = 'must-never-be-reflected-or-logged';
    const invalid = await fetch(`${baseUrl(app)}/api/private-values`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationId: 42,
        values: { clinicalNote: validationSecret },
      }),
    });
    const invalidText = await invalid.text();

    expect(invalid.status).toBe(422);
    expect(JSON.parse(invalidText)).toEqual({
      error: 'Invalid request.',
      code: ZERO_REQUEST_VALIDATION_FAILED,
    });
    expect(invalidText).not.toContain(validationSecret);
    expect(invalidText).not.toContain('found');
    expect(invalidText).not.toContain('schema');
    expect(invalidText).not.toContain('expected');

    const rejected = events.query({
      code: OBS_CODES.APP_REQUEST_VALIDATION_REJECTED.code,
    });
    expect(rejected.count).toBe(1);
    expect(rejected.events[0]?.error).toBeUndefined();
    expect(JSON.stringify(rejected.events[0])).not.toContain(validationSecret);

    const malformedSecret = 'also-must-never-be-reflected-or-logged';
    const malformed = await fetch(`${baseUrl(app)}/api/private-values`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: `{"operationId":"op", "values":{"secret":"${malformedSecret}"}`,
    });
    const malformedText = await malformed.text();

    expect(malformed.status).toBe(400);
    expect(JSON.parse(malformedText)).toEqual({
      error: 'Invalid request body.',
      code: ZERO_REQUEST_PARSE_FAILED,
    });
    expect(malformedText).not.toContain(malformedSecret);
    expect(events.query({ code: OBS_CODES.APP_REQUEST_PARSE_REJECTED.code }).count).toBe(1);
    expect(JSON.stringify(events.query({ code: OBS_CODES.APP_REQUEST_PARSE_REJECTED.code })))
      .not.toContain(malformedSecret);

    const invalidResponse = await fetch(`${baseUrl(app)}/api/invalid-server-response`);
    const invalidResponseText = await invalidResponse.text();
    expect(invalidResponse.status).toBe(500);
    expect(JSON.parse(invalidResponseText)).toEqual({
      error: 'Invalid server response.',
      code: ZERO_RESPONSE_VALIDATION_FAILED,
    });
    expect(invalidResponseText).not.toContain('must-not-leak-from-response-validation');
    const responseFailures = events.query({
      code: OBS_CODES.APP_RESPONSE_VALIDATION_FAILED.code,
    });
    expect(responseFailures.count).toBe(1);
    expect(responseFailures.events[0]?.error).toBeUndefined();
    expect(JSON.stringify(responseFailures)).not.toContain(
      'must-not-leak-from-response-validation',
    );
  });

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
    await expect(response.json()).resolves.toEqual({
      error: 'Authentication service unavailable',
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
