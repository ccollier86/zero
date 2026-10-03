/** Managed-drive ingress, generation, and concurrent quota regression tests. */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { createPresignedToken, verifyPresignedToken } from './presigned';
import { resolveStorageStudioConfig } from './storage-config';
import { defineStorageTables, StorageService } from './storage-service';
import { StorageStudioIngressPolicy } from './storage-studio-ingress-policy';
import { StorageStudioQuotaPolicy } from './storage-studio-quota-policy';
import { defineStorageStudioTables, type StorageStudioDriveProfile } from './storage-studio-schema';
import { StorageStudioStore } from './storage-studio-store';
import type { StorageAdapter } from './types';
import { createUploadGrantToken, verifyUploadGrantToken } from './upload-grant';

const USER_ID = 'user_one';
const SECRET = 'storage-ingress-test-secret-at-least-32-bytes';

let db: ReactiveDB;
let adapter: MemoryAdapter;

beforeEach(() => {
  db = createReactiveDB({ mode: 'memory' });
  defineIdentityFixtures(db);
  defineStorageTables(db);
  defineStorageStudioTables(db);
  adapter = new MemoryAdapter();
});

afterEach(() => db.dispose());

describe('Storage Studio ingress policy', () => {
  test('binds signed capabilities to the current ready generation', async () => {
    const config = resolveStorageStudioConfig({ enabled: true });
    const storage = new StorageService(db, adapter);
    const drive = storage.createDrive(USER_ID, { name: 'Artifacts' });
    insertReadyProfile(drive.drive_id);
    const ingress = new StorageStudioIngressPolicy(db, config);
    const issued = ingress.capabilityForIssue(drive.drive_id, 60);
    expect(issued.generation).toBe(1);

    const presigned = await createPresignedToken({
      driveId: drive.drive_id,
      path: '/artifact.txt',
      method: 'download',
      expiresIn: 60,
      secret: SECRET,
      generation: issued.generation,
    });
    const verifiedPresigned = await verifyPresignedToken(presigned, SECRET);
    expect(verifiedPresigned?.generation).toBe(1);
    ingress.assertCapabilityCurrent(drive.drive_id, verifiedPresigned?.generation);

    const upload = await createUploadGrantToken({
      driveId: drive.drive_id,
      path: '/artifact.txt',
      expiresIn: 60,
      secret: SECRET,
      generation: issued.generation,
    });
    const verifiedUpload = await verifyUploadGrantToken(upload.token, SECRET);
    expect(verifiedUpload?.generation).toBe(1);

    advanceProfile(drive.drive_id, 'ready', 2);
    expect(() => ingress.assertCapabilityCurrent(drive.drive_id, 1))
      .toThrow(expect.objectContaining({ code: 'STORAGE_CAPABILITY_INVALID' }));
    expect(() => ingress.assertCapabilityCurrent(drive.drive_id, undefined))
      .toThrow(expect.objectContaining({ code: 'STORAGE_CAPABILITY_INVALID' }));

    advanceProfile(drive.drive_id, 'suspended', 3);
    expect(() => ingress.assertCapabilityCurrent(drive.drive_id, 3))
      .toThrow(expect.objectContaining({ code: 'STORAGE_POLICY_VIOLATION' }));
  });

  test('prevents legacy managed-drive control and disallowed public objects', () => {
    const config = resolveStorageStudioConfig({
      enabled: true,
      publicAccess: { allowPublicObjects: false },
    });
    const ingress = new StorageStudioIngressPolicy(db, config);
    const storage = new StorageService(db, adapter, { managedObjectPolicy: ingress });
    expect(() => storage.createDrive(USER_ID, { name: 'Unmanaged bypass' }))
      .toThrow(expect.objectContaining({ code: 'STORAGE_POLICY_VIOLATION' }));
    const drive = storage.createDriveRecord({
      driveId: `drv_${crypto.randomUUID()}`,
      ownerId: USER_ID,
      params: { name: 'Private artifacts' },
    });
    insertReadyProfile(drive.drive_id);

    expect(() => ingress.assertLegacyDriveCreationAllowed())
      .toThrow(expect.objectContaining({ code: 'STORAGE_POLICY_VIOLATION' }));
    expect(() => ingress.assertLegacyDriveControlAllowed(drive.drive_id))
      .toThrow(expect.objectContaining({ code: 'STORAGE_POLICY_VIOLATION' }));
    expect(() => storage.updateDrive(drive.drive_id, { name: 'Bypass' }))
      .toThrow(expect.objectContaining({ code: 'STORAGE_POLICY_VIOLATION' }));
    expect(() => storage.setDriveVisibility(drive.drive_id, true))
      .toThrow(expect.objectContaining({ code: 'STORAGE_POLICY_VIOLATION' }));
    expect(() => storage.deleteDrive(drive.drive_id))
      .toThrow(expect.objectContaining({ code: 'STORAGE_POLICY_VIOLATION' }));
    expect(() => ingress.assertObjectVisibilityAllowed(drive.drive_id, true))
      .toThrow(expect.objectContaining({ code: 'STORAGE_POLICY_VIOLATION' }));
    expect(() => ingress.assertObjectVisibilityAllowed(drive.drive_id, false)).not.toThrow();
  });
});

describe('Storage Studio quota admission', () => {
  test('atomically admits concurrent bytes and releases durable capacity', () => {
    const config = resolveStorageStudioConfig({
      enabled: true,
      limits: { maxConcurrentUploadBytes: 10 },
    });
    const storage = new StorageService(db, adapter);
    const drive = storage.createDrive(USER_ID, { name: 'Quota drive' });
    insertReadyProfile(drive.drive_id);
    const quotas = new StorageStudioQuotaPolicy(db, config);

    const first = quotas.begin(drive.drive_id, 6)!;
    expect(() => quotas.begin(drive.drive_id, 5))
      .toThrow(expect.objectContaining({ code: 'STORAGE_QUOTA_EXCEEDED' }));
    const second = quotas.begin(drive.drive_id, 4)!;
    expect(activeReservedBytes(drive.drive_id)).toBe(10);
    first.release();
    second.commit();
    expect(activeReservedBytes(drive.drive_id)).toBe(0);
  });

  test('rejects an overlapping engine upload before a second adapter write begins', async () => {
    const config = resolveStorageStudioConfig({
      enabled: true,
      limits: { maxConcurrentUploadBytes: 10 },
    });
    const quotas = new StorageStudioQuotaPolicy(db, config);
    const blockedAdapter = new MemoryAdapter(true);
    const storage = new StorageService(db, blockedAdapter, { uploadAdmission: quotas });
    const drive = storage.createDrive(USER_ID, { name: 'Concurrent uploads' });
    insertReadyProfile(drive.drive_id);

    const first = storage.upload(
      drive.drive_id,
      '/first.bin',
      new Uint8Array(6),
      'first.bin',
      USER_ID,
    );
    await blockedAdapter.waitUntilBlocked();
    await expect(storage.upload(
      drive.drive_id,
      '/second.bin',
      new Uint8Array(5),
      'second.bin',
      USER_ID,
    )).rejects.toMatchObject({ code: 'STORAGE_QUOTA_EXCEEDED' });
    expect(blockedAdapter.writeCount).toBe(1);
    blockedAdapter.release();
    await first;
    expect(activeReservedBytes(drive.drive_id)).toBe(0);
  });

  test('revalidates the exact quota reservation inside final metadata commit', async () => {
    const config = resolveStorageStudioConfig({
      enabled: true,
      limits: { maxConcurrentUploadBytes: 10 },
    });
    const quotas = new StorageStudioQuotaPolicy(db, config);
    const storage = new StorageService(db, adapter, { uploadAdmission: quotas });
    const drive = storage.createDrive(USER_ID, { name: 'Commit-fenced quota' });
    insertReadyProfile(drive.drive_id);
    await storage.upload(
      drive.drive_id,
      '/target.bin',
      new Uint8Array([1]),
      'target.bin',
      USER_ID,
    );

    let entered!: () => void;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const reachedFence = new Promise<void>((resolve) => { entered = resolve; });
    const lockHolder = storage.upload(
      drive.drive_id,
      '/target.bin',
      new Uint8Array([2]),
      'target.bin',
      USER_ID,
      { overwrite: true },
      undefined,
      async () => {
        entered();
        await held;
      },
    );
    await reachedFence;
    const stale = storage.upload(
      drive.drive_id,
      '/target.bin',
      new Uint8Array(6),
      'target.bin',
      USER_ID,
      { overwrite: true },
    );
    const staleSettled = Promise.allSettled([stale]);
    await Bun.sleep(0);
    db.prepare(`
      UPDATE _storage_quota_reservations SET expires_at = created_at + 1
      WHERE drive_id = ? AND status = 'active' AND reserved_bytes = 6
    `).run(drive.drive_id);
    await Bun.sleep(2);
    const replacement = quotas.begin(drive.drive_id, 9)!;
    release();
    await lockHolder;

    expect(await staleSettled).toMatchObject([{
      status: 'rejected',
      reason: { code: 'STORAGE_OPERATION_IN_PROGRESS' },
    }]);
    expect(storage.getFileInfo(drive.drive_id, '/target.bin')?.sizeBytes).toBe(1);
    replacement.release();
  });

  test('rejects staged publication after a suspend-resume generation change', async () => {
    const config = resolveStorageStudioConfig({ enabled: true });
    const ingress = new StorageStudioIngressPolicy(db, config);
    const blockedAdapter = new MemoryAdapter(true);
    const storage = new StorageService(db, blockedAdapter, { managedObjectPolicy: ingress });
    const drive = storage.createDriveRecord({
      driveId: `drv_${crypto.randomUUID()}`,
      ownerId: USER_ID,
      params: { name: 'Generation fence' },
    });
    insertReadyProfile(drive.drive_id);

    const upload = storage.upload(
      drive.drive_id,
      '/stale.bin',
      new Uint8Array([1]),
      'stale.bin',
      USER_ID,
    );
    await blockedAdapter.waitUntilBlocked();
    advanceProfile(drive.drive_id, 'suspended', 2);
    advanceProfile(drive.drive_id, 'ready', 2);
    blockedAdapter.release();

    await expect(upload).rejects.toMatchObject({ code: 'STORAGE_AUTHORITY_CHANGED' });
    expect(storage.getFileInfo(drive.drive_id, '/stale.bin')).toBeNull();
  });

  test('rejects staged publication when a managed drive becomes suspended', async () => {
    const config = resolveStorageStudioConfig({ enabled: true });
    const ingress = new StorageStudioIngressPolicy(db, config);
    const blockedAdapter = new MemoryAdapter(true);
    const storage = new StorageService(db, blockedAdapter, { managedObjectPolicy: ingress });
    const drive = storage.createDriveRecord({
      driveId: `drv_${crypto.randomUUID()}`,
      ownerId: USER_ID,
      params: { name: 'Suspension fence' },
    });
    insertReadyProfile(drive.drive_id);

    const upload = storage.upload(
      drive.drive_id,
      '/suspended.bin',
      new Uint8Array([1]),
      'suspended.bin',
      USER_ID,
    );
    await blockedAdapter.waitUntilBlocked();
    advanceProfile(drive.drive_id, 'suspended', 2);
    blockedAdapter.release();

    await expect(upload).rejects.toMatchObject({ code: 'STORAGE_POLICY_VIOLATION' });
    expect(objectCount(drive.drive_id)).toBe(0);
  });

  test('generation-fences raw move, copy, and delete after waiting on path locks', async () => {
    const ingress = new StorageStudioIngressPolicy(
      db,
      resolveStorageStudioConfig({ enabled: true }),
    );
    const storage = new StorageService(db, adapter, { managedObjectPolicy: ingress });
    const drive = storage.createDriveRecord({
      driveId: `drv_${crypto.randomUUID()}`,
      ownerId: USER_ID,
      params: { name: 'Raw mutation generation fence' },
    });
    insertReadyProfile(drive.drive_id);

    for (const operation of ['move', 'copy', 'delete'] as const) {
      const source = `/${operation}-source.bin`;
      const target = `/${operation}-target.bin`;
      await storage.upload(
        drive.drive_id,
        source,
        new Uint8Array([1]),
        `${operation}-source.bin`,
        USER_ID,
      );
      let entered!: () => void;
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      const reachedFence = new Promise<void>((resolve) => { entered = resolve; });
      const lockHolder = storage.upload(
        drive.drive_id,
        source,
        new Uint8Array([2]),
        `${operation}-source.bin`,
        USER_ID,
        { overwrite: true },
        undefined,
        async () => {
          entered();
          await held;
        },
      );
      await reachedFence;

      const mutation = operation === 'move'
        ? storage.moveObject(drive.drive_id, source, target)
        : operation === 'copy'
          ? storage.copyObject(drive.drive_id, source, target)
          : storage.deleteObject(drive.drive_id, source);
      const settled = Promise.allSettled([lockHolder, mutation]);
      const current = new StorageStudioStore(db).getProfile(drive.drive_id)!;
      advanceProfile(drive.drive_id, 'suspended', current.generation + 1);
      advanceProfile(drive.drive_id, 'ready', current.generation + 1);
      release();

      expect(await settled).toMatchObject([
        { status: 'rejected', reason: { code: 'STORAGE_AUTHORITY_CHANGED' } },
        { status: 'rejected', reason: { code: 'STORAGE_AUTHORITY_CHANGED' } },
      ]);
      expect(storage.getFileInfo(drive.drive_id, source)).not.toBeNull();
      expect(storage.getFileInfo(drive.drive_id, target)).toBeNull();
    }
  });

  test('enforces object count across implicit folders and files transactionally', async () => {
    const config = resolveStorageStudioConfig({
      enabled: true,
      limits: { maxObjectsPerDrive: 2 },
    });
    const quotas = new StorageStudioQuotaPolicy(db, config);
    const storage = new StorageService(db, adapter, { uploadAdmission: quotas });
    const drive = storage.createDrive(USER_ID, { name: 'Object quota' });
    insertReadyProfile(drive.drive_id);

    await storage.upload(
      drive.drive_id,
      '/folder/first.txt',
      new Uint8Array([1]),
      'first.txt',
      USER_ID,
    );
    expect(objectCount(drive.drive_id)).toBe(2);
    await expect(storage.upload(
      drive.drive_id,
      '/second.txt',
      new Uint8Array([2]),
      'second.txt',
      USER_ID,
    )).rejects.toMatchObject({ code: 'STORAGE_QUOTA_EXCEEDED' });
    expect(objectCount(drive.drive_id)).toBe(2);
  });
});

function defineIdentityFixtures(database: ReactiveDB): void {
  database.exec(`
    CREATE TABLE users (user_id TEXT PRIMARY KEY);
    CREATE TABLE _auth_tenant_memberships (membership_id TEXT PRIMARY KEY);
    INSERT INTO users (user_id) VALUES ('${USER_ID}');
  `);
}

function insertReadyProfile(driveId: string): void {
  new StorageStudioStore(db).insertProfile(profileFixture(driveId));
}

function profileFixture(driveId: string): StorageStudioDriveProfile {
  return {
    drive_id: driveId,
    drive_key: 'artifacts',
    owner_kind: 'application',
    owner_id: 'application',
    scope_kind: 'application',
    scope_id: 'application',
    lifecycle: 'ready',
    revision: 1,
    provider: 'local',
    provider_namespace: `namespace_${driveId}`,
    isolation_mode: 'shared-cas',
    generation: 1,
    created_by_user_id: USER_ID,
    created_by_membership_id: null,
    updated_by_user_id: USER_ID,
    updated_by_membership_id: null,
    created_at: 100,
    updated_at: 100,
    ready_at: 100,
    degraded_at: null,
    suspended_at: null,
    deleting_at: null,
    deleted_at: null,
    restoring_at: null,
    failed_at: null,
    failure_code: null,
  };
}

function advanceProfile(
  driveId: string,
  lifecycle: 'ready' | 'suspended',
  generation: number,
): void {
  const current = new StorageStudioStore(db).getProfile(driveId)!;
  const now = current.updated_at + 1;
  new StorageStudioStore(db).updateProfile({
    ...current,
    lifecycle,
    revision: current.revision + 1,
    generation,
    updated_at: now,
    ready_at: lifecycle === 'ready' ? now : current.ready_at,
    suspended_at: lifecycle === 'suspended' ? now : null,
  });
}

function activeReservedBytes(driveId: string): number {
  return (db.prepare(`
    SELECT COALESCE(SUM(reserved_bytes), 0) AS total
    FROM _storage_quota_reservations
    WHERE drive_id = ? AND status = 'active'
  `).get(driveId) as { total: number }).total;
}

function objectCount(driveId: string): number {
  return (db.prepare(
    'SELECT COUNT(*) AS count FROM storage_objects WHERE drive_id = ?',
  ).get(driveId) as { count: number }).count;
}

class MemoryAdapter implements StorageAdapter {
  readonly writeShutdownSafety = 'cooperative' as const;
  private readonly blobs = new Map<string, Uint8Array>();
  private readonly blocked: Promise<void> | null;
  private unblock: (() => void) | null = null;
  private entered: (() => void) | null = null;
  private readonly enteredPromise: Promise<void>;
  writeCount = 0;

  constructor(blockWrites = false) {
    this.blocked = blockWrites
      ? new Promise<void>((resolve) => { this.unblock = resolve; })
      : null;
    this.enteredPromise = new Promise<void>((resolve) => { this.entered = resolve; });
  }

  async writeBlob(data: ReadableStream<Uint8Array> | Uint8Array | Blob) {
    this.writeCount += 1;
    this.entered?.();
    await this.blocked;
    const bytes = data instanceof Uint8Array
      ? data
      : data instanceof Blob
        ? new Uint8Array(await data.arrayBuffer())
        : new Uint8Array(await new Response(data).arrayBuffer());
    const checksum = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    this.blobs.set(checksum, bytes.slice());
    return { checksum, size: bytes.byteLength, headBytes: bytes.slice(0, 512) };
  }
  async readBlob() { return null; }
  async readBlobRange() { return null; }
  async removeBlob(checksum: string) { this.blobs.delete(checksum); }
  removeBlobSync(checksum: string) { this.blobs.delete(checksum); }
  async blobExists(checksum: string) { return this.blobs.has(checksum); }
  async blobSize(checksum: string) { return this.blobs.get(checksum)?.byteLength ?? 0; }
  waitUntilBlocked() { return this.enteredPromise; }
  release() { this.unblock?.(); }
}
