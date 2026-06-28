/**
 * notification.plugin.test.ts
 *
 * Exercises notification HTTP routes through the real Elysia lifecycle. Service
 * unit behavior is covered by direct state checks here; the focus is auth,
 * validation, and server-owned receipt mutation paths.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { createAuthPlugin, getAuthStore, getTokenService } from '../auth/auth.plugin';
import { createAuthMiddleware } from '../auth/auth.middleware';
import { createNotificationPlugin, getNotificationService } from './notification.plugin';
import type { NotificationRecord, NotificationReceiptRecord } from './types';
import type { UserRecord } from '../auth/types';

let db: ReactiveDB;
let app: ReturnType<typeof createApp> | null = null;
let baseUrl = '';

function createApp(db: ReactiveDB) {
  return new Elysia()
    .use(createAuthPlugin({ db }))
    .use(createAuthMiddleware(getTokenService))
    .use(createNotificationPlugin({ db }))
    .listen(0);
}

async function waitForPlugins(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (getAuthStore() && getTokenService() && getNotificationService()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Plugins did not start');
}

async function createUser(role = 'user'): Promise<{
  user: UserRecord;
  token: string;
}> {
  const suffix = crypto.randomUUID();
  const user = await getAuthStore()!.createUser({
    username: `${role}_${suffix}`,
    email: `${role}_${suffix}@test.local`,
    password: 'password123',
    role,
  });
  const tokens = await getTokenService()!.issueTokenPair(user);
  return { user, token: tokens.accessToken };
}

async function post(path: string, token?: string): Promise<{
  status: number;
  data: Record<string, unknown>;
}> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data: data as Record<string, unknown> };
}

function createNotification(userId: string, title: string): NotificationRecord {
  return getNotificationService()!.notify(userId, { title });
}

function getReceipt(notificationId: string, userId: string): NotificationReceiptRecord | null {
  const receiptId = `r_${notificationId}_${userId}`;
  return db.queryOne('notification_receipts', receiptId) as NotificationReceiptRecord | null;
}

beforeAll(async () => {
  db = createReactiveDB({ mode: 'memory' });
  app = createApp(db);
  baseUrl = `http://localhost:${app.server!.port}`;
  await waitForPlugins();
});

afterAll(() => {
  app?.stop();
  app = null;
  db.dispose();
});

describe('notification receipt routes', () => {
  test('requires auth for receipt mutations', async () => {
    const { user } = await createUser();
    const notification = createNotification(user.userId, 'Needs auth');

    const result = await post(`/notifications/${notification.notification_id}/seen`);

    expect(result.status).toBe(401);
    expect(result.data.code).toBe('UNAUTHORIZED');
    expect(getReceipt(notification.notification_id, user.userId)).toBeNull();
  });

  test('marks one notification seen, read, and dismissed through HTTP routes', async () => {
    const { user, token } = await createUser();
    const notification = createNotification(user.userId, 'Route receipt');

    const seen = await post(`/notifications/${notification.notification_id}/seen`, token);
    expect(seen).toEqual({ status: 200, data: { ok: true } });

    const seenReceipt = getReceipt(notification.notification_id, user.userId);
    expect(typeof seenReceipt?.seen_at).toBe('number');
    expect(seenReceipt?.read_at).toBeNull();
    expect(seenReceipt?.dismissed_at).toBeNull();

    const read = await post(`/notifications/${notification.notification_id}/read`, token);
    expect(read).toEqual({ status: 200, data: { ok: true } });

    const readReceipt = getReceipt(notification.notification_id, user.userId);
    expect(typeof readReceipt?.seen_at).toBe('number');
    expect(typeof readReceipt?.read_at).toBe('number');
    expect(readReceipt?.dismissed_at).toBeNull();

    const dismissed = await post(`/notifications/${notification.notification_id}/dismiss`, token);
    expect(dismissed).toEqual({ status: 200, data: { ok: true } });

    const dismissedReceipt = getReceipt(notification.notification_id, user.userId);
    expect(typeof dismissedReceipt?.dismissed_at).toBe('number');
  });

  test('marks all visible notifications seen and read through HTTP routes', async () => {
    const { user, token } = await createUser();
    const { user: otherUser } = await createUser();

    const first = createNotification(user.userId, 'First');
    const second = createNotification(user.userId, 'Second');
    const hidden = createNotification(otherUser.userId, 'Other user');

    const seenAll = await post('/notifications/seen-all', token);
    expect(seenAll).toEqual({ status: 200, data: { ok: true } });

    expect(typeof getReceipt(first.notification_id, user.userId)?.seen_at).toBe('number');
    expect(typeof getReceipt(second.notification_id, user.userId)?.seen_at).toBe('number');
    expect(getReceipt(hidden.notification_id, user.userId)).toBeNull();

    const readAll = await post('/notifications/read-all', token);
    expect(readAll).toEqual({ status: 200, data: { ok: true } });

    expect(typeof getReceipt(first.notification_id, user.userId)?.read_at).toBe('number');
    expect(typeof getReceipt(second.notification_id, user.userId)?.read_at).toBe('number');
    expect(getReceipt(hidden.notification_id, user.userId)).toBeNull();
  });
});
