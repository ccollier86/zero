import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import { resolveAuthBehaviorConfig } from '../../auth/auth-config';
import { createAuthorizationKernel } from '../../auth/authorization-kernel';
import { trustedSystemServiceDataScope } from '../../auth/service-data-scope';
import type { TokenService } from '../../auth/token-service';
import type { AuthContext } from '../../auth/types';
import type { NotificationService } from '../../notifications/notification-service';
import { createNotificationPlugin } from '../../notifications/notification.plugin';
import type { RoomService } from '../../rooms/room-service';
import { createRoomPlugin } from '../../rooms/room.plugin';
import { createReactiveDB, type ReactiveDB } from '../../sync/reactive-db';

const TENANT_A = 'tenant_builtin_alpha';
const TENANT_B = 'tenant_builtin_beta';

interface Harness {
  app: ReturnType<typeof createHarnessApp>;
  baseUrl: string;
  db: ReactiveDB;
  notifications: NotificationService;
  rooms: RoomService;
}

const active: Harness[] = [];

afterEach(async () => {
  for (const harness of active.splice(0).reverse()) {
    await harness.app.stop(true);
    harness.db.dispose();
  }
});

describe('built-in multi-tenant service authority', () => {
  test('notification administration comes from the active tenant, never platform admin', async () => {
    const harness = startHarness();

    const denied = await request(harness, 'POST', '/notifications/broadcast', 'platform-admin', {
      title: 'Platform privilege must not cross the tenant data plane',
    });
    expect(denied).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });

    const managerCreated = await request<{
      notification: { notification_id: string; tenant_id: string };
    }>(harness, 'POST', '/notifications/broadcast', 'notification-manager', {
      title: 'Manager notice',
    });
    expect(managerCreated).toMatchObject({
      status: 200,
      body: { notification: { tenant_id: TENANT_A } },
    });
    const id = managerCreated.body.notification.notification_id;

    const ownerCreated = await request(harness, 'POST', '/notifications/broadcast', 'owner', {
      title: 'Owner notice',
    });
    expect(ownerCreated.status).toBe(200);

    // Role audiences are tenant roles, not users.role. Even though this
    // caller is a global platform admin, its live tenant role is only member.
    const platformRoleTarget = await request<{
      notification: { notification_id: string };
    }>(harness, 'POST', '/notifications/notify-role/admin', 'notification-manager', {
      title: 'Tenant role target',
    });
    expect(platformRoleTarget.status).toBe(200);
    expect((await request(
      harness,
      'GET',
      `/notifications/${platformRoleTarget.body.notification.notification_id}`,
      'platform-admin',
    ))).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } });

    // The platform admin is a valid tenant member and may consume its own
    // broadcast, but that membership does not grant audit/delete authority.
    expect((await request(harness, 'GET', `/notifications/${id}`, 'platform-admin')).status)
      .toBe(200);
    expect((await request(
      harness,
      'GET',
      `/notifications/${id}/receipts`,
      'platform-admin',
    ))).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });
    expect((await request(harness, 'DELETE', `/notifications/${id}`, 'platform-admin')))
      .toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });

    expect((await request(harness, 'GET', `/notifications/${id}/receipts`, 'owner')).status)
      .toBe(200);
    expect((await request(
      harness,
      'GET',
      `/notifications/${id}/receipts`,
      'notification-manager',
    )).status).toBe(200);

    // A manager in another tenant and a guessed id receive the same not-found
    // result after their own scope authority has been established.
    expect((await request(harness, 'DELETE', `/notifications/${id}`, 'other-owner')))
      .toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } });
    expect((await request(
      harness,
      'GET',
      '/notifications/missing/receipts',
      'notification-manager',
    ))).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } });

    expect((await request(harness, 'DELETE', `/notifications/${id}`, 'notification-manager')))
      .toEqual({ status: 200, body: { ok: true } });
  });

  test('room creators retain ownership while tenant managers can administer peers', async () => {
    const harness = startHarness();
    const room = await createRoom(harness, 'member', 'Member-owned room');
    const alphaScope = trustedSystemServiceDataScope({
      scopeKind: 'tenant',
      tenantId: TENANT_A,
    });
    harness.rooms.join(room.room_id, 'platform-admin-user', 'member', alphaScope);

    // Even room membership plus the global platform-admin role is not tenant
    // room administration in multi mode.
    expect((await request(harness, 'DELETE', `/rooms/${room.room_id}`, 'platform-admin')))
      .toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } });

    // The explicit immutable rooms:manage permission may administer a peer
    // room without first becoming a room member.
    expect((await request(harness, 'DELETE', `/rooms/${room.room_id}`, 'room-manager')))
      .toEqual({ status: 200, body: { ok: true } });

    const ownerManaged = await createRoom(harness, 'member', 'Owner-managed room');
    expect((await request(harness, 'DELETE', `/rooms/${ownerManaged.room_id}`, 'owner')))
      .toEqual({ status: 200, body: { ok: true } });

    const crossTenant = await createRoom(harness, 'member', 'Tenant-bound room');
    expect((await request(harness, 'DELETE', `/rooms/${crossTenant.room_id}`, 'other-owner')))
      .toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } });
    expect(harness.rooms.getRoom(crossTenant.room_id, alphaScope)).not.toBeNull();
  });
});

function startHarness(): Harness {
  const db = createReactiveDB({ mode: 'memory' });
  const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({
    tenancy: 'multi',
    authorization: {
      mode: 'simple',
      roles: {
        notification_manager: { permissions: ['notifications:manage'] },
        room_manager: { permissions: ['rooms:manage'] },
      },
    },
  }));
  const contexts = new Map<string, AuthContext>([
    ['owner', tenantContext('owner-user', 'user', TENANT_A, 'owner')],
    ['member', tenantContext('member-user', 'user', TENANT_A, 'member')],
    ['platform-admin', tenantContext(
      'platform-admin-user',
      'admin',
      TENANT_A,
      'member',
    )],
    ['notification-manager', tenantContext(
      'notification-manager-user',
      'user',
      TENANT_A,
      'notification_manager',
    )],
    ['room-manager', tenantContext(
      'room-manager-user',
      'user',
      TENANT_A,
      'room_manager',
    )],
    ['other-owner', tenantContext('other-owner-user', 'admin', TENANT_B, 'owner')],
  ]);
  const tokens = {
    async resolveAuthContext(token: string) {
      return contexts.get(token) ?? null;
    },
  } as TokenService;
  let notifications: NotificationService | null = null;
  let rooms: RoomService | null = null;
  const authorization = { getAuthorizationKernel: () => kernel };
  const app = createHarnessApp(
    db,
    tokens,
    authorization,
    (service) => { notifications = service; },
    (service) => { rooms = service; },
  );
  app.listen(0);
  if (!notifications || !rooms) throw new Error('Built-in services did not start');
  const harness = {
    app,
    baseUrl: `http://localhost:${app.server!.port}`,
    db,
    notifications,
    rooms,
  };
  active.push(harness);
  return harness;
}

function createHarnessApp(
  db: ReactiveDB,
  tokens: TokenService,
  authorization: { getAuthorizationKernel: () => ReturnType<typeof createAuthorizationKernel> },
  onNotifications: (service: NotificationService) => void,
  onRooms: (service: RoomService) => void,
) {
  return new Elysia()
    .use(createNotificationPlugin({
      db,
      getTokenService: () => tokens,
      getScheduler: () => null,
      authorization,
      onServiceCreated: onNotifications,
    }))
    .use(createRoomPlugin({
      db,
      getTokenService: () => tokens,
      authorization,
      onServiceCreated: onRooms,
    }));
}

function tenantContext(
  userId: string,
  platformRole: string,
  tenantId: string,
  tenantRole: string,
): AuthContext {
  return {
    userId,
    email: `${userId}@example.test`,
    role: platformRole,
    sessionKind: 'web',
    sessionId: `session-${userId}-${tenantId}`,
    sessionGeneration: 0,
    sessionScopeKind: 'tenant',
    sessionScopeId: tenantId,
    tenantId,
    membershipId: `membership-${userId}-${tenantId}`,
    tenantRole,
    tenantAuthorizationGeneration: 0,
    membershipAuthorizationGeneration: 0,
  };
}

async function createRoom(
  harness: Harness,
  token: string,
  name: string,
): Promise<{ room_id: string; tenant_id: string }> {
  const response = await request<{
    room: { room_id: string; tenant_id: string };
  }>(harness, 'POST', '/rooms', token, { name });
  expect(response.status).toBe(200);
  return response.body.room;
}

async function request<T = Record<string, unknown>>(
  harness: Harness,
  method: string,
  path: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${harness.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({})) as T,
  };
}
