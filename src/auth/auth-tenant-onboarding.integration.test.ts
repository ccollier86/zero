import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia, type AnyElysia } from 'elysia';
import { configureEmail, MemoryEmailProvider } from '../email';
import { resetEmailCompatibilityRuntimeForTesting } from '../email/runtime';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { AuthRuntime } from './auth-runtime';
import { createAuthPlugin } from './auth.plugin';
import type { AuthTenantCreationMode } from './types';

interface Harness {
  app: AnyElysia;
  db: ReactiveDB;
  runtime: AuthRuntime;
  url: string;
}

interface JsonResult {
  status: number;
  body: Record<string, any>;
  headers: Headers;
}

const active: Harness[] = [];

afterEach(async () => {
  for (const harness of active.splice(0).reverse()) {
    await harness.app.stop();
    harness.db.dispose();
  }
  resetEmailCompatibilityRuntimeForTesting();
});

async function start(
  creation: AuthTenantCreationMode = 'authenticated',
  requireEmailVerification = false,
): Promise<Harness> {
  const db = createReactiveDB({ mode: 'memory' });
  let runtime: AuthRuntime | null = null;
  const app = new Elysia().use(createAuthPlugin({
    db,
    bootstrap: 'public',
    registration: { mode: 'public' },
    ...(requireEmailVerification
      ? { account: { requireEmailVerification: true } }
      : {}),
    tenancy: {
      mode: 'multi',
      terminology: { singular: 'workspace', plural: 'workspaces' },
      creation: { mode: creation },
    },
    onRuntimeCreated(value) {
      runtime = value;
    },
  }));
  app.listen(0);
  const created = runtime as AuthRuntime | null;
  if (!created) throw new Error('Auth runtime was not created');
  const harness = {
    app,
    db,
    runtime: created,
    url: `http://localhost:${app.server!.port}`,
  };
  active.push(harness);
  const deadline = Date.now() + 2_000;
  while (!created.getStore() || !created.getTokenService()) {
    if (Date.now() > deadline) throw new Error('Auth runtime startup timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return harness;
}

async function post(
  harness: Harness,
  path: string,
  body: Record<string, unknown>,
): Promise<JsonResult> {
  const response = await fetch(`${harness.url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, any>,
    headers: response.headers,
  };
}

async function get(harness: Harness, path: string): Promise<JsonResult> {
  const response = await fetch(`${harness.url}${path}`);
  return {
    status: response.status,
    body: await response.json() as Record<string, any>,
    headers: response.headers,
  };
}

function registration(key: string, organizationName?: string) {
  return {
    username: key,
    email: `${key}@example.test`,
    password: 'password123',
    ...(organizationName ? { organizationName } : {}),
  };
}

async function bootstrap(harness: Harness, key = 'bootstrap') {
  const result = await post(
    harness,
    '/auth/register',
    registration(key, `${key} workspace`),
  );
  expect(result.status).toBe(200);
  return result;
}

function continuation(result: JsonResult): string {
  const value = result.body.onboarding?.tenantCreation?.continuation;
  if (typeof value !== 'string') throw new Error('Expected onboarding continuation');
  return value;
}

function tenantCount(db: ReactiveDB): number {
  return (db.prepare('SELECT COUNT(*) AS count FROM _auth_tenants')
    .get() as { count: number }).count;
}

function activeSessionCount(db: ReactiveDB): number {
  return (db.prepare(`
    SELECT COUNT(*) AS count FROM _auth_sessions WHERE status = 'active'
  `).get() as { count: number }).count;
}

describe('multi-tenant onboarding and creation', () => {
  test('separates identity registration and atomically consumes a hashed onboarding proof', async () => {
    const harness = await start();
    await bootstrap(harness);

    const config = await get(harness, '/auth/config');
    expect(config.body.tenancy).toEqual({
      mode: 'multi',
      terminology: { singular: 'workspace', plural: 'workspaces' },
      creation: { mode: 'authenticated' },
      onboarding: {
        invitations: {
          enabled: true,
          accountCreation: true,
          delivery: { default: 'manual', manual: true, email: false },
        },
        joinRequests: { enabled: true },
      },
    });

    const registered = await post(harness, '/auth/register', registration('identity-only'));
    expect(registered.status).toBe(200);
    expect(registered.body).toMatchObject({
      tenantOnboardingRequired: true,
      onboarding: {
        reason: 'no_active_tenant_membership',
        tenantCreation: { allowed: true },
      },
    });
    expect(registered.body.accessToken).toBeUndefined();
    expect(registered.body.refreshToken).toBeUndefined();
    expect(registered.body.tenant).toBeUndefined();
    expect(harness.runtime.getTenancyService()!
      .listActiveMembershipsForUser(registered.body.user.userId)).toEqual([]);

    const raw = continuation(registered);
    const persisted = harness.db.prepare(`
      SELECT token_hash, purpose, application_id
      FROM _auth_session_continuations
      WHERE purpose = 'tenant_onboarding'
    `).get() as Record<string, unknown>;
    expect(persisted.purpose).toBe('tenant_onboarding');
    expect(persisted.token_hash).not.toBe(raw);
    expect(String(persisted.token_hash)).not.toContain(raw);

    const created = await post(harness, '/auth/tenants/create', {
      continuation: raw,
      name: 'Identity Workspace',
    });
    expect(created.status).toBe(200);
    expect(created.body.activeTenant).toMatchObject({
      name: 'Identity Workspace',
      slug: 'identity-workspace',
      role: 'owner',
    });
    expect(created.body.accessToken).toBeString();
    expect(created.body.refreshToken).toBeString();
    await expect(harness.runtime.getTokenService()!
      .resolveAuthContext(created.body.accessToken)).resolves.toMatchObject({
        userId: registered.body.user.userId,
        tenantId: created.body.activeTenant.tenantId,
        tenantRole: 'owner',
      });

    const replay = await post(harness, '/auth/tenants/create', {
      continuation: raw,
      name: 'Replay Workspace',
    });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('TENANT_ONBOARDING_CONTINUATION_INVALID');
    expect(tenantCount(harness.db)).toBe(2);
  }, 60_000);

  test('does not issue tenant-creation authority before required email verification', async () => {
    const provider = new MemoryEmailProvider();
    configureEmail({ from: 'Zero <zero@example.test>', provider }, {
      name: 'Zero', publicUrl: 'http://localhost',
    });
    const harness = await start('authenticated', true);
    await bootstrap(harness, 'verified-bootstrap');

    const registered = await post(harness, '/auth/register', registration('verify-first'));
    expect(registered.status).toBe(200);
    expect(registered.body.user.emailVerificationRequired).toBe(true);
    expect(registered.body.tenantOnboardingRequired).toBeUndefined();
    expect(registered.body.onboarding).toBeUndefined();
    expect(registered.body.accessToken).toBeUndefined();
    expect(registered.body.refreshToken).toBeUndefined();
    expect((harness.db.prepare(`
      SELECT COUNT(*) AS count FROM _auth_session_continuations
      WHERE user_id = ? AND purpose = 'tenant_onboarding'
    `).get(registered.body.user.userId) as { count: number }).count).toBe(0);

    const message = provider.messages.find(({ message }) =>
      String(message.to).includes('verify-first@example.test'));
    expect(message).toBeDefined();
    const token = firstUrl(message!.message.text).searchParams.get('token');
    expect(token).toBeString();
    const verified = await post(harness, '/auth/verify-email', { token });
    expect(verified.status).toBe(200);
    expect(verified.body.tenantOnboardingRequired).toBe(true);
    expect(verified.body.accessToken).toBeUndefined();
    expect(continuation(verified)).toBeString();
  }, 60_000);

  test('rolls back tenant, owner, continuation consumption, and session on failure and concurrent loss', async () => {
    const harness = await start();
    await bootstrap(harness);
    const registered = await post(harness, '/auth/register', registration('rollback-user'));
    const raw = continuation(registered);
    const sessionsBefore = activeSessionCount(harness.db);

    harness.db.exec(`
      CREATE TRIGGER reject_onboarding_tenant
      BEFORE INSERT ON _auth_tenants
      BEGIN
        SELECT RAISE(ABORT, 'injected onboarding failure');
      END
    `);
    const failed = await post(harness, '/auth/tenants/create', {
      continuation: raw,
      name: 'Rollback Workspace',
    });
    expect(failed.status).toBe(500);
    expect(tenantCount(harness.db)).toBe(1);
    expect(activeSessionCount(harness.db)).toBe(sessionsBefore);
    expect(harness.runtime.getAuthTenantSessionService()!.continuations
      .inspect(raw, 'tenant_onboarding')).not.toBeNull();

    harness.db.exec('DROP TRIGGER reject_onboarding_tenant');
    const attempts = await Promise.all([
      post(harness, '/auth/tenants/create', {
        continuation: raw,
        name: 'Concurrency A',
      }),
      post(harness, '/auth/tenants/create', {
        continuation: raw,
        name: 'Concurrency B',
      }),
    ]);
    expect(attempts.map((value) => value.status).sort()).toEqual([200, 401]);
    expect(attempts.find((value) => value.status === 401)?.body.code)
      .toBe('TENANT_ONBOARDING_CONTINUATION_INVALID');
    expect(tenantCount(harness.db)).toBe(2);
    expect(harness.runtime.getTenancyService()!
      .listActiveMembershipsForUser(registered.body.user.userId)).toHaveLength(1);
  }, 60_000);

  test('rejects an expired proof and a proof issued by another application', async () => {
    const first = await start();
    const second = await start();
    await bootstrap(first, 'first-owner');
    await bootstrap(second, 'second-owner');

    const wrongAppUser = await post(first, '/auth/register', registration('wrong-app'));
    const wrongAppProof = continuation(wrongAppUser);
    const wrongApp = await post(second, '/auth/tenants/create', {
      continuation: wrongAppProof,
      name: 'Wrong App',
    });
    expect(wrongApp.status).toBe(401);
    expect(wrongApp.body.code).toBe('TENANT_ONBOARDING_CONTINUATION_INVALID');
    expect(tenantCount(second.db)).toBe(1);

    const expiringUser = await post(first, '/auth/register', registration('expired-proof'));
    const expiredProof = continuation(expiringUser);
    first.db.prepare(`
      UPDATE _auth_session_continuations SET expires_at = 0
      WHERE purpose = 'tenant_onboarding' AND consumed_at IS NULL
    `).run();
    const expired = await post(first, '/auth/tenants/create', {
      continuation: expiredProof,
      name: 'Expired',
    });
    expect(expired.status).toBe(401);
    expect(expired.body.code).toBe('TENANT_ONBOARDING_CONTINUATION_INVALID');
  }, 60_000);

  test('rolls back refresh consumption and preserves the current session when creation fails', async () => {
    const harness = await start();
    const owner = await bootstrap(harness, 'refresh-rollback-owner');
    const originalTenantId = owner.body.activeTenant.tenantId as string;
    harness.db.exec(`
      CREATE TRIGGER reject_refresh_tenant
      BEFORE INSERT ON _auth_tenants
      BEGIN
        SELECT RAISE(ABORT, 'injected refresh creation failure');
      END
    `);

    const failed = await post(harness, '/auth/tenants/create', {
      refreshToken: owner.body.refreshToken,
      name: 'Failed Refresh Workspace',
    });
    expect(failed.status).toBe(500);
    expect(tenantCount(harness.db)).toBe(1);
    await expect(harness.runtime.getTokenService()!
      .resolveAuthContext(owner.body.accessToken)).resolves.toMatchObject({
        tenantId: originalTenantId,
      });

    harness.db.exec('DROP TRIGGER reject_refresh_tenant');
    const retried = await post(harness, '/auth/tenants/create', {
      refreshToken: owner.body.refreshToken,
      name: 'Recovered Refresh Workspace',
    });
    expect(retried.status).toBe(200);
    expect(retried.body.activeTenant.tenantId).not.toBe(originalTenantId);
    expect(tenantCount(harness.db)).toBe(2);
  }, 60_000);

  test('bootstrap ignores the later disabled ceiling while ordinary creation fails closed', async () => {
    const harness = await start('disabled');
    const owner = await bootstrap(harness, 'disabled-owner');
    expect(owner.body.activeTenant).toBeDefined();
    expect(owner.body.user.role).toBe('admin');
    expect(tenantCount(harness.db)).toBe(1);

    const identityOnly = await post(harness, '/auth/register', registration('disabled-user'));
    expect(identityOnly.status).toBe(200);
    expect(identityOnly.body.onboarding.tenantCreation).toEqual({ allowed: false });
    expect(identityOnly.body.accessToken).toBeUndefined();

    const denied = await post(
      harness,
      '/auth/register',
      registration('disabled-create', 'Forbidden Workspace'),
    );
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('TENANT_CREATION_DISABLED');
    expect(harness.runtime.getStore()!.getUserByEmail('disabled-create@example.test'))
      .toBeNull();
    expect(tenantCount(harness.db)).toBe(1);
  }, 60_000);

  test('platform-admin policy requires live administration-organization authority', async () => {
    const harness = await start('platform-admin');
    const bootstrapAdmin = await bootstrap(harness, 'platform-owner');

    const ordinary = await post(harness, '/auth/register', registration('ordinary-user'));
    expect(ordinary.body.onboarding.tenantCreation).toEqual({ allowed: false });
    expect(ordinary.body.accessToken).toBeUndefined();

    const legacyGlobalAdmin = await harness.runtime.getStore()!.createUser({
      username: 'second-admin',
      email: 'second-admin@example.test',
      password: 'password123',
      role: 'admin',
      emailVerifiedAt: Date.now(),
    });
    const login = await post(harness, '/auth/login', {
      username: legacyGlobalAdmin.username,
      password: 'password123',
    });
    expect(login.body.onboarding.tenantCreation.allowed).toBe(false);
    const fromContinuation = await post(harness, '/auth/tenants/create', {
      continuation: login.body.onboarding.continuation,
      name: 'Admin Continuation Workspace',
    });
    expect(fromContinuation).toMatchObject({
      status: 403,
      body: { code: 'TENANT_CREATION_FORBIDDEN' },
    });

    const administrationTenantId = bootstrapAdmin.body.activeTenant.tenantId as string;
    harness.runtime.getTenancyService()!.addMembership({
      tenantId: administrationTenantId,
      userId: ordinary.body.user.userId,
      roleKey: 'administrator',
      createdBy: bootstrapAdmin.body.user.userId,
    });
    const operatorLogin = await post(harness, '/auth/login', {
      username: ordinary.body.user.username,
      password: 'password123',
    });
    expect(operatorLogin.body.activeTenant).toMatchObject({
      tenantId: administrationTenantId,
      kind: 'administration',
    });
    const fromApplicationAuthority = await post(harness, '/auth/tenants/create', {
      refreshToken: operatorLogin.body.refreshToken,
      name: 'Delegated Platform Workspace',
    });
    expect(fromApplicationAuthority).toMatchObject({
      status: 200,
      body: { activeTenant: { kind: 'organization', role: 'owner' } },
    });

    const fromRefresh = await post(harness, '/auth/tenants/create', {
      refreshToken: bootstrapAdmin.body.refreshToken,
      name: 'Admin Refresh Workspace',
    });
    expect(fromRefresh.status).toBe(200);
    expect(fromRefresh.body.activeTenant.role).toBe('owner');
    expect(fromRefresh.body.activeTenant.tenantId)
      .not.toBe(bootstrapAdmin.body.activeTenant.tenantId);
    expect(await harness.runtime.getTokenService()!
      .resolveAuthContext(bootstrapAdmin.body.accessToken)).toBeNull();
    await expect(harness.runtime.getTokenService()!
      .resolveAuthContext(fromRefresh.body.accessToken)).resolves.toMatchObject({
        userId: bootstrapAdmin.body.user.userId,
        tenantId: fromRefresh.body.activeTenant.tenantId,
      });
    expect(tenantCount(harness.db)).toBe(3);
  }, 60_000);
});

function firstUrl(text: string): URL {
  const match = text.match(/https?:\/\/[^\s]+/);
  if (!match) throw new Error('Verification URL missing');
  return new URL(match[0]);
}
