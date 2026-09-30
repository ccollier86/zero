import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia, type AnyElysia } from 'elysia';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { createAuthMiddleware } from './auth.middleware';
import type { AuthRuntime } from './auth-runtime';
import { createAuthPlugin } from './auth.plugin';
import type { AuthBehaviorConfig } from './types';

const API_KEY_ACCESS = {
  user: 'required',
  credentials: ['session', 'api-key'],
} as const;

interface Harness {
  readonly app: AnyElysia;
  readonly db: ReactiveDB;
  readonly runtime: AuthRuntime;
  readonly url: string;
}

const active: Harness[] = [];

afterEach(async () => {
  for (const harness of active.splice(0).reverse()) {
    await harness.app.stop();
    harness.db.dispose();
  }
});

describe('Guardian API-key management HTTP routes', () => {
  test('keeps single/simple management session-only and applies administrator issuance policy narrowly', async () => {
    const harness = await start({
      tenancy: 'single',
      authorization: 'simple',
      apiKeys: {
        enabled: true,
        selfService: true,
        administratorIssuance: false,
      },
    });
    const admin = await register(harness, 'admin');
    const target = await register(harness, 'target');

    const issued = await json(harness, 'POST', '/auth/api-keys', {
      label: 'Target automation',
    }, target.accessToken);
    expect(issued).toMatchObject({ status: 200 });
    expect(issued.body.secret).toMatch(/^zero_ak_v1\./);
    expect(issued.body.apiKey).toMatchObject({
      userId: target.userId,
      label: 'Target automation',
      status: 'active',
    });

    const probe = await json(
      harness,
      'GET',
      '/api/api-key-probe',
      undefined,
      issued.body.secret,
    );
    expect(probe).toMatchObject({
      status: 200,
      body: {
        userId: target.userId,
        credentialKind: 'api-key',
        scopeKind: 'application',
        scopeId: 'application',
      },
    });

    const keyCannotManageKeys = await json(
      harness,
      'GET',
      '/auth/api-keys',
      undefined,
      issued.body.secret,
    );
    expect(keyCannotManageKeys.status).toBe(401);
    expect(keyCannotManageKeys.body.code).toBe('UNAUTHORIZED');

    const listed = await json(
      harness,
      'GET',
      `/auth/admin/users/${target.userId}/api-keys`,
      undefined,
      admin.accessToken,
    );
    expect(listed.status).toBe(200);
    expect(listed.body.apiKeys).toHaveLength(1);
    expect(listed.body.apiKeys[0].keyId).toBe(issued.body.apiKey.keyId);
    expect(listed.body.capabilities).toEqual({
      canIssue: false,
      canRotate: false,
      canRevoke: true,
    });
    expect(JSON.stringify(listed.body)).not.toContain(issued.body.secret);

    const blockedIssue = await json(
      harness,
      'POST',
      `/auth/admin/users/${target.userId}/api-keys`,
      { label: 'Administrator issue' },
      admin.accessToken,
    );
    expect(blockedIssue.status).toBe(404);
    expect(blockedIssue.body.code).toBe('AUTH_API_KEYS_UNAVAILABLE');

    const blockedRotate = await json(
      harness,
      'POST',
      `/auth/admin/api-keys/${issued.body.apiKey.keyId}/rotate`,
      { label: 'Administrator rotate' },
      admin.accessToken,
    );
    expect(blockedRotate.status).toBe(404);
    expect(blockedRotate.body.code).toBe('AUTH_API_KEYS_UNAVAILABLE');

    const suspended = await json(
      harness,
      'POST',
      `/auth/admin/users/${target.userId}/suspend`,
      undefined,
      admin.accessToken,
    );
    expect(suspended.status).toBe(200);

    const listedInactive = await json(
      harness,
      'GET',
      `/auth/admin/users/${target.userId}/api-keys`,
      undefined,
      admin.accessToken,
    );
    expect(listedInactive.status).toBe(200);
    expect(listedInactive.body.apiKeys[0].status).toBe('invalidated');
    expect(listedInactive.body.capabilities).toEqual({
      canIssue: false,
      canRotate: false,
      canRevoke: true,
    });

    const revoked = await json(
      harness,
      'DELETE',
      `/auth/admin/api-keys/${issued.body.apiKey.keyId}`,
      undefined,
      admin.accessToken,
    );
    expect(revoked.status).toBe(200);
    expect(revoked.body.status).toBe('revoked');
  });

  test('issues and authenticates an exact organization-bound key in multi/simple mode', async () => {
    const harness = await start({
      tenancy: 'multi',
      authorization: 'simple',
      apiKeys: {
        enabled: true,
        selfService: true,
        administratorIssuance: false,
      },
    });
    const platform = await register(harness, 'platform', 'Platform Administration');
    const administrationSelfIssue = await json(
      harness,
      'POST',
      '/auth/api-keys',
      { label: 'Must not become a platform key' },
      platform.accessToken,
    );
    expect(administrationSelfIssue.status).toBe(403);
    expect(administrationSelfIssue.body.code).toBe('FORBIDDEN');

    const owner = await register(harness, 'owner', 'API Key Org');

    const issued = await json(harness, 'POST', '/auth/api-keys', {
      label: 'Organization automation',
    }, owner.accessToken);
    expect(issued).toMatchObject({ status: 200 });
    expect(issued.body.apiKey).toMatchObject({
      userId: owner.userId,
      scopeKind: 'tenant',
      scopeId: owner.tenantId,
      tenantId: owner.tenantId,
      membershipId: owner.membershipId,
      status: 'active',
    });

    const probe = await json(
      harness,
      'GET',
      '/api/api-key-probe',
      undefined,
      issued.body.secret,
    );
    expect(probe).toMatchObject({
      status: 200,
      body: {
        userId: owner.userId,
        credentialKind: 'api-key',
        scopeKind: 'tenant',
        scopeId: owner.tenantId,
        tenantId: owner.tenantId,
        membershipId: owner.membershipId,
      },
    });

    const listed = await json(
      harness,
      'GET',
      '/auth/api-keys',
      undefined,
      owner.accessToken,
    );
    expect(listed.status).toBe(200);
    expect(listed.body.apiKeys).toHaveLength(1);
    expect(listed.body.capabilities).toEqual({
      canIssue: true,
      canRotate: true,
      canRevoke: true,
    });

    const keyCannotManageKeys = await json(
      harness,
      'GET',
      '/auth/api-keys',
      undefined,
      issued.body.secret,
    );
    expect(keyCannotManageKeys.status).toBe(401);
    expect(keyCannotManageKeys.body.code).toBe('UNAUTHORIZED');
  });
});

async function start(config: AuthBehaviorConfig): Promise<Harness> {
  const db = createReactiveDB({ mode: 'memory' });
  let runtime: AuthRuntime | null = null;
  const app = new Elysia()
    .use(createAuthPlugin({
      db,
      bootstrap: 'public',
      registration: { mode: 'public' },
      ...config,
      onRuntimeCreated(created) {
        runtime = created;
      },
    }))
    .use(createAuthMiddleware(
      () => runtime?.getTokenService() ?? null,
      {
        getRequestCredentialResolver: () => (
          runtime?.getRequestCredentialResolver() ?? null
        ),
        getAuthorizationKernel: () => runtime?.getAuthorizationKernel() ?? null,
        getPropertyStore: () => runtime?.getStore() ?? null,
        getRoleAssignments: () => runtime?.getAuthorizationRoleService() ?? null,
      },
    ))
    .get('/api/api-key-probe', (context: any) => ({
      userId: context.authContext.userId,
      credentialKind: context.authContext.credentialKind,
      scopeKind: context.authContext.sessionScopeKind,
      scopeId: context.authContext.sessionScopeId,
      tenantId: context.authContext.tenantId ?? null,
      membershipId: context.authContext.membershipId ?? null,
    }), { zeroAuth: API_KEY_ACCESS });
  app.listen(0);
  const createdRuntime = runtime as AuthRuntime | null;
  if (!createdRuntime) throw new Error('Auth runtime was not created');
  const harness: Harness = {
    app,
    db,
    runtime: createdRuntime,
    url: `http://localhost:${app.server!.port}`,
  };
  active.push(harness);
  return harness;
}

async function register(
  harness: Harness,
  name: string,
  organizationName?: string,
): Promise<{
  userId: string;
  accessToken: string;
  tenantId?: string;
  membershipId?: string;
}> {
  const response = await json(harness, 'POST', '/auth/register', {
    username: name,
    email: `${name}@example.test`,
    password: 'password123',
    ...(organizationName ? { organizationName } : {}),
  });
  expect(response.status).toBe(200);
  return {
    userId: response.body.user.userId,
    accessToken: response.body.accessToken,
    ...(response.body.tenant ? {
      tenantId: response.body.tenant.tenantId,
      membershipId: response.body.tenant.membershipId,
    } : {}),
  };
}

async function json(
  harness: Harness,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  bearer?: string,
): Promise<{ status: number; body: Record<string, any> }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const response = await fetch(`${harness.url}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, any>,
  };
}
