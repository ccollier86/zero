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

interface Session {
  user: { userId: string; username: string; email: string };
  accessToken: string;
  refreshToken: string;
}

const active: Harness[] = [];

afterEach(async () => {
  for (const harness of active.splice(0).reverse()) {
    await harness.app.stop();
    harness.db.dispose();
  }
});

describe('single/advanced application access routes', () => {
  test('separates platform administrators, enforces ceilings, and transfers ownership', async () => {
    const harness = await start('advanced');
    const owner = await register(harness, 'owner');
    const subject = await register(harness, 'subject');
    const manager = await register(harness, 'manager');

    // A global platform administrator has no implicit application data-plane
    // authority. Updating the account role also invalidates the captured token.
    harness.runtime.getStore()!.updateUser(manager.user.userId, { role: 'admin' });
    const platformAdmin = await login(harness, 'manager');
    const denied = await request(
      harness,
      'GET',
      '/auth/application/config',
      undefined,
      platformAdmin.accessToken,
    );
    expect(denied.status).toBe(403);
    const strandedOwner = await request(
      harness,
      'PATCH',
      `/auth/admin/users/${owner.user.userId}`,
      { status: 'suspended' },
      platformAdmin.accessToken,
    );
    expect(strandedOwner.status).toBe(409);
    expect(strandedOwner.body.code).toBe('LAST_ACTIVE_APPLICATION_OWNER_REQUIRED');

    const config = await request(
      harness,
      'GET',
      '/auth/application/config',
      undefined,
      owner.accessToken,
    );
    expect(config.status).toBe(200);
    expect(config.headers.get('cache-control')).toBe('private, no-store');
    expect(config.headers.get('pragma')).toBe('no-cache');
    expect(config.body).toMatchObject({
      authorization: 'advanced',
      actor: { userId: owner.user.userId, roles: ['owner'] },
      capabilities: { canManageRoles: true, canTransferOwnership: true },
    });
    expect(JSON.stringify(config.body).toLowerCase()).not.toContain('tenant');
    expect(JSON.stringify(config.body).toLowerCase()).not.toContain('organization');

    const firstPage = await request(
      harness,
      'GET',
      '/auth/application/users?limit=1',
      undefined,
      owner.accessToken,
    );
    expect(firstPage.status).toBe(200);
    expect(firstPage.headers.get('cache-control')).toBe('private, no-store');
    expect(firstPage.headers.get('pragma')).toBe('no-cache');
    expect(firstPage.body.page).toMatchObject({ limit: 1, count: 1, hasMore: true });
    expect(firstPage.body.users[0].identity).not.toHaveProperty('role');
    expect(firstPage.body.users[0]).not.toHaveProperty('mfaRequired');
    expect(firstPage.body.users[0]).not.toHaveProperty('passwordChangeRequired');
    const secondPage = await request(
      harness,
      'GET',
      `/auth/application/users?limit=2&cursor=${encodeURIComponent(firstPage.body.page.nextCursor)}`,
      undefined,
      owner.accessToken,
    );
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.users).toHaveLength(2);

    const managerGrant = await request(
      harness,
      'PATCH',
      `/auth/application/users/${manager.user.userId}/roles`,
      { roles: ['delegated-manager'], expectedRevision: 'application:application:0' },
      owner.accessToken,
    );
    expect(managerGrant.status).toBe(200);
    expect(managerGrant.body.user.roles).toEqual(['delegated-manager']);
    expect((await request(
      harness,
      'GET',
      '/auth/application/config',
      undefined,
      platformAdmin.accessToken,
    )).status).toBe(200);
    const delegated = await login(harness, 'manager');
    const delegatedConfig = await request(
      harness,
      'GET',
      '/auth/application/config',
      undefined,
      delegated.accessToken,
    );
    expect(delegatedConfig.status).toBe(200);
    expect(delegatedConfig.body.roles.find((role: any) => role.key === 'reader').grantable)
      .toBe(true);
    expect(delegatedConfig.body.roles.find((role: any) => role.key === 'editor').grantable)
      .toBe(false);

    const readerGrant = await request(
      harness,
      'PATCH',
      `/auth/application/users/${subject.user.userId}/roles`,
      { roles: ['reader'], expectedRevision: 'application:application:0' },
      delegated.accessToken,
    );
    expect(readerGrant.status).toBe(200);
    const escalation = await request(
      harness,
      'PATCH',
      `/auth/application/users/${subject.user.userId}/roles`,
      { roles: ['editor'], expectedRevision: readerGrant.body.user.roleRevision },
      delegated.accessToken,
    );
    expect(escalation.status).toBe(403);
    expect(escalation.body.code).toBe('APPLICATION_ROLE_ESCALATION_FORBIDDEN');
    const staleWrite = await request(
      harness,
      'PATCH',
      `/auth/application/users/${subject.user.userId}/roles`,
      { roles: ['reader'], expectedRevision: 'application:application:0' },
      owner.accessToken,
    );
    expect(staleWrite.status).toBe(409);
    expect(staleWrite.body.code).toBe('APPLICATION_ROLE_REVISION_CONFLICT');
    const protectedOwner = await request(
      harness,
      'PATCH',
      `/auth/application/users/${subject.user.userId}/roles`,
      { roles: ['owner'], expectedRevision: readerGrant.body.user.roleRevision },
      owner.accessToken,
    );
    expect(protectedOwner.status).toBe(409);
    expect(protectedOwner.body.code).toBe('APPLICATION_OWNER_ROLE_PROTECTED');

    const managerRevoke = await request(
      harness,
      'PATCH',
      `/auth/application/users/${manager.user.userId}/roles`,
      { roles: [], expectedRevision: managerGrant.body.user.roleRevision },
      owner.accessToken,
    );
    expect(managerRevoke.status).toBe(200);
    expect(managerRevoke.body.actorAuthorizationChanged).toBe(false);
    expect((await request(
      harness,
      'GET',
      '/auth/application/config',
      undefined,
      delegated.accessToken,
    )).status).toBe(403);

    const subjectBeforeTransfer = await login(harness, 'subject');
    const transfer = await request(
      harness,
      'POST',
      '/auth/application/ownership/transfer',
      { userId: subject.user.userId },
      owner.accessToken,
    );
    expect(transfer.status).toBe(200);
    expect(transfer.body).toMatchObject({
      actorAuthorizationChanged: true,
      owner: { identity: { userId: subject.user.userId }, roles: ['owner', 'reader'] },
      previousOwner: { identity: { userId: owner.user.userId }, roles: [] },
    });
    expect((await request(
      harness,
      'GET',
      '/auth/application/config',
      undefined,
      owner.accessToken,
    )).status).toBe(403);
    expect((await request(
      harness,
      'GET',
      '/auth/application/config',
      undefined,
      subjectBeforeTransfer.accessToken,
    )).status).toBe(200);
    const newOwner = await login(harness, 'subject');
    expect((await request(
      harness,
      'GET',
      '/auth/application/config',
      undefined,
      newOwner.accessToken,
    )).status).toBe(200);
  }, 60_000);

  test('does not mount the application namespace outside single/advanced mode', async () => {
    const simple = await start('simple');
    expect((await request(simple, 'GET', '/auth/application/config')).status).toBe(404);

    const multi = await start('advanced', 'multi');
    expect((await request(multi, 'GET', '/auth/application/config')).status).toBe(404);
  }, 60_000);

  test('rejects application mutations when the actor session is revoked after request auth', async () => {
    const harness = await start('advanced');
    const owner = await register(harness, 'commit-owner');
    const subject = await register(harness, 'commit-subject');
    const auth = await harness.runtime.getTokenService()!.resolveAuthContext(
      owner.accessToken,
    );
    if (!auth?.sessionId) throw new Error('Owner session authority was not resolved');

    const service = harness.runtime.getApplicationAdministrationService()!;
    const replaceUserRoles = service.replaceUserRoles.bind(service);
    let intercepted = false;
    (service as any).replaceUserRoles = (input: any) => {
      intercepted = true;
      harness.runtime.getAuthSessionService()!.revoke(
        auth.sessionId!,
        'commit-boundary-test',
      );
      return replaceUserRoles(input);
    };

    let result: Awaited<ReturnType<typeof request>>;
    try {
      result = await request(
        harness,
        'PATCH',
        `/auth/application/users/${subject.user.userId}/roles`,
        { roles: ['reader'], expectedRevision: 'application:application:0' },
        owner.accessToken,
      );
    } finally {
      (service as any).replaceUserRoles = replaceUserRoles;
    }

    expect(intercepted).toBe(true);
    expect(result!).toMatchObject({
      status: 409,
      body: { code: 'AUTHORIZATION_CHANGED' },
    });
    expect(harness.runtime.getAuthorizationRoleService()!
      .getRetainedApplicationRoleKeys(subject.user.userId)).toEqual([]);
  }, 60_000);
});

async function start(
  authorization: 'simple' | 'advanced',
  tenancy: 'single' | 'multi' = 'single',
): Promise<Harness> {
  const db = createReactiveDB({ mode: 'memory' });
  let runtime: AuthRuntime | null = null;
  const advanced = authorization === 'advanced' && tenancy === 'multi'
    ? { mode: 'advanced' as const }
    : authorization === 'advanced'
    ? {
        mode: 'advanced' as const,
        permissions: {
          'documents:read': { label: 'Read documents' },
          'documents:write': { label: 'Write documents' },
        },
        roles: {
          reader: { permissions: ['documents:read'] },
          editor: { permissions: ['documents:read', 'documents:write'] },
          'delegated-manager': {
            permissions: [
              'application.roles:read',
              'application.roles:manage',
              'documents:read',
            ],
          },
        },
      }
    : 'simple';
  const app = new Elysia().use(createAuthPlugin({
    db,
    tenancy,
    authorization: advanced,
    bootstrap: 'public',
    registration: { mode: 'public' },
    onRuntimeCreated(created) {
      runtime = created;
    },
  }));
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

async function register(harness: Harness, key: string): Promise<Session> {
  const response = await request(harness, 'POST', '/auth/register', {
    username: key,
    email: `${key}@example.test`,
    password: 'password123',
  });
  expect(response.status).toBe(200);
  return response.body as Session;
}

async function login(harness: Harness, username: string): Promise<Session> {
  const response = await request(harness, 'POST', '/auth/login', {
    username,
    password: 'password123',
  });
  expect(response.status).toBe(200);
  return response.body as Session;
}

async function request(
  harness: Harness,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  bearer?: string,
): Promise<{ status: number; body: Record<string, any>; headers: Headers }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const response = await fetch(`${harness.url}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: Record<string, any> = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as Record<string, any>;
    } catch {
      parsed = { error: text };
    }
  }
  return {
    status: response.status,
    body: parsed,
    headers: response.headers,
  };
}
