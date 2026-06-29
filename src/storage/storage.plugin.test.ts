/**
 * storage.plugin.test.ts
 *
 * Exercises storage HTTP routes through the real Elysia lifecycle. The focus
 * is plugin-owned auth dependency declaration, route validation, and service
 * authorization behavior for private, public, owner, and admin access.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createAuthPlugin, getAuthStore, getTokenService } from '../auth/auth.plugin';
import type { UserRecord } from '../auth/types';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { createStoragePlugin, getStorageService } from './storage.plugin';
import type { DriveRecord, DriveUsage, StorageAdapter } from './types';

let db: ReactiveDB;
let app: ReturnType<typeof createApp> | null = null;
let baseUrl = '';

function createTestAdapter(): StorageAdapter {
  return {
    async writeBlob() {
      return {
        checksum: `test_${crypto.randomUUID()}`,
        size: 0,
        headBytes: new Uint8Array(),
      };
    },
    async readBlob() {
      return null;
    },
    async readBlobRange() {
      return null;
    },
    async removeBlob() {},
    async blobExists() {
      return false;
    },
    async blobSize() {
      return 0;
    },
  };
}

function createApp(db: ReactiveDB) {
  return new Elysia()
    .use(createAuthPlugin({ db }))
    .use(createStoragePlugin({ db, adapter: createTestAdapter() }))
    .listen(0);
}

async function waitForPlugins(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (getAuthStore() && getTokenService() && getStorageService()) return;
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

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  token?: string
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data: data as T };
}

async function createDrive(
  token: string,
  body: { name: string; public?: boolean } = { name: 'Docs' }
): Promise<{ status: number; data: DriveRecord }> {
  return requestJson<DriveRecord>(
    '/storage/drives',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    token
  );
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

describe('storage route auth', () => {
  test('canonical grouped service aliases cover drives, objects, and permissions', async () => {
    const { user } = await createUser();
    const service = getStorageService()!;
    const drive = service.drives.create(user.userId, { name: 'Alias docs' });

    expect(service.drives.get(drive.drive_id)?.name).toBe('Alias docs');
    expect(service.drives.update(drive.drive_id, { name: 'Alias docs updated' }).name).toBe('Alias docs updated');
    expect(service.drives.list().some((item) => item.drive_id === drive.drive_id)).toBe(true);
    expect(service.drives.usage(drive.drive_id).driveId).toBe(drive.drive_id);

    const folder = service.objects.createFolder(drive.drive_id, '/reports', user.userId);
    expect(folder.path).toBe('/reports');
    expect(service.objects.get(drive.drive_id, '/reports')?.type).toBe('folder');
    expect(service.objects.list(drive.drive_id).items.some((item) => item.path === '/reports')).toBe(true);

    const permission = service.permissions.grant(drive.drive_id, {
      grantType: 'role',
      grantValue: 'editor',
      permission: 'read',
    });
    expect(service.permissions.get(permission.permission_id)?.grant_value).toBe('editor');
    expect(service.permissions.checkAccess(drive.drive_id, null, 'someone', 'editor', {}, 'read')).toBe(true);
    expect(service.permissions.revoke(permission.permission_id)).toBe(true);

    expect(await service.objects.delete(drive.drive_id, '/reports')).toBe(true);
    expect(service.drives.delete(drive.drive_id)).toBe(true);
  });

  test('requires auth for creating drives', async () => {
    const result = await requestJson<{ code: string; error: string }>(
      '/storage/drives',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Private' }),
      }
    );

    expect(result.status).toBe(401);
    expect(result.data.code).toBe('UNAUTHORIZED');
  });

  test('lists private drives only for the owner', async () => {
    const { token } = await createUser();
    const created = await createDrive(token, { name: 'Private docs' });

    expect(created.status).toBe(200);
    expect(created.data.owner_id).toBeTruthy();
    expect(created.data.public).toBe(0);

    const anonymous = await requestJson<DriveRecord[]>('/storage/drives');
    expect(anonymous.status).toBe(200);
    expect(anonymous.data.some((drive) => drive.drive_id === created.data.drive_id)).toBe(false);

    const owner = await requestJson<DriveRecord[]>('/storage/drives', {}, token);
    expect(owner.status).toBe(200);
    expect(owner.data.some((drive) => drive.drive_id === created.data.drive_id)).toBe(true);
  });

  test('keeps public drives readable without auth', async () => {
    const { token } = await createUser();
    const created = await createDrive(token, { name: 'Public docs', public: true });

    expect(created.status).toBe(200);
    expect(created.data.public).toBe(1);

    const listed = await requestJson<DriveRecord[]>('/storage/drives');
    expect(listed.status).toBe(200);
    expect(listed.data.some((drive) => drive.drive_id === created.data.drive_id)).toBe(true);

    const fetched = await requestJson<DriveRecord>(`/storage/drives/${created.data.drive_id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.data.drive_id).toBe(created.data.drive_id);
  });

  test('protects private read endpoints and allows the owner', async () => {
    const { token } = await createUser();
    const created = await createDrive(token, { name: 'Usage docs' });

    const anonymous = await requestJson<{ error: string }>(
      `/storage/drives/${created.data.drive_id}/usage`
    );
    expect(anonymous.status).toBe(401);

    const owner = await requestJson<DriveUsage>(
      `/storage/drives/${created.data.drive_id}/usage`,
      {},
      token
    );
    expect(owner.status).toBe(200);
    expect(owner.data.driveId).toBe(created.data.drive_id);
  });

  test('limits drive updates to owner or platform admin', async () => {
    const owner = await createUser();
    const other = await createUser();
    const admin = await createUser('admin');
    const created = await createDrive(owner.token, { name: 'Owner docs' });

    const forbidden = await requestJson<{ error: string }>(
      `/storage/drives/${created.data.drive_id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Other edit' }),
      },
      other.token
    );
    expect(forbidden.status).toBe(403);

    const ownerEdit = await requestJson<DriveRecord>(
      `/storage/drives/${created.data.drive_id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Owner edit' }),
      },
      owner.token
    );
    expect(ownerEdit.status).toBe(200);
    expect(ownerEdit.data.name).toBe('Owner edit');

    const adminEdit = await requestJson<DriveRecord>(
      `/storage/drives/${created.data.drive_id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Admin edit' }),
      },
      admin.token
    );
    expect(adminEdit.status).toBe(200);
    expect(adminEdit.data.name).toBe('Admin edit');
  });
});
