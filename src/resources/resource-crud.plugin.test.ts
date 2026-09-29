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
import { Elysia } from 'elysia';

import { createApp } from '../frontend/server/app-factory';
import type { TokenService } from '../auth/token-service';
import type { UserStore } from '../auth/user-store';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import {
  adminOnly,
  anyOf,
  authorizationPolicy,
  authenticatedOnly,
  createResourceCrudPlugin,
  customPolicy,
  defineResource,
  metadataPolicy,
  ownerPolicy,
  readOnly,
  RESOURCE_DEFAULT_RECEIPT_MAX_KEYS,
  ResourceRegistry,
  tenantRealm,
} from './index';
import { RESOURCE_QUERY_LIMITS } from './resource-query';

interface TestAppRuntime {
  app: Awaited<ReturnType<typeof createApp>>;
  db: ReactiveDB;
  authStore: UserStore;
  rootDir: string;
  baseUrl: string;
  stop(): Promise<void>;
}

interface ResourceServiceProbe {
  path: string;
  read(): Pick<TestAppRuntime, 'db' | 'authStore'> | null;
}

let runtimes: TestAppRuntime[] = [];

afterEach(async () => {
  for (const runtime of runtimes.reverse()) {
    await runtime.stop();
  }
  runtimes = [];
});

describe('generated resource CRUD routes', () => {
  test('bounds list query input behind a stable non-reflective error', async () => {
    const runtime = await startResourceApp();
    const marker = 'private-filter-value-';
    const filter = `${marker}${'x'.repeat(RESOURCE_QUERY_LIMITS.filterExpressionLength)}`;
    const response = await requestJson(
      runtime,
      'GET',
      `/api/resources/tickets?filter=${filter}`,
    );

    expect(response).toEqual({
      status: 400,
      data: {
        error: 'Invalid resource query',
        code: 'invalid-resource-query',
      },
    });
    expect(JSON.stringify(response.data)).not.toContain(marker);
  });

  test('enforces owner policies, stamps create input, and allows admin delete', async () => {
    const runtime = await startResourceApp();
    const admin = await register(runtime, 'admin', 'admin@test.com');
    const user = await register(runtime, 'user', 'user@test.com');

    runtime.db.insert('tickets', {
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

    const createCollision = await requestJson(
      runtime,
      'POST',
      '/api/resources/tickets',
      {
        ticket_id: 'admin-ticket',
        title: 'Create must not replace',
        owner_id: user.user.userId,
        status: 'open',
      },
      user.accessToken,
    );
    expect(createCollision.status).toBe(409);
    expect(createCollision.data.code).toBe('resource-conflict');
    expect(runtime.db.get('tickets', 'admin-ticket')).toMatchObject({
      title: 'Admin Ticket',
      owner_id: admin.user.userId,
    });

    runtime.db.exec(`
      CREATE TRIGGER tickets_private_failure
      BEFORE INSERT ON tickets
      WHEN NEW.ticket_id = 'private-failure'
      BEGIN
        SELECT RAISE(ABORT, 'private_rule /srv/customer.sqlite secret-column');
      END
    `);
    const privateFailure = await requestJson(
      runtime,
      'POST',
      '/api/resources/tickets',
      {
        ticket_id: 'private-failure',
        title: 'Must not commit',
        owner_id: user.user.userId,
        status: 'open',
      },
      user.accessToken,
    );
    expect(privateFailure).toEqual({
      status: 500,
      data: {
        error: 'Resource mutation failed',
        code: 'resource-mutation-failed',
      },
    });

    const statementCleanup = observeNextPreparedStatementFinalization(runtime.db);
    const userList = await requestJson(
      runtime,
      'GET',
      '/api/resources/tickets?order=ticket_id&dir=asc',
      undefined,
      user.accessToken
    ).finally(statementCleanup.restore);
    expect(userList.status).toBe(200);
    expect(userList.data.rows.map((row: any) => row.ticket_id)).toEqual(['user-ticket']);
    expect(statementCleanup.finalized()).toBe(true);

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

    runtime.authStore.setProperty(sales.user.userId, 'department', 'sales');
    runtime.db.insert('reports', {
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

  test('applies live application RBAC directly to managed resource routes', async () => {
    const runtime = await startResourceApp({
      auth: {
        bootstrap: 'public',
        tenancy: 'single',
        authorization: {
          mode: 'advanced',
          permissions: {
            'tickets:read': { label: 'Read tickets' },
          },
          roles: {
            reader: { permissions: ['tickets:read'] },
          },
        },
      },
      resources: [defineResource({
        table: 'tickets',
        actions: ['list', 'get'],
        policy: authorizationPolicy({ permission: 'tickets:read' }),
      })],
    });
    const owner = await register(runtime, 'rbac-owner', 'rbac-owner@test.com');
    const reader = await register(runtime, 'rbac-reader', 'rbac-reader@test.com');
    runtime.db.insert('tickets', {
      ticket_id: 'rbac-ticket',
      title: 'RBAC Ticket',
      owner_id: owner.user.userId,
      status: 'open',
    });

    const denied = await requestJson(
      runtime,
      'GET',
      '/api/resources/tickets/rbac-ticket',
      undefined,
      reader.accessToken,
    );
    expect(denied.status).toBe(403);
    expect(denied.data.code).toBe('authorization-denied');

    const granted = await requestJson(
      runtime,
      'PATCH',
      `/auth/application/users/${reader.user.userId}/roles`,
      { roles: ['reader'], expectedRevision: 'application:application:0' },
      owner.accessToken,
    );
    expect(granted.status).toBe(200);
    expect(granted.data.user.roles).toEqual(['reader']);

    const allowed = await requestJson(
      runtime,
      'GET',
      '/api/resources/tickets/rbac-ticket',
      undefined,
      reader.accessToken,
    );
    expect(allowed.status).toBe(200);
    expect(allowed.data.row.ticket_id).toBe('rbac-ticket');
  });

  test('fails closed when live authority changes during asynchronous policy work', async () => {
    let enterPolicy!: () => void;
    let releasePolicy!: () => void;
    const entered = new Promise<void>((resolve) => { enterPolicy = resolve; });
    const released = new Promise<void>((resolve) => { releasePolicy = resolve; });
    const delayed = customPolicy(async ({ action }) => {
      if (action === 'update') {
        enterPolicy();
        await released;
      }
      return true;
    }, { name: 'authority-revalidation-race' });
    const runtime = await startResourceApp({
      resources: [defineResource({ table: 'tickets', policy: delayed })],
    });
    const actor = await register(runtime, 'race-user', 'race-user@test.com');
    runtime.db.insert('tickets', {
      ticket_id: 'race-ticket',
      title: 'Original',
      owner_id: actor.user.userId,
      status: 'open',
    });

    const pending = requestJson(
      runtime,
      'PATCH',
      '/api/resources/tickets/race-ticket',
      { title: 'Must not commit' },
      actor.accessToken,
    );
    await entered;
    runtime.authStore.updateUser(actor.user.userId, { status: 'suspended' });
    releasePolicy();

    const response = await pending;
    expect(response.status).toBe(403);
    expect(response.data.code).toBe('resource-authority-changed');
    expect(runtime.db.get('tickets', 'race-ticket')?.title).toBe('Original');
  });

  test('fails closed in multi mode when a verifier lacks durable commit authority', async () => {
    const tenantTables = {
      tenant_docs: {
        id: 'text primary key',
        tenant_id: 'text not null',
        title: 'text not null',
      },
    };
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('tenant_docs', tenantTables.tenant_docs);
    db.insert('tenant_docs', {
      id: 'protected',
      tenant_id: 'tenant-a',
      title: 'Must not be returned',
    });
    const registry = new ResourceRegistry();
    registry.register(defineResource({
      table: 'tenant_docs',
      exposure: 'http',
      realm: tenantRealm(),
      policy: authenticatedOnly(),
    }), {
      tables: tenantTables,
      authConfig: { userProperties: {} },
      tenancyMode: 'multi',
      managedTables: ['tenant_docs'],
    });
    const tokenService = {
      async resolveAuthContext(token: string) {
        if (token !== 'legacy-multi-token') return null;
        return {
          userId: 'shared-user',
          email: 'shared@example.test',
          role: 'admin',
          sessionKind: 'web' as const,
          sessionId: 'session-without-durable-resolver',
          sessionGeneration: 0,
          sessionScopeKind: 'tenant' as const,
          sessionScopeId: 'tenant-a',
          tenantId: 'tenant-a',
          membershipId: 'membership-a',
          tenantRole: 'owner',
          tenantAuthorizationGeneration: 1,
          membershipAuthorizationGeneration: 2,
        };
      },
    } as unknown as TokenService;
    const isolated = new Elysia().use(createResourceCrudPlugin({
      registry,
      tables: tenantTables,
      authConfig: { userProperties: {} },
      tenancyMode: 'multi',
      getTokenService: () => tokenService,
      getDB: () => db,
    }));

    try {
      const response = await isolated.handle(new Request(
        'http://zero.test/api/resources/tenant_docs',
        { headers: { authorization: 'Bearer legacy-multi-token' } },
      ));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: 'Resource authorization changed during the request',
        code: 'resource-authority-changed',
      });
    } finally {
      db.dispose();
    }
  });

  test('returns a stable safe idempotency token for every mutation request', async () => {
    const runtime = await startResourceApp();
    const user = await register(runtime, 'idempotency-user', 'idempotency@test.com');

    const supplied = await fetch(`${runtime.baseUrl}/api/resources/tickets`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${user.accessToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'client-request:one',
      },
      body: JSON.stringify({
        ticket_id: 'idempotency-one',
        title: 'Supplied key',
        status: 'open',
      }),
    });
    expect(supplied.status).toBe(201);
    expect(supplied.headers.get('Idempotency-Key')).toBe('client-request:one');

    const unsafe = await fetch(`${runtime.baseUrl}/api/resources/tickets`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${user.accessToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'client key/with unsafe characters',
      },
      body: JSON.stringify({
        ticket_id: 'idempotency-two',
        title: 'Hashed key',
        status: 'open',
      }),
    });
    expect(unsafe.status).toBe(201);
    expect(unsafe.headers.get('Idempotency-Key')).toMatch(/^h_[a-f0-9]{64}$/);

    const generated = await fetch(`${runtime.baseUrl}/api/resources/tickets`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${user.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ticket_id: 'idempotency-three',
        title: 'Generated key',
        status: 'open',
      }),
    });
    expect(generated.status).toBe(201);
    expect(generated.headers.get('Idempotency-Key')).toMatch(/^r_[0-9a-f-]{36}$/);
  });

  test('replays the canonical default-database result for the same HTTP key', async () => {
    const runtime = await startResourceApp();
    const user = await register(runtime, 'receipt-user', 'receipt-user@test.com');
    const body = {
      ticket_id: 'receipt-ticket',
      title: 'Canonical response',
      status: 'open',
    };
    const headers = {
      Authorization: `Bearer ${user.accessToken}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'default-http-replay',
    };

    const first = await fetch(`${runtime.baseUrl}/api/resources/tickets`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ row: body });

    runtime.db.update('tickets', 'receipt-ticket', { title: 'Later database state' });
    const replay = await fetch(`${runtime.baseUrl}/api/resources/tickets`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    expect(replay.status).toBe(201);
    expect(replay.headers.get('Idempotency-Key')).toBe('default-http-replay');
    expect(await replay.json()).toMatchObject({ row: body });
    expect(runtime.db.get('tickets', 'receipt-ticket')).toMatchObject({
      title: 'Later database state',
    });

    const conflict = await fetch(`${runtime.baseUrl}/api/resources/tickets`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...body, title: 'Different logical work' }),
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      error: 'Idempotency-Key was already used for a different resource mutation',
      code: 'resource-idempotency-key-reused',
    });
  });

  test('returns the stable non-retryable receipt-capacity contract', async () => {
    const runtime = await startResourceApp();
    const user = await register(runtime, 'capacity-user', 'capacity-user@test.com');
    const headers = {
      Authorization: `Bearer ${user.accessToken}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'capacity-primer',
    };
    const primer = await fetch(`${runtime.baseUrl}/api/resources/tickets`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ticket_id: 'capacity-primer',
        title: 'Initialize receipt storage',
        status: 'open',
      }),
    });
    expect(primer.status).toBe(201);
    runtime.db.prepare(`
      UPDATE _zero_resource_receipt_stats_v1
      SET total_keys = ?
    `).run(RESOURCE_DEFAULT_RECEIPT_MAX_KEYS);

    const rejected = await fetch(`${runtime.baseUrl}/api/resources/tickets`, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': 'capacity-rejected' },
      body: JSON.stringify({
        ticket_id: 'capacity-rejected',
        title: 'Must not commit',
        status: 'open',
      }),
    });
    expect(rejected.status).toBe(503);
    expect(await rejected.json()).toEqual({
      error: 'Resource idempotency receipt capacity is exhausted',
      code: 'resource-idempotency-capacity-exhausted',
      retryable: false,
    });
    expect(runtime.db.get('tickets', 'capacity-rejected')).toBeNull();
  });

  test('can disable generated routes while keeping resource registration', async () => {
    const runtime = await startResourceApp({
      resourceRoutes: false,
      resources: [
        defineResource({
          table: 'tickets',
          exposure: 'http',
          policy: readOnly(),
        }),
        defineResource({
          table: 'reports',
          exposure: 'internal',
          policy: readOnly(),
        }),
      ],
    });
    const response = await requestJson(runtime, 'GET', '/api/resources/tickets');

    expect(response.status).toBe(404);
    const data = await requestJson(runtime, 'GET', '/api/data?table=tickets');
    expect(data.status).toBe(200);
    expect(data.data.rows).toEqual([]);
  });

  test('conceals resources that do not allow HTTP exposure', async () => {
    const tables = {
      internal_docs: { id: 'text primary key', title: 'text not null' },
      sync_docs: { id: 'text primary key', title: 'text not null' },
    };
    const db = createReactiveDB({ mode: 'memory' });
    for (const [name, schema] of Object.entries(tables)) db.defineTable(name, schema);
    const registry = new ResourceRegistry();
    registry.register([
      defineResource({
        table: 'internal_docs',
        exposure: 'internal',
        policy: readOnly(),
      }),
      defineResource({
        table: 'sync_docs',
        exposure: 'sync',
        policy: readOnly(),
      }),
    ], { tables, authConfig: { userProperties: {} } });
    const isolated = new Elysia().use(createResourceCrudPlugin({
      registry,
      tables,
      authConfig: { userProperties: {} },
      getDB: () => db,
    }));

    try {
      for (const resource of ['internal_docs', 'sync_docs']) {
        const response = await isolated.handle(new Request(
          `http://zero.test/api/resources/${resource}`,
        ));
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({
          error: `Unknown resource: ${resource}`,
          code: 'resource-http-not-exposed',
        });
      }
    } finally {
      db.dispose();
    }
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
      bootstrap: 'public',
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
  const serviceProbe = installResourceServiceProbe(app);
  app.listen(0);
  const baseUrl = `http://localhost:${app.server!.port}`;
  const services = await waitForResourceServices(baseUrl, serviceProbe);

  const runtime = {
    app,
    ...services,
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

function installResourceServiceProbe(
  testApp: Awaited<ReturnType<typeof createApp>>,
): ResourceServiceProbe {
  const path = `/__zero_test/resource-services-${crypto.randomUUID()}`;
  let captured: Pick<TestAppRuntime, 'db' | 'authStore'> | null = null;

  testApp.get(path, (context) => {
    const scoped = context as unknown as {
      syncDB?: ReactiveDB;
      authStore?: UserStore | null;
    };
    if (scoped.syncDB && scoped.authStore) {
      captured = { db: scoped.syncDB, authStore: scoped.authStore };
    }
    return { ready: captured !== null };
  });

  return { path, read: () => captured };
}

async function waitForResourceServices(
  baseUrl: string,
  probe: ResourceServiceProbe,
): Promise<Pick<TestAppRuntime, 'db' | 'authStore'>> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await fetch(`${baseUrl}${probe.path}`);
    await response.arrayBuffer();
    const captured = probe.read();
    if (captured) return captured;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Resource app services did not start');
}

function observeNextPreparedStatementFinalization(db: ReactiveDB): Readonly<{
  finalized(): boolean;
  restore(): void;
}> {
  const originalPrepare = db.prepare;
  const prepare = originalPrepare.bind(db);
  let finalized = false;
  let restored = false;
  db.prepare = ((sql: string) => {
    const statement = prepare(sql);
    return new Proxy(statement, {
      get(target, property) {
        if (property === 'finalize') {
          return () => {
            finalized = true;
            return target.finalize();
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }) as ReactiveDB['prepare'];
  return Object.freeze({
    finalized: () => finalized,
    restore: () => {
      if (restored) return;
      restored = true;
      db.prepare = originalPrepare;
    },
  });
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
