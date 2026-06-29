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
import type {
  DriveRecord,
  DriveUsage,
  FileInfo,
  StorageAdapter,
  StorageUploadGrant,
} from './types';

let db: ReactiveDB;
let app: ReturnType<typeof createApp> | null = null;
let baseUrl = '';

function createTestAdapter(): StorageAdapter {
  return {
    async writeBlob(data) {
      const bytes = await readBytes(data);
      return {
        checksum: `test_${crypto.randomUUID()}`,
        size: bytes.length,
        headBytes: bytes.slice(0, 512),
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

async function readBytes(data: ReadableStream<Uint8Array> | Uint8Array | Blob): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data;
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());

  const reader = data.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    total += value.length;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
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
  test('canonical grouped service aliases cover drives, objects, permissions, and uploads', async () => {
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

    const uploadGrant = await service.uploads.create(drive.drive_id, {
      path: '/reports/direct-grant.txt',
      expiresIn: 60,
    });
    expect(uploadGrant.driveId).toBe(drive.drive_id);
    expect(uploadGrant.path).toBe('/reports/direct-grant.txt');
    expect(uploadGrant.token.length).toBeGreaterThan(20);

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

  test('creates scoped upload grants that allow public upload but keep private read policy', async () => {
    const { token } = await createUser();
    const created = await createDrive(token, { name: 'Intake uploads' });

    const grant = await requestJson<StorageUploadGrant>(
      `/storage/drives/${created.data.drive_id}/upload-grants`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: '/intake/int_1/id-front.png',
          expiresIn: 60,
          maxSize: 1024,
          contentTypes: ['image/png', 'image/jpeg'],
          metadata: { intakeId: 'int_1', kind: 'id-front' },
          flow: 'intake',
          resource: { type: 'intake', id: 'int_1' },
        }),
      },
      token
    );

    expect(grant.status).toBe(200);
    expect(grant.data.public).toBe(false);
    expect(grant.data.overwrite).toBe(false);
    expect(grant.data.contentTypes).toEqual(['image/png', 'image/jpeg']);

    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    const uploaded = await requestJson<FileInfo>(
      `/storage/upload-grants/${grant.data.token}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'image/png' },
        body: new Blob([pngBytes], { type: 'image/png' }),
      }
    );

    expect(uploaded.status).toBe(201);
    expect(uploaded.data.path).toBe('/intake/int_1/id-front.png');
    expect(uploaded.data.isPublic).toBe(false);
    expect(uploaded.data.createdBy).toBeNull();
    expect(uploaded.data.metadata.intakeId).toBe('int_1');
    expect(uploaded.data.metadata.storageUploadGrantId).toBe(grant.data.grantId);
    expect(uploaded.data.metadata.storageUploadResourceType).toBe('intake');

    const anonymousInfo = await requestJson<{ error: string }>(
      `/storage/drives/${created.data.drive_id}/info/intake/int_1/id-front.png`
    );
    expect(anonymousInfo.status).toBe(401);

    const ownerInfo = await requestJson<FileInfo>(
      `/storage/drives/${created.data.drive_id}/info/intake/int_1/id-front.png`,
      {},
      token
    );
    expect(ownerInfo.status).toBe(200);
    expect(ownerInfo.data.path).toBe(uploaded.data.path);
  });

  test('rejects upload grant creation without write access', async () => {
    const owner = await createUser();
    const other = await createUser();
    const created = await createDrive(owner.token, { name: 'Private uploads' });

    const forbidden = await requestJson<{ error: string }>(
      `/storage/drives/${created.data.drive_id}/upload-grants`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: '/blocked.txt' }),
      },
      other.token
    );

    expect(forbidden.status).toBe(403);

    const anonymous = await requestJson<{ code: string }>(
      `/storage/drives/${created.data.drive_id}/upload-grants`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: '/blocked.txt' }),
      }
    );

    expect(anonymous.status).toBe(401);
  });

  test('enforces upload grant max size, content type, and no-overwrite default', async () => {
    const { token } = await createUser();
    const created = await createDrive(token, { name: 'Strict uploads' });

    const grant = await requestJson<StorageUploadGrant>(
      `/storage/drives/${created.data.drive_id}/upload-grants`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: '/strict/document.txt',
          expiresIn: 60,
          maxSize: 5,
          contentType: 'text/plain',
        }),
      },
      token
    );

    expect(grant.status).toBe(200);

    const wrongType = await requestJson<{ error: string }>(
      `/storage/upload-grants/${grant.data.token}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }
    );
    expect(wrongType.status).toBe(400);

    const tooLarge = await requestJson<{ error: string }>(
      `/storage/upload-grants/${grant.data.token}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'text/plain' },
        body: 'too large',
      }
    );
    expect(tooLarge.status).toBe(413);

    const first = await requestJson<FileInfo>(
      `/storage/upload-grants/${grant.data.token}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'text/plain' },
        body: 'ok',
      }
    );
    expect(first.status).toBe(201);

    const second = await requestJson<{ error: string }>(
      `/storage/upload-grants/${grant.data.token}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'text/plain' },
        body: 'ok',
      }
    );
    expect(second.status).toBe(409);
  });
});
