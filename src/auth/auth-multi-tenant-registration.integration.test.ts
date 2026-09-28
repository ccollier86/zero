import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia, type AnyElysia } from 'elysia';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { AuthRuntime } from './auth-runtime';
import { createAuthPlugin } from './auth.plugin';

interface ActiveHarness {
  app: AnyElysia;
  db: ReactiveDB;
  runtime: AuthRuntime;
  url: string;
}

let active: ActiveHarness | null = null;

afterEach(async () => {
  if (!active) return;
  await active.app.stop();
  active.db.dispose();
  active = null;
});

async function start(): Promise<ActiveHarness> {
  const db = createReactiveDB({ mode: 'memory' });
  let runtime: AuthRuntime | null = null;
  const app = new Elysia().use(createAuthPlugin({
    db,
    tenancy: 'multi',
    bootstrap: 'public',
    registration: { mode: 'public' },
    onRuntimeCreated(created) {
      runtime = created;
    },
  }));
  app.listen(0);
  if (!runtime) throw new Error('Auth runtime was not created');
  const harness: ActiveHarness = {
    app,
    db,
    runtime,
    url: `http://localhost:${app.server!.port}`,
  };
  active = harness;
  return harness;
}

async function request(
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, any> }> {
  const response = await fetch(`${active!.url}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, any>,
  };
}

function registration(index: number, organizationName?: string) {
  return {
    username: `multi-${index}`,
    email: `multi-${index}@example.test`,
    password: 'password123',
    ...(organizationName ? { organizationName } : {}),
  };
}

describe('multi-tenant registration bootstrap', () => {
  test('advertises multi mode and requires an initial organization', async () => {
    await start();

    const config = await request('/auth/config');
    expect(config.status).toBe(200);
    expect(config.body.tenancy).toEqual({
      mode: 'multi',
      terminology: { singular: 'organization', plural: 'organizations' },
      creation: { mode: 'authenticated' },
      onboarding: {
        invitations: {
          enabled: true,
          accountCreation: true,
          delivery: { default: 'manual', email: false, manual: true },
        },
        joinRequests: { enabled: true },
      },
    });

    const rejected = await request('/auth/register', registration(0));
    expect(rejected.status).toBe(422);
    expect(rejected.body.code).toBe('TENANT_NAME_REQUIRED');
    expect(active!.runtime.getStore()!.countUsers()).toBe(0);
    expect(active!.runtime.getStore()!.isBootstrapRequired()).toBe(true);
  });

  test('atomically creates the bootstrap admin, tenant, owner, and completion marker', async () => {
    await start();

    const created = await request(
      '/auth/register',
      registration(0, '  Acme   Health  '),
    );

    expect(created.status).toBe(200);
    expect(created.body.user.role).toBe('admin');
    expect(created.body.tenant).toMatchObject({
      name: 'Acme Health',
      slug: 'acme-health',
      role: 'owner',
    });
    expect(created.body.tenant.tenantId).toStartWith('ten_');
    expect(created.body.tenant.membershipId).toStartWith('tmem_');

    const tenancy = active!.runtime.getTenancyService()!;
    const stored = tenancy.getTenantBySlug('acme-health');
    expect(stored?.tenantId).toBe(created.body.tenant.tenantId);
    expect(tenancy.getMembership(stored!.tenantId, created.body.user.userId))
      .toMatchObject({ roleKey: 'owner', status: 'active' });
    await expect(
      active!.runtime.getTokenService()!.resolveAuthContext(created.body.accessToken),
    ).resolves.toMatchObject({
      tenantId: created.body.tenant.tenantId,
      membershipId: created.body.tenant.membershipId,
      sessionKind: 'web',
      sessionScopeKind: 'tenant',
    });
    expect(active!.runtime.getStore()!.getConfig('auth.bootstrap.completed')).toBe('1');
  });

  test('derives an opaque slug for non-Latin names but rejects an explicit invalid slug', async () => {
    const { runtime } = await start();
    const created = await request('/auth/register', registration(0, '東京クリニック'));

    expect(created.status).toBe(200);
    expect(created.body.tenant.name).toBe('東京クリニック');
    expect(created.body.tenant.slug).toMatch(/^org-[a-f0-9]{16}$/);

    const rejected = await request('/auth/register', {
      ...registration(1, '有効な名前'),
      organizationSlug: '---',
    });
    expect(rejected.status).toBe(422);
    expect(rejected.body.code).toBe('AUTH_VALIDATION_FAILED');
    expect(runtime.getStore()!.getUserByEmail('multi-1@example.test')).toBeNull();
  });

  test('rolls back the user and bootstrap marker when organization creation fails', async () => {
    const { db, runtime } = await start();
    db.exec(`
      CREATE TRIGGER reject_bootstrap_tenant
      BEFORE INSERT ON _auth_tenants
      BEGIN
        SELECT RAISE(ABORT, 'injected tenant failure');
      END
    `);

    const failed = await request('/auth/register', registration(0, 'Rollback Health'));
    expect(failed.status).toBe(500);
    expect(failed.body.code).toBe('AUTH_INTERNAL_ERROR');
    expect(runtime.getStore()!.countUsers()).toBe(0);
    expect(runtime.getStore()!.isBootstrapRequired()).toBe(true);
    expect(runtime.getTenancyService()!.getTenantBySlug('rollback-health')).toBeNull();

    db.exec('DROP TRIGGER reject_bootstrap_tenant');
    const retried = await request('/auth/register', registration(1, 'Rollback Health'));
    expect(retried.status).toBe(200);
    expect(retried.body.user.role).toBe('admin');
    expect(runtime.getStore()!.countUsers()).toBe(1);
    expect(runtime.getStore()!.isBootstrapRequired()).toBe(false);
  });

  test('rolls back an ordinary user when its organization slug is already owned', async () => {
    const { runtime } = await start();
    const first = await request('/auth/register', registration(0, 'Duplicate Practice'));
    expect(first.status).toBe(200);

    const duplicate = await request('/auth/register', registration(1, 'Duplicate Practice'));
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('TENANT_SLUG_TAKEN');
    expect(runtime.getStore()!.countUsers()).toBe(1);
    expect(runtime.getStore()!.getUserByEmail('multi-1@example.test')).toBeNull();
  });
});
