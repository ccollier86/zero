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
  user: { userId: string };
  accessToken: string;
  refreshToken: string;
  activeTenant?: { tenantId: string };
  tenant?: { tenantId: string };
}

const active: Harness[] = [];

afterEach(async () => {
  for (const harness of active.splice(0).reverse()) {
    await harness.app.stop();
    harness.db.dispose();
  }
});

describe('GET /auth/authorization', () => {
  test('returns only live safe authority and reflects advanced permission revocation', async () => {
    const harness = await start('single', 'advanced');
    const owner = await register(harness, 'owner');
    const reader = await register(harness, 'reader');
    const roles = harness.runtime.getAuthorizationRoleService()!;
    roles.replaceApplicationRoles({
      userId: reader.user.userId,
      roleKeys: ['reader'],
      changedBy: owner.user.userId,
    });

    const before = await getAuthorization(harness, reader.accessToken);
    expect(before.status).toBe(200);
    expect(before.headers.get('cache-control')).toBe('private, no-store');
    expect(before.headers.get('pragma')).toBe('no-cache');
    expect(before.body).toMatchObject({
      version: 1,
      identity: { userId: reader.user.userId, platformRole: 'user' },
      profile: { tenancy: 'single', authorization: 'advanced' },
      scope: {
        kind: 'application',
        roles: ['reader'],
        permissions: ['records:read'],
        allPermissions: false,
      },
    });
    const serialized = JSON.stringify(before.body).toLowerCase();
    for (const secretField of [
      'accesstoken',
      'refreshtoken',
      'sessionid',
      'sessiongeneration',
      'authgeneration',
      'email',
      'properties',
      'clientid',
    ]) {
      expect(serialized).not.toContain(secretField);
    }

    roles.replaceApplicationRoles({
      userId: reader.user.userId,
      roleKeys: [],
      changedBy: owner.user.userId,
    });
    const after = await getAuthorization(harness, reader.accessToken);
    expect(after.status).toBe(200);
    expect(after.body.scope).toMatchObject({ roles: [], permissions: [] });
    expect(after.body.revision).not.toBe(before.body.revision);
  }, 60_000);

  test('binds a multi-tenant projection to the bearer tenant and rejects anonymous reads', async () => {
    const harness = await start('multi', 'simple');
    const owner = await register(harness, 'tenant-owner', 'Acme Health');
    const response = await getAuthorization(harness, owner.accessToken);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      identity: { userId: owner.user.userId },
      profile: { tenancy: 'multi', authorization: 'simple' },
      scope: {
        kind: 'tenant',
        scopeId: owner.tenant!.tenantId,
        tenantId: owner.tenant!.tenantId,
        roles: ['owner'],
        allPermissions: true,
      },
    });
    expect((await getAuthorization(harness)).status).toBe(401);
  }, 60_000);
});

async function start(
  tenancy: 'single' | 'multi',
  authorization: 'simple' | 'advanced',
): Promise<Harness> {
  const db = createReactiveDB({ mode: 'memory' });
  let runtime: AuthRuntime | null = null;
  const app = new Elysia().use(createAuthPlugin({
    db,
    tenancy,
    authorization: authorization === 'advanced' ? {
      mode: 'advanced',
      permissions: {
        'records:read': { label: 'Read records' },
        'records:write': { label: 'Write records' },
      },
      roles: {
        reader: { permissions: ['records:read'] },
        editor: { permissions: ['records:read', 'records:write'] },
      },
    } : 'simple',
    bootstrap: 'public',
    registration: { mode: 'public' },
    onRuntimeCreated(created) {
      runtime = created;
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
    if (Date.now() > deadline) throw new Error('Timed out waiting for auth runtime');
    await Bun.sleep(5);
  }
  return harness;
}

async function register(
  harness: Harness,
  key: string,
  organizationName?: string,
): Promise<Session> {
  const response = await fetch(`${harness.url}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: key,
      email: `${key}@example.test`,
      password: 'password123',
      ...(organizationName ? { organizationName } : {}),
    }),
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<Session>;
}

async function getAuthorization(harness: Harness, bearer?: string) {
  const response = await fetch(`${harness.url}/auth/authorization`, {
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json() as Record<string, any>,
  };
}
