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
import { StorageDomainError } from './storage-domain-error';
import { createStoragePlugin, getStorageService } from './storage.plugin';
import type {
  DriveRecord,
  DriveRecordWithAccess,
  DriveUsage,
  FileInfo,
  ListResult,
  PermissionRecord,
  StorageAdapter,
  StorageAccessCapabilities,
  StorageUploadGrant,
} from './types';

let db: ReactiveDB;
let app: ReturnType<typeof createApp> | null = null;
let baseUrl = '';

function createTestAdapter(): StorageAdapter {
  return {
    writeShutdownSafety: 'cooperative',
    async writeBlob(data, maxSize) {
      const bytes = await readBytes(data);
      if (maxSize !== undefined && bytes.byteLength > maxSize) {
        throw new StorageDomainError(
          'STORAGE_LIMIT_EXCEEDED',
          'Storage upload exceeds the configured file-size limit.',
          { outcome: 'not-committed' },
        );
      }
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
    removeBlobSync() {},
    async blobExists() {
      return true;
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
    .use(createAuthPlugin({
      db,
      bootstrap: 'public',
      userProperties: {
        department: {
          type: 'string',
          editableBy: 'admin',
          useInPolicies: true,
        },
        selfReportedDepartment: {
          type: 'string',
          editableBy: 'user',
        },
      },
    }))
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

afterAll(async () => {
  await app?.stop(true);
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

  test('protects direct private drive reads from authenticated non-owners', async () => {
    const owner = await createUser();
    const other = await createUser();
    const created = await createDrive(owner.token, { name: 'Direct private docs' });

    const forbidden = await requestJson<{ error: string }>(
      `/storage/drives/${created.data.drive_id}`,
      {},
      other.token
    );

    expect(forbidden.status).toBe(403);

    const allowed = await requestJson<DriveRecordWithAccess>(
      `/storage/drives/${created.data.drive_id}`,
      {},
      owner.token
    );

    expect(allowed.status).toBe(200);
    expect(allowed.data.drive_id).toBe(created.data.drive_id);
    expect(allowed.data.access.canAdmin).toBe(true);
    expect(allowed.data.access.isOwner).toBe(true);
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

  test('allows anonymous read for public objects inside private drives', async () => {
    const { user } = await createUser();
    const service = getStorageService()!;
    const drive = service.drives.create(user.userId, { name: 'Private public files' });

    const info = await service.objects.upload(
      drive.drive_id,
      '/public/readme.txt',
      new TextEncoder().encode('ok'),
      'readme.txt',
      user.userId,
      { public: true },
    );

    const anonymousInfo = await requestJson<FileInfo>(
      `/storage/drives/${drive.drive_id}/info/public/readme.txt`
    );

    expect(anonymousInfo.status).toBe(200);
    expect(anonymousInfo.data.path).toBe(info.path);
    expect(anonymousInfo.data.isPublic).toBe(true);
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

  test('exposes effective storage capabilities and admin permission listing', async () => {
    const owner = await createUser();
    const editor = await createUser('editor');
    const qa = await createUser();
    getAuthStore()!.setProperty(qa.user.userId, 'department', 'qa');
    const created = await createDrive(owner.token, { name: 'Granted docs' });

    const roleGrant = await requestJson<PermissionRecord>(
      `/storage/drives/${created.data.drive_id}/permissions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          grantType: 'role',
          grantValue: 'editor',
          permission: 'write',
        }),
      },
      owner.token
    );
    expect(roleGrant.status).toBe(200);
    expect(roleGrant.data.grant_type).toBe('role');

    const propertyGrant = await requestJson<PermissionRecord>(
      `/storage/drives/${created.data.drive_id}/permissions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          grantType: 'property',
          grantKey: 'department',
          grantValue: 'qa',
          permission: 'read',
        }),
      },
      owner.token
    );
    expect(propertyGrant.status).toBe(200);
    expect(propertyGrant.data.grant_key).toBe('department');

    const untrustedPropertyGrant = await requestJson<{ error: string; code: string }>(
      `/storage/drives/${created.data.drive_id}/permissions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          grantType: 'property',
          grantKey: 'selfReportedDepartment',
          grantValue: 'qa',
          permission: 'read',
        }),
      },
      owner.token
    );
    expect(untrustedPropertyGrant.status).toBe(400);
    expect(untrustedPropertyGrant.data).toMatchObject({
      error: 'Storage input is invalid.',
      code: 'STORAGE_INPUT_INVALID',
    });

    const permissions = await requestJson<{ permissions: PermissionRecord[] }>(
      `/storage/drives/${created.data.drive_id}/permissions`,
      {},
      owner.token
    );
    expect(permissions.status).toBe(200);
    expect(permissions.data.permissions.map((item) => item.permission_id)).toContain(roleGrant.data.permission_id);
    expect(permissions.data.permissions.map((item) => item.permission_id)).toContain(propertyGrant.data.permission_id);

    const editorAccess = await requestJson<StorageAccessCapabilities>(
      `/storage/drives/${created.data.drive_id}/capabilities`,
      {},
      editor.token
    );
    expect(editorAccess.status).toBe(200);
    expect(editorAccess.data.canRead).toBe(true);
    expect(editorAccess.data.canWrite).toBe(true);
    expect(editorAccess.data.canAdmin).toBe(false);
    expect(editorAccess.data.effectiveAccess).toBe('write');

    const editorList = await requestJson<DriveRecordWithAccess[]>('/storage/drives', {}, editor.token);
    const listed = editorList.data.find((drive) => drive.drive_id === created.data.drive_id);
    expect(editorList.status).toBe(200);
    expect(listed?.access.effectiveAccess).toBe('write');

    const qaAccess = await requestJson<StorageAccessCapabilities>(
      `/storage/drives/${created.data.drive_id}/capabilities`,
      {},
      qa.token
    );
    expect(qaAccess.status).toBe(200);
    expect(qaAccess.data.effectiveAccess).toBe('read');

    const forbiddenPermissions = await requestJson<{ error: string }>(
      `/storage/drives/${created.data.drive_id}/permissions`,
      {},
      editor.token
    );
    expect(forbiddenPermissions.status).toBe(403);
  });

  test('ignores legacy property grants whose keys are not policy-trusted', async () => {
    const owner = await createUser();
    const member = await createUser();
    const service = getStorageService()!;
    const drive = service.drives.create(owner.user.userId, { name: 'Legacy property grant' });

    getAuthStore()!.setProperty(
      member.user.userId,
      'selfReportedDepartment',
      'qa'
    );
    db.prepare(`
      INSERT INTO _storage_permissions (
        permission_id, drive_id, object_id, grant_type,
        grant_key, grant_value, permission, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `perm_${crypto.randomUUID()}`,
      drive.drive_id,
      null,
      'property',
      'selfReportedDepartment',
      'qa',
      'read',
      Date.now()
    );

    expect(service.permissions.checkAccess(
      drive.drive_id,
      null,
      member.user.userId,
      member.user.role,
      { selfReportedDepartment: 'qa' },
      'read'
    )).toBe(false);
  });

  test('honors object-scoped grants on object routes and cleans grants on delete', async () => {
    const owner = await createUser();
    const collaborator = await createUser();
    const service = getStorageService()!;
    const drive = service.drives.create(owner.user.userId, { name: 'Object grant docs' });

    await service.objects.upload(
      drive.drive_id,
      '/shared/note.txt',
      new TextEncoder().encode('shared'),
      'note.txt',
      owner.user.userId,
    );

    const grant = await requestJson<PermissionRecord>(
      `/storage/drives/${drive.drive_id}/permissions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          objectPath: '/shared/note.txt',
          grantType: 'user',
          grantValue: collaborator.user.userId,
          permission: 'write',
        }),
      },
      owner.token,
    );
    expect(grant.status).toBe(200);
    expect(grant.data.object_id).toBeTruthy();

    const driveRead = await requestJson<{ error: string }>(
      `/storage/drives/${drive.drive_id}`,
      {},
      collaborator.token,
    );
    expect(driveRead.status).toBe(403);

    const objectAccess = await requestJson<StorageAccessCapabilities>(
      `/storage/drives/${drive.drive_id}/capabilities?path=${encodeURIComponent('/shared/note.txt')}`,
      {},
      collaborator.token,
    );
    expect(objectAccess.status).toBe(200);
    expect(objectAccess.data.effectiveAccess).toBe('write');

    const objectInfo = await requestJson<FileInfo>(
      `/storage/drives/${drive.drive_id}/info/shared/note.txt`,
      {},
      collaborator.token,
    );
    expect(objectInfo.status).toBe(200);
    expect(objectInfo.data.path).toBe('/shared/note.txt');

    const deleted = await requestJson<{ ok: boolean }>(
      `/storage/drives/${drive.drive_id}/files/shared/note.txt`,
      { method: 'DELETE' },
      collaborator.token,
    );
    expect(deleted.status).toBe(200);
    expect(deleted.data.ok).toBe(true);
    expect(service.permissions.get(grant.data.permission_id)).toBeNull();
  });

  test('updates bounded object metadata through the ACL-checked info resource', async () => {
    const owner = await createUser();
    const reader = await createUser();
    const service = getStorageService()!;
    const drive = service.drives.create(owner.user.userId, { name: 'Metadata docs' });
    await service.objects.upload(
      drive.drive_id,
      '/records/note.txt',
      new TextEncoder().encode('note'),
      'note.txt',
      owner.user.userId,
      { metadata: { version: 1 } },
    );
    service.permissions.grant(drive.drive_id, {
      objectPath: '/records/note.txt',
      grantType: 'user',
      grantValue: reader.user.userId,
      permission: 'read',
    });

    const denied = await requestJson<{ code: string }>(
      `/storage/drives/${drive.drive_id}/info/records/note.txt`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ metadata: { version: 2 } }),
      },
      reader.token,
    );
    expect(denied.status).toBe(403);
    expect(denied.data.code).toBe('STORAGE_AUTHORITY_REQUIRED');

    const updated = await requestJson<FileInfo>(
      `/storage/drives/${drive.drive_id}/info/records/note.txt`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ metadata: { version: 2, reviewed: true } }),
      },
      owner.token,
    );
    expect(updated.status).toBe(200);
    expect(updated.data.metadata).toEqual({ version: 2, reviewed: true });

    const oversized = await requestJson<{ code: string }>(
      `/storage/drives/${drive.drive_id}/info/records/note.txt`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ metadata: { payload: 'x'.repeat(17 * 1024) } }),
      },
      owner.token,
    );
    expect(oversized.status).toBe(400);
    expect(oversized.data.code).toBe('STORAGE_METADATA_INVALID');
    expect(service.objects.get(drive.drive_id, '/records/note.txt')?.metadata)
      .toEqual({ version: 2, reviewed: true });
  });

  test('requires destination write authority for copy and move routes', async () => {
    const owner = await createUser();
    const collaborator = await createUser();
    const service = getStorageService()!;
    const drive = service.drives.create(owner.user.userId, { name: 'Move boundary' });
    await service.objects.upload(
      drive.drive_id,
      '/source.txt',
      new TextEncoder().encode('source'),
      'source.txt',
      owner.user.userId,
    );
    service.permissions.grant(drive.drive_id, {
      objectPath: '/source.txt',
      grantType: 'user',
      grantValue: collaborator.user.userId,
      permission: 'write',
    });

    for (const operation of ['copy', 'move'] as const) {
      const denied = await requestJson<{ error: string }>(
        `/storage/drives/${drive.drive_id}/${operation}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            from: '/source.txt',
            to: `/unauthorized-${operation}.txt`,
          }),
        },
        collaborator.token,
      );
      expect(denied.status).toBe(403);
      expect(service.objects.get(
        drive.drive_id,
        `/unauthorized-${operation}.txt`,
      )).toBeNull();
    }
    expect(service.objects.get(drive.drive_id, '/source.txt')).not.toBeNull();

    service.permissions.grant(drive.drive_id, {
      grantType: 'user',
      grantValue: collaborator.user.userId,
      permission: 'write',
    });
    const copied = await requestJson<FileInfo>(
      `/storage/drives/${drive.drive_id}/copy`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from: '/source.txt',
          to: '/authorized-copy.txt',
        }),
      },
      collaborator.token,
    );
    expect(copied.status).toBe(200);
    expect(copied.data.path).toBe('/authorized-copy.txt');

    const moved = await requestJson<FileInfo>(
      `/storage/drives/${drive.drive_id}/move`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from: '/source.txt',
          to: '/authorized-move.txt',
        }),
      },
      collaborator.token,
    );
    expect(moved.status).toBe(200);
    expect(moved.data.path).toBe('/authorized-move.txt');
  });

  test('applies folder listing type filters, sorting, and totals consistently', async () => {
    const { user, token } = await createUser();
    const service = getStorageService()!;
    const drive = service.drives.create(user.userId, { name: 'Sorted docs' });

    service.objects.createFolder(drive.drive_id, '/zeta-folder', user.userId);
    await service.objects.upload(
      drive.drive_id,
      '/alpha.txt',
      new TextEncoder().encode('a'),
      'alpha.txt',
      user.userId,
    );
    await service.objects.upload(
      drive.drive_id,
      '/beta.txt',
      new TextEncoder().encode('b'),
      'beta.txt',
      user.userId,
    );

    const files = await requestJson<ListResult>(
      `/storage/drives/${drive.drive_id}/list?type=file&sortBy=name&sortDir=desc`,
      {},
      token
    );
    expect(files.status).toBe(200);
    expect(files.data.total).toBe(2);
    expect(files.data.items.map((item) => item.name)).toEqual(['beta.txt', 'alpha.txt']);

    const folders = await requestJson<ListResult>(
      `/storage/drives/${drive.drive_id}/list?type=folder`,
      {},
      token
    );
    expect(folders.status).toBe(200);
    expect(folders.data.total).toBe(1);
    expect(folders.data.items[0]?.name).toBe('zeta-folder');
  });

  test('searches the complete immediate-child result set with literal wildcard semantics', async () => {
    const { user, token } = await createUser();
    const service = getStorageService()!;
    const drive = service.drives.create(user.userId, { name: 'Search docs' });

    service.objects.createFolder(drive.drive_id, '/reports', user.userId);
    for (const name of ['Invoice One.txt', 'invoice two.txt', 'Case_100%.txt', 'CaseA100X.txt']) {
      await service.objects.upload(
        drive.drive_id,
        `/reports/${name}`,
        new TextEncoder().encode(name),
        name,
        user.userId,
      );
    }

    const legacy = await requestJson<ListResult>(
      `/storage/drives/${drive.drive_id}/list?path=%2Freports&sortBy=name`,
      {},
      token,
    );
    expect(legacy.status).toBe(200);
    expect(legacy.data.total).toBe(4);

    const first = await requestJson<ListResult>(
      `/storage/drives/${drive.drive_id}/list?path=%2Freports&search=INVOICE&limit=1&sortBy=name`,
      {},
      token,
    );
    expect(first.status).toBe(200);
    expect(first.data.total).toBe(2);
    expect(first.data.items).toHaveLength(1);
    expect(first.data.cursor).toBe('1');

    const second = await requestJson<ListResult>(
      `/storage/drives/${drive.drive_id}/list?path=%2Freports&search=invoice&limit=1&cursor=${first.data.cursor}`,
      {},
      token,
    );
    expect(second.status).toBe(200);
    expect(second.data.total).toBe(2);
    expect(second.data.items).toHaveLength(1);
    expect(second.data.cursor).toBeNull();

    const literal = await requestJson<ListResult>(
      `/storage/drives/${drive.drive_id}/list?path=%2Freports&search=${encodeURIComponent('case_100%')}`,
      {},
      token,
    );
    expect(literal.status).toBe(200);
    expect(literal.data.total).toBe(1);
    expect(literal.data.items[0]?.name).toBe('Case_100%.txt');

    const blank = service.objects.list(drive.drive_id, '/reports', { search: '   ' });
    expect(blank.total).toBe(4);

    for (const cursor of ['1junk', '-1', '01', '1000000001']) {
      expect(() => service.objects.list(drive.drive_id, '/reports', { cursor }))
        .toThrow(expect.objectContaining({ code: 'STORAGE_INPUT_INVALID' }));
      const invalid = await requestJson<{ code: string }>(
        `/storage/drives/${drive.drive_id}/list?path=%2Freports&cursor=${cursor}`,
        {},
        token,
      );
      expect(invalid.status).toBe(400);
      expect(invalid.data.code).toBe('STORAGE_INPUT_INVALID');
    }
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

  test('streams bearer uploads through bounded enforcement and verifies detected MIME', async () => {
    const { token } = await createUser();
    const created = await createDrive(token, { name: 'Bounded bearer uploads' });
    const oversizedGrant = await requestJson<StorageUploadGrant>(
      `/storage/drives/${created.data.drive_id}/upload-grants`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: '/bounded/oversized.txt',
          expiresIn: 60,
          maxSize: 5,
          contentType: 'text/plain',
        }),
      },
      token,
    );
    expect(oversizedGrant.status).toBe(200);

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('1234'));
        controller.enqueue(new TextEncoder().encode('5678'));
        controller.close();
      },
    });
    const overflow = await fetch(
      `${baseUrl}/storage/upload-grants/${oversizedGrant.data.token}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'text/plain' },
        body,
      },
    );
    expect(overflow.status).toBe(413);
    expect(await overflow.json()).toMatchObject({ code: 'STORAGE_LIMIT_EXCEEDED' });
    expect(getStorageService()!.getFileInfo(
      created.data.drive_id,
      '/bounded/oversized.txt',
    )).toBeNull();

    const mimeGrant = await requestJson<StorageUploadGrant>(
      `/storage/drives/${created.data.drive_id}/upload-grants`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: '/bounded/spoofed.png',
          expiresIn: 60,
          maxSize: 100,
          contentType: 'image/png',
        }),
      },
      token,
    );
    const spoofed = await requestJson<{ code: string }>(
      `/storage/upload-grants/${mimeGrant.data.token}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'image/png' },
        body: 'this is plain text, not a png',
      },
    );
    expect(spoofed.status).toBe(415);
    expect(spoofed.data.code).toBe('STORAGE_CONTENT_TYPE_UNSUPPORTED');
    expect(getStorageService()!.getFileInfo(
      created.data.drive_id,
      '/bounded/spoofed.png',
    )).toBeNull();
  });
});
