/**
 * resource-crud.plugin.test.ts
 *
 * Verifies generated resource CRUD routes through createApp integration. This
 * test owns route/policy wiring behavior only; policy primitives and registry
 * validation are covered by dedicated resource tests.
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';

import { createApp } from '../frontend/server/app-factory';
import { getAuthStore } from '../auth/auth.plugin';
import { getSyncDB } from '../sync';
import {
  adminOnly,
  anyOf,
  defineResource,
  metadataPolicy,
  ownerPolicy,
} from './index';

interface TestAppRuntime {
  app: Awaited<ReturnType<typeof createApp>>;
  rootDir: string;
  baseUrl: string;
  stop(): Promise<void>;
}

let runtimes: TestAppRuntime[] = [];

afterEach(async () => {
  for (const runtime of runtimes.reverse()) {
    await runtime.stop();
  }
  runtimes = [];
});

describe('generated resource CRUD routes', () => {
  test('enforces owner policies, stamps create input, and allows admin delete', async () => {
    const runtime = await startResourceApp();
    const admin = await register(runtime, 'admin', 'admin@test.com');
    const user = await register(runtime, 'user', 'user@test.com');

    const db = getSyncDB();
    expect(db).toBeTruthy();
    db!.insert('tickets', {
      ticket_id: 'admin-ticket',
      title: 'Admin Ticket',
      owner_id: admin.user.userId,
      status: 'open',
    });

    const created = await requestJson(
      runtime,
      'POST',
      '/api/resources/tickets',
      {
        ticket_id: 'user-ticket',
        title: 'User Ticket',
        owner_id: 'malicious-owner',
        status: 'open',
      },
      user.accessToken
    );
    expect(created.status).toBe(201);
    expect(created.data.row.owner_id).toBe(user.user.userId);

    const userList = await requestJson(
      runtime,
      'GET',
      '/api/resources/tickets?order=ticket_id&dir=asc',
      undefined,
      user.accessToken
    );
    expect(userList.status).toBe(200);
    expect(userList.data.rows.map((row: any) => row.ticket_id)).toEqual(['user-ticket']);

    const adminList = await requestJson(
      runtime,
      'GET',
      '/api/resources/tickets?order=ticket_id&dir=asc',
      undefined,
      admin.accessToken
    );
    expect(adminList.status).toBe(200);
    expect(adminList.data.rows.map((row: any) => row.ticket_id)).toEqual([
      'admin-ticket',
      'user-ticket',
    ]);

    const updated = await requestJson(
      runtime,
      'PATCH',
      '/api/resources/tickets/user-ticket',
      { ticket_id: 'changed', title: 'Updated Ticket' },
      user.accessToken
    );
    expect(updated.status).toBe(200);
    expect(updated.data.row.ticket_id).toBe('user-ticket');
    expect(updated.data.row.title).toBe('Updated Ticket');

    const deniedDelete = await requestJson(
      runtime,
      'DELETE',
      '/api/resources/tickets/user-ticket',
      undefined,
      user.accessToken
    );
    expect(deniedDelete.status).toBe(403);

    const deleted = await requestJson(
      runtime,
      'DELETE',
      '/api/resources/tickets/user-ticket',
      undefined,
      admin.accessToken
    );
    expect(deleted.status).toBe(200);
    expect(deleted.data.deleted).toBe(true);
  });

  test('hydrates trusted metadata properties for metadataPolicy decisions', async () => {
    const runtime = await startResourceApp();
    const support = await register(runtime, 'support', 'support@test.com');
    const sales = await register(runtime, 'sales', 'sales@test.com');

    getAuthStore()?.setProperty(sales.user.userId, 'department', 'sales');
    getSyncDB()!.insert('reports', {
      report_id: 'r1',
      title: 'Support Report',
      department: 'support',
    });

    const allowed = await requestJson(
      runtime,
      'GET',
      '/api/resources/reports/r1',
      undefined,
      support.accessToken
    );
    expect(allowed.status).toBe(200);
    expect(allowed.data.row.report_id).toBe('r1');

    const denied = await requestJson(
      runtime,
      'GET',
      '/api/resources/reports/r1',
      undefined,
      sales.accessToken
    );
    expect(denied.status).toBe(403);
    expect(denied.data.code).toBe('metadata-property');
  });

  test('can disable generated routes while keeping resource registration', async () => {
    const runtime = await startResourceApp({ resourceRoutes: false });
    const response = await requestJson(runtime, 'GET', '/api/resources/tickets');

    expect(response.status).toBe(404);
  });
});

async function startResourceApp(
  overrides: Partial<Parameters<typeof createApp>[0]> = {}
): Promise<TestAppRuntime> {
  const tempBase = join(process.cwd(), '.zero');
  await mkdir(tempBase, { recursive: true });
  const rootDir = await mkdtemp(join(tempBase, 'test-resource-crud-'));
  const appDir = join(rootDir, 'app');
  await mkdir(appDir, { recursive: true });

  const app = await createApp({
    db: { mode: 'memory' },
    auth: {
      userProperties: {
        department: {
          type: 'enum',
          values: ['support', 'sales'],
          default: 'support',
          editableBy: 'admin',
          useInPolicies: true,
        },
      },
    },
    tables: {
      tickets: {
        ticket_id: 'text primary key',
        title: 'text not null',
        owner_id: 'text not null',
        status: "text not null default 'open'",
      },
      reports: {
        report_id: 'text primary key',
        title: 'text not null',
        department: 'text not null',
      },
    },
    resources: [
      defineResource({
        table: 'tickets',
        policy: {
          list: anyOf(adminOnly(), ownerPolicy({ userField: 'owner_id' })),
          get: anyOf(ownerPolicy({ userField: 'owner_id' }), adminOnly()),
          create: ownerPolicy({ userField: 'owner_id' }),
          update: ownerPolicy({ userField: 'owner_id' }),
          delete: adminOnly(),
        },
      }),
      defineResource({
        table: 'reports',
        policy: {
          list: metadataPolicy({ department: 'support' }),
          get: metadataPolicy({ department: 'support' }),
          create: adminOnly(),
          update: adminOnly(),
          delete: adminOnly(),
        },
      }),
    ],
    appDir,
    outDir: join(rootDir, 'out'),
    serverResourcesDir: false,
    serverPluginsDir: false,
    serverMiddlewareDir: false,
    serverEndpointsDir: false,
    serverRoutesDir: false,
    observability: false,
    ...overrides,
  });

  app.listen(0);
  const baseUrl = `http://localhost:${app.server!.port}`;

  const runtime = {
    app,
    rootDir,
    baseUrl,
    async stop() {
      await app.stop();
      await rm(rootDir, { recursive: true, force: true });
    },
  };
  runtimes.push(runtime);
  return runtime;
}

async function register(
  runtime: TestAppRuntime,
  username: string,
  email: string
): Promise<any> {
  const response = await requestJson(runtime, 'POST', '/auth/register', {
    username,
    email,
    password: 'password123',
  });

  expect(response.status).toBe(200);
  return response.data;
}

async function requestJson(
  runtime: TestAppRuntime,
  method: string,
  path: string,
  body?: object,
  token?: string
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${runtime.baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return {
    status: response.status,
    data: await response.json().catch(() => null),
  };
}
