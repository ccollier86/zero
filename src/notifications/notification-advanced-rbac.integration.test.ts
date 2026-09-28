/**
 * Proves role-targeted notifications use the complete live advanced-RBAC
 * assignment set instead of projecting only users.role.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import { createAuthPlugin } from '../auth/auth.plugin';
import type { AuthRuntime } from '../auth/auth-runtime';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { NotificationService } from './notification-service';
import { createNotificationPlugin } from './notification.plugin';
import type { NotificationRecord } from './types';

let db: ReactiveDB;
let app: ReturnType<typeof createAdvancedNotificationApp> | null = null;
let authRuntime: AuthRuntime;
let notifications: NotificationService;
let baseUrl = '';

beforeAll(async () => {
  db = createReactiveDB({ mode: 'memory' });
  const startedApp = createAdvancedNotificationApp();
  app = startedApp;
  baseUrl = `http://localhost:${startedApp.server!.port}`;

  for (let attempt = 0; attempt < 20; attempt++) {
    if (authRuntime.getStore() && authRuntime.getTokenService() && notifications) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Advanced auth and notification plugins did not start');
});

function createAdvancedNotificationApp() {
  return new Elysia()
    .use(createAuthPlugin({
      db,
      bootstrap: 'public',
      authorization: {
        mode: 'advanced',
        permissions: {
          'notifications:read': { label: 'Read notifications' },
        },
        roles: {
          reader: { permissions: ['notifications:read'] },
          reporter: { permissions: [] },
        },
      },
      onRuntimeCreated(runtime) {
        authRuntime = runtime;
      },
    }))
    .use(createNotificationPlugin({
      db,
      getTokenService: () => authRuntime.getTokenService(),
      authorization: {
        getAuthorizationKernel: () => authRuntime.getAuthorizationKernel(),
        getPropertyStore: () => authRuntime.getStore(),
        getRoleAssignments: () => authRuntime.getAuthorizationRoleService(),
      },
      onServiceCreated(service) {
        notifications = service;
      },
    }))
    .listen(0);
}

afterAll(async () => {
  await app?.stop(true);
  app = null;
  db.dispose();
});

describe('notification advanced RBAC integration', () => {
  test('matches role-targeted notifications against every retained role', async () => {
    const users = authRuntime.getStore()!;
    const tokens = authRuntime.getTokenService()!;
    const roles = authRuntime.getAuthorizationRoleService()!;
    const owner = await users.createUser({
      username: `owner_${crypto.randomUUID()}`,
      email: `${crypto.randomUUID()}@test.local`,
      password: 'password123',
      role: 'admin',
    });
    const member = await users.createUser({
      username: `member_${crypto.randomUUID()}`,
      email: `${crypto.randomUUID()}@test.local`,
      password: 'password123',
      role: 'user',
    });
    roles.establishBootstrapOwner(owner.userId);
    roles.assignApplicationRole({
      userId: member.userId,
      roleKey: 'reporter',
      createdBy: owner.userId,
    });
    roles.assignApplicationRole({
      userId: member.userId,
      roleKey: 'reader',
      createdBy: owner.userId,
    });

    const notification = notifications.notifyRole(
      'reader',
      { title: 'Advanced role target' },
      owner.userId,
    );
    expect(notifications.getForUser(member.userId, ['reporter', 'reader']))
      .toHaveLength(1);

    const pair = await tokens.issueTokenPair(member);
    const headers = { Authorization: `Bearer ${pair.accessToken}` };
    const listResponse = await fetch(`${baseUrl}/notifications`, { headers });
    expect(listResponse.status).toBe(200);
    const listed = await listResponse.json() as { notifications: NotificationRecord[] };
    expect(listed.notifications.map((entry) => entry.notification_id))
      .toContain(notification.notification_id);

    const unreadResponse = await fetch(`${baseUrl}/notifications/unread-count`, { headers });
    expect(unreadResponse.status).toBe(200);
    await expect(unreadResponse.json()).resolves.toEqual({ count: 1 });

    const readResponse = await fetch(`${baseUrl}/notifications/read-all`, {
      method: 'POST',
      headers,
    });
    expect(readResponse.status).toBe(200);
    const afterRead = await fetch(`${baseUrl}/notifications/unread-count`, { headers });
    await expect(afterRead.json()).resolves.toEqual({ count: 0 });
  });
});
