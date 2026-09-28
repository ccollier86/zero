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
  tenant?: { tenantId: string };
  activeTenant?: { tenantId: string };
}

const active: Harness[] = [];

afterEach(async () => {
  for (const harness of active.splice(0).reverse()) {
    await harness.app.stop();
    harness.db.dispose();
  }
});

describe('authorization/control-plane audit routes', () => {
  test('uses live platform authority, maps malformed filters to 422, and audits export access', async () => {
    const harness = await start('single');
    const admin = await register(harness, 'audit-admin');
    const user = await register(harness, 'audit-user');

    const registrationTrail = await getJson(
      harness,
      '/auth/audit/platform/events?limit=10',
      admin.accessToken,
    );
    expect(registrationTrail.status).toBe(200);
    expect(registrationTrail.body.events).toContainEqual(expect.objectContaining({
      action: 'application.bootstrap-completed',
      outcome: 'succeeded',
      actorUserId: admin.user.userId,
      actorProvenance: 'bootstrap',
    }));
    expect(registrationTrail.body.events).toContainEqual(expect.objectContaining({
      action: 'identity.registered',
      outcome: 'succeeded',
      actorUserId: user.user.userId,
      actorProvenance: 'registration',
    }));

    const malformedCursor = await getJson(
      harness,
      '/auth/audit/platform/events?cursor=not-base64',
      admin.accessToken,
    );
    expect(malformedCursor.status).toBe(422);
    expect(malformedCursor.body).toMatchObject({ code: 'AUTH_AUDIT_QUERY_INVALID' });

    const malformedAction = await getJson(
      harness,
      '/auth/audit/platform/events?action=Not%20A%20Code',
      admin.accessToken,
    );
    expect(malformedAction.status).toBe(422);
    expect(malformedAction.body).toMatchObject({ code: 'AUTH_AUDIT_QUERY_INVALID' });

    const invalidRange = await getJson(
      harness,
      '/auth/audit/platform/events?from=20&to=10',
      admin.accessToken,
    );
    expect(invalidRange.status).toBe(422);
    expect(invalidRange.body).toMatchObject({ code: 'AUTH_AUDIT_QUERY_INVALID' });

    const denied = await getJson(
      harness,
      '/auth/audit/platform/export',
      user.accessToken,
      { 'x-request-id': 'request-denied-export' },
    );
    expect(denied.status).toBe(403);

    const deniedTrail = await getJson(
      harness,
      '/auth/audit/platform/events?action=audit.exported&outcome=denied',
      admin.accessToken,
    );
    expect(deniedTrail.status).toBe(200);
    expect(deniedTrail.body.events).toContainEqual(expect.objectContaining({
      action: 'audit.exported',
      outcome: 'denied',
      actorUserId: user.user.userId,
      requestId: 'request-denied-export',
    }));

    const exported = await getJson(
      harness,
      '/auth/audit/platform/export?limit=10',
      admin.accessToken,
      { 'x-correlation-id': 'correlation-export' },
    );
    expect(exported.status).toBe(200);
    expect(exported.body).toMatchObject({ count: expect.any(Number), hasMore: false });
    expect(typeof exported.body.ndjson).toBe('string');

    const successfulTrail = await getJson(
      harness,
      '/auth/audit/platform/events?action=audit.exported&outcome=succeeded',
      admin.accessToken,
    );
    expect(successfulTrail.body.events).toContainEqual(expect.objectContaining({
      actorUserId: admin.user.userId,
      correlationId: 'correlation-export',
    }));

    // The token still says admin, but the durable user row no longer does.
    harness.runtime.getStore()!.updateUser(admin.user.userId, { role: 'user' });
    const staleAdminToken = await getJson(
      harness,
      '/auth/audit/platform/events',
      admin.accessToken,
    );
    expect(staleAdminToken.status).toBe(403);
  }, 60_000);

  test('binds tenant reads and exports to the live active tenant', async () => {
    const harness = await start('multi');
    const first = await register(harness, 'tenant-one-owner', 'Tenant One');
    const second = await register(harness, 'tenant-two-owner', 'Tenant Two');
    const firstTenantId = tenantId(first);
    const secondTenantId = tenantId(second);
    const firstCreationTrail = await getJson(
      harness,
      '/auth/audit/tenant/events?action=tenant.created',
      first.accessToken,
    );
    expect(firstCreationTrail.body.events).toEqual([
      expect.objectContaining({
        tenantId: firstTenantId,
        targetId: firstTenantId,
        actorProvenance: 'bootstrap',
        metadata: { bootstrap: true },
      }),
    ]);
    const secondCreationTrail = await getJson(
      harness,
      '/auth/audit/tenant/events?action=tenant.created',
      second.accessToken,
    );
    expect(secondCreationTrail.body.events).toEqual([
      expect.objectContaining({
        tenantId: secondTenantId,
        targetId: secondTenantId,
        actorProvenance: 'registration',
        metadata: { bootstrap: false },
      }),
    ]);
    const audit = harness.runtime.getAuditService()!;
    audit.append({
      action: 'tenant.policy-updated',
      outcome: 'succeeded',
      scope: { kind: 'tenant', tenantId: firstTenantId },
      actor: { provenance: 'system' },
      target: { type: 'tenant', id: firstTenantId },
    });
    audit.append({
      action: 'tenant.policy-updated',
      outcome: 'succeeded',
      scope: { kind: 'tenant', tenantId: secondTenantId },
      actor: { provenance: 'system' },
      target: { type: 'tenant', id: secondTenantId },
    });

    const firstPage = await getJson(
      harness,
      '/auth/audit/tenant/events?action=tenant.policy-updated',
      first.accessToken,
    );
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.events).toHaveLength(1);
    expect(firstPage.body.events[0]).toMatchObject({ tenantId: firstTenantId });

    const secondPage = await getJson(
      harness,
      '/auth/audit/tenant/events?action=tenant.policy-updated',
      second.accessToken,
    );
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.events).toHaveLength(1);
    expect(secondPage.body.events[0]).toMatchObject({ tenantId: secondTenantId });
  }, 60_000);
});

async function start(tenancy: 'single' | 'multi'): Promise<Harness> {
  const db = createReactiveDB({ mode: 'memory' });
  let runtime: AuthRuntime | null = null;
  const app = new Elysia().use(createAuthPlugin({
    db,
    tenancy,
    bootstrap: 'public',
    registration: { mode: 'public' },
    onRuntimeCreated(created) {
      runtime = created;
    },
  }));
  app.listen(0);
  const created = runtime as AuthRuntime | null;
  if (!created) throw new Error('Auth runtime was not created');
  const harness: Harness = {
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

async function getJson(
  harness: Harness,
  path: string,
  accessToken: string,
  extraHeaders: Record<string, string> = {},
) {
  const response = await fetch(`${harness.url}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...extraHeaders,
    },
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, any>,
  };
}

function tenantId(session: Session): string {
  const id = session.activeTenant?.tenantId ?? session.tenant?.tenantId;
  if (!id) throw new Error('Expected an active tenant');
  return id;
}
