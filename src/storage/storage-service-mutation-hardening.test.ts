/**
 * Forced regression coverage for Storage's transactional object/blob boundary.
 * These tests deliberately overlap staging and inject SQLite aborts so they do
 * not depend on incidental promise or operating-system scheduling.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';

import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { StorageDomainError } from './storage-domain-error';
import {
  defineStorageTables,
  StorageService,
} from './storage-service';
import type {
  BlobRecord,
  DriveRecord,
  ObjectRecord,
  StorageAdapter,
} from './types';

let db: ReactiveDB;
let adapter: MemoryStorageAdapter;
let storage: StorageService;

beforeEach(() => {
  db = createReactiveDB({ mode: 'memory' });
  defineStorageTables(db);
  adapter = new MemoryStorageAdapter();
  storage = new StorageService(db, adapter);
});

afterEach(() => {
  db.dispose();
});

describe('storage mutation hardening', () => {
  test('rejects invalid paths, metadata, conflicts, and file parents before staging bytes', async () => {
    const drive = createDrive();
    storage.createFolder(drive.drive_id, '/folder', 'owner');

    await expect(storage.upload(
      drive.drive_id,
      '/folder',
      bytes(1),
      'file.bin',
      'owner',
    )).rejects.toMatchObject({ code: 'STORAGE_PATH_CONFLICT' });
    expect(adapter.writeCount).toBe(0);

    await storage.upload(drive.drive_id, '/parent', bytes(1), 'parent.bin', 'owner');
    const writesAfterParent = adapter.writeCount;
    await expect(storage.upload(
      drive.drive_id,
      '/parent/child',
      bytes(1),
      'child.bin',
      'owner',
    )).rejects.toMatchObject({ code: 'STORAGE_PATH_CONFLICT' });
    await expect(storage.upload(
      drive.drive_id,
      '/../escape',
      bytes(1),
      'escape.bin',
      'owner',
    )).rejects.toMatchObject({ code: 'STORAGE_INPUT_INVALID' });

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(storage.upload(
      drive.drive_id,
      '/metadata',
      bytes(1),
      'metadata.bin',
      'owner',
      { metadata: circular },
    )).rejects.toMatchObject({ code: 'STORAGE_METADATA_INVALID' });
    expect(adapter.writeCount).toBe(writesAfterParent);
  });

  test('uses overwrite byte delta instead of double-counting existing content', async () => {
    const drive = createDrive({ maxSize: 10 });
    await storage.upload(drive.drive_id, '/item', bytes(8, 1), 'item.bin', 'owner');
    const replaced = await storage.upload(
      drive.drive_id,
      '/item',
      bytes(9, 2),
      'item.bin',
      'owner',
      { overwrite: true },
    );

    expect(replaced.sizeBytes).toBe(9);
    expect(storage.getDriveUsage(drive.drive_id).totalBytes).toBe(9);
    await storage.retryBlobCleanup();
    expect(allBlobs()).toHaveLength(1);
  });

  test('serializes concurrent publications so total quota cannot be over-admitted', async () => {
    const drive = createDrive({ maxSize: 10 });
    const barrier = new MemoryStorageAdapter(2);
    storage = new StorageService(db, barrier);

    const results = await Promise.allSettled([
      storage.upload(drive.drive_id, '/first', bytes(6, 1), 'first.bin', 'owner'),
      storage.upload(drive.drive_id, '/second', bytes(6, 2), 'second.bin', 'owner'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      reason: { code: 'STORAGE_QUOTA_EXCEEDED' },
    });
    expect(storage.getDriveUsage(drive.drive_id).totalBytes).toBe(6);
    expect(allObjects(drive.drive_id).filter((object) => object.type === 'file')).toHaveLength(1);
    expect(allBlobs()).toHaveLength(1);
  });

  test('allows only one concurrent create at the same logical path', async () => {
    const drive = createDrive();
    const barrier = new MemoryStorageAdapter(2);
    storage = new StorageService(db, barrier);

    const results = await Promise.allSettled([
      storage.upload(drive.drive_id, '/same', bytes(3, 1), 'same.bin', 'owner'),
      storage.upload(drive.drive_id, '/same', bytes(3, 2), 'same.bin', 'owner'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'STORAGE_PATH_CONFLICT' },
    });
    expect(allObjects(drive.drive_id).filter((object) => object.type === 'file')).toHaveLength(1);
    await storage.retryBlobCleanup();
    expect(allBlobs()).toHaveLength(1);
    expect(barrier.blobCount).toBe(1);
  });

  test('rolls back parents, references, and object publication after a forced upload abort', async () => {
    const drive = createDrive();
    db.exec(`
      CREATE TRIGGER storage_test_reject_upload
      BEFORE INSERT ON storage_objects
      WHEN NEW.path = '/parent/file'
      BEGIN
        SELECT RAISE(ABORT, 'forced upload abort');
      END
    `);

    await expect(storage.upload(
      drive.drive_id,
      '/parent/file',
      bytes(4),
      'file.bin',
      'owner',
    )).rejects.toThrow();

    expect(allObjects(drive.drive_id)).toEqual([]);
    expect(allBlobs()).toEqual([]);
    expect(adapter.blobCount).toBe(0);
  });

  test('rechecks authority after staging and cleans bytes when the fence rejects', async () => {
    const drive = createDrive();
    let authorityChecks = 0;

    await expect(storage.upload(
      drive.drive_id,
      '/fenced',
      bytes(4),
      'fenced.bin',
      'owner',
      {},
      undefined,
      async () => {
        authorityChecks += 1;
        throw new StorageDomainError(
          'STORAGE_AUTHORITY_CHANGED',
          'Storage authority changed.',
        );
      },
    )).rejects.toMatchObject({ code: 'STORAGE_AUTHORITY_CHANGED' });

    expect(authorityChecks).toBe(1);
    expect(adapter.writeCount).toBe(1);
    expect(storage.getFileInfo(drive.drive_id, '/fenced')).toBeNull();
    expect(allBlobs()).toEqual([]);
    expect(adapter.blobCount).toBe(0);
  });

  test('joins and cancels a blocked cooperative upload before provider teardown', async () => {
    const drive = createDrive();
    const blocked = adapter.blockNextWrite();
    const uploading = storage.upload(
      drive.drive_id,
      '/shutdown-safe',
      bytes(8, 0x5a),
      'shutdown-safe.bin',
      'owner',
    );
    const uploadOutcome = uploading.catch((error) => error);
    await blocked.started;

    let stopped = false;
    const stopping = storage.stop().then(() => { stopped = true; });
    await Bun.sleep(0);
    expect(stopped).toBe(false);
    blocked.release();

    const uploadError = await uploadOutcome;
    await stopping;
    expect(stopped).toBe(true);
    expect(uploadError).toMatchObject({ code: 'STORAGE_NOT_READY' });
    expect(allObjects(drive.drive_id)).toHaveLength(0);
    expect(allBlobs()).toHaveLength(0);
    await expect(storage.upload(
      drive.drive_id,
      '/after-stop',
      bytes(1),
      'after-stop.bin',
      'owner',
    )).rejects.toMatchObject({ code: 'STORAGE_NOT_READY' });

  });

  test('never commits metadata after cleanup removes same-checksum staged bytes', async () => {
    const drive = createDrive();
    const racingAdapter = new MemoryStorageAdapter();
    storage = new StorageService(db, racingAdapter);

    const rejectedPublication = storage.upload(
      drive.drive_id,
      '/rejected',
      bytes(8, 0x51),
      'rejected.bin',
      'owner',
      {},
      undefined,
      async () => {
        throw new StorageDomainError(
          'STORAGE_AUTHORITY_CHANGED',
          'Forced authority revocation.',
        );
      },
    );
    const concurrentPublication = storage.upload(
      drive.drive_id,
      '/concurrent',
      bytes(8, 0x51),
      'concurrent.bin',
      'owner',
    );
    const outcomes = await Promise.allSettled([
      rejectedPublication,
      concurrentPublication,
    ]);
    expect(outcomes[0]).toMatchObject({
      status: 'rejected',
      reason: { code: 'STORAGE_AUTHORITY_CHANGED' },
    });
    expect(storage.getFileInfo(drive.drive_id, '/rejected')).toBeNull();
    const concurrent = storage.getFileInfo(drive.drive_id, '/concurrent');
    if (outcomes[1]?.status === 'fulfilled') {
      expect(concurrent).not.toBeNull();
      expect(racingAdapter.has(concurrent!.checksum!)).toBe(true);
      expect(blob(concurrent!.checksum!)?.ref_count).toBe(1);
    } else {
      expect(outcomes[1]).toMatchObject({
        reason: { code: 'STORAGE_PROVIDER_UNAVAILABLE', outcome: 'not-committed' },
      });
      expect(concurrent).toBeNull();
    }
  });

  test('serializes shared-CAS cleanup against uploads across service runtimes', async () => {
    const path = `/tmp/zero-storage-blob-lease-${crypto.randomUUID()}.sqlite`;
    const firstDb = createReactiveDB({ mode: 'file', path });
    const secondDb = createReactiveDB({ mode: 'file', path });
    const sharedAdapter = new MemoryStorageAdapter();
    try {
      defineStorageTables(firstDb);
      defineStorageTables(secondDb);
      const first = new StorageService(firstDb, sharedAdapter);
      const second = new StorageService(secondDb, sharedAdapter);
      const drive = first.createDrive('owner', { name: 'Cross-runtime CAS' });
      const content = bytes(8, 7);
      const original = await first.upload(
        drive.drive_id, '/original.bin', content, 'original.bin', 'owner',
      );
      expect(await first.deleteObject(drive.drive_id, '/original.bin')).toBe(true);
      await Bun.sleep(0);
      expect(sharedAdapter.has(original.checksum!)).toBe(false);
      const replacement = await second.upload(
        drive.drive_id, '/replacement.bin', content, 'replacement.bin', 'owner',
      );
      expect(second.getFileInfo(drive.drive_id, '/replacement.bin')).toMatchObject({
        checksum: replacement.checksum,
      });
      expect(sharedAdapter.has(replacement.checksum!)).toBe(true);
      expect(firstDb.prepare(
        'SELECT COUNT(*) AS count FROM storage_objects WHERE checksum = ?',
      ).get(replacement.checksum)).toEqual({ count: 1 });
    } finally {
      secondDb.dispose();
      firstDb.dispose();
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        rmSync(`${path}${suffix}`, { force: true });
      }
    }
  });

  test('revalidates move, copy, and delete authority after waiting on path locks', async () => {
    for (const operation of ['move', 'copy', 'delete'] as const) {
      const drive = createDrive({ name: `Authority ${operation}` });
      const source = `/${operation}-source`;
      const target = `/${operation}-target`;
      await storage.upload(drive.drive_id, source, bytes(2, 1), 'source.bin', 'owner');
      let enterFence!: () => void;
      let releaseFence!: () => void;
      const entered = new Promise<void>((resolve) => { enterFence = resolve; });
      const barrier = new Promise<void>((resolve) => { releaseFence = resolve; });
      const lockHolder = storage.upload(
        drive.drive_id,
        source,
        bytes(2, 2),
        'source.bin',
        'owner',
        { overwrite: true },
        undefined,
        async () => {
          enterFence();
          await barrier;
        },
      );
      await entered;

      let revoked = false;
      const commitFence = () => {
        if (revoked) {
          throw new StorageDomainError(
            'STORAGE_AUTHORITY_CHANGED',
            'Forced authority revocation.',
          );
        }
      };
      const mutation = operation === 'move'
        ? storage.moveObject(drive.drive_id, source, target, commitFence)
        : operation === 'copy'
          ? storage.copyObject(drive.drive_id, source, target, commitFence)
          : storage.deleteObject(drive.drive_id, source, commitFence);
      const settled = Promise.allSettled([mutation]);
      revoked = true;
      releaseFence();
      await lockHolder;

      expect(await settled).toMatchObject([{
        status: 'rejected',
        reason: { code: 'STORAGE_AUTHORITY_CHANGED' },
      }]);
      expect(storage.getFileInfo(drive.drive_id, source)).not.toBeNull();
      expect(storage.getFileInfo(drive.drive_id, target)).toBeNull();
    }
  });

  test('never removes an already referenced deduplicated blob after failed publication', async () => {
    const drive = createDrive();
    await storage.upload(drive.drive_id, '/kept', bytes(4, 7), 'kept.bin', 'owner');
    const checksum = storage.getFileInfo(drive.drive_id, '/kept')!.checksum!;
    db.exec(`
      CREATE TRIGGER storage_test_reject_duplicate
      BEFORE INSERT ON storage_objects
      WHEN NEW.path = '/rejected'
      BEGIN
        SELECT RAISE(ABORT, 'forced duplicate abort');
      END
    `);

    await expect(storage.upload(
      drive.drive_id,
      '/rejected',
      bytes(4, 7),
      'rejected.bin',
      'owner',
    )).rejects.toThrow();

    expect(adapter.has(checksum)).toBe(true);
    expect(blob(checksum)?.ref_count).toBe(1);
    expect(storage.getFileInfo(drive.drive_id, '/kept')?.checksum).toBe(checksum);
  });

  test('retains zero-ref cleanup state after provider failure and retries successfully', async () => {
    const drive = createDrive();
    await storage.upload(drive.drive_id, '/file', bytes(3), 'file.bin', 'owner');
    const checksum = storage.getFileInfo(drive.drive_id, '/file')!.checksum!;
    adapter.failRemove = true;

    expect(await storage.deleteObject(drive.drive_id, '/file')).toBe(true);
    await storage.retryBlobCleanup();
    expect(blob(checksum)?.ref_count).toBe(0);
    expect(adapter.has(checksum)).toBe(true);

    adapter.failRemove = false;
    await storage.retryBlobCleanup();
    expect(blob(checksum)).toBeNull();
    expect(adapter.has(checksum)).toBe(false);
  });

  test('continues a bounded orphan-cleanup batch after one provider deletion fails', async () => {
    const drive = createDrive();
    await storage.upload(drive.drive_id, '/first', bytes(3, 1), 'first.bin', 'owner');
    await storage.upload(drive.drive_id, '/second', bytes(3, 2), 'second.bin', 'owner');
    const firstChecksum = storage.getFileInfo(drive.drive_id, '/first')!.checksum!;
    const secondChecksum = storage.getFileInfo(drive.drive_id, '/second')!.checksum!;

    adapter.failRemove = true;
    await storage.deleteObject(drive.drive_id, '/first');
    await storage.deleteObject(drive.drive_id, '/second');
    await Bun.sleep(0);
    expect(blob(firstChecksum)?.ref_count).toBe(0);
    expect(blob(secondChecksum)?.ref_count).toBe(0);

    adapter.failRemove = false;
    adapter.failRemoveChecksums.add(firstChecksum);
    const pass = await storage.retryBlobCleanup({ batchSize: 2, concurrency: 2 });
    expect(pass.attempted).toBe(2);
    expect(blob(firstChecksum)?.ref_count).toBe(0);
    expect(blob(secondChecksum)).toBeNull();
    expect(pass.remaining).toBe(1);
  });

  test('keeps provider failures private and preserves canonical retry outcomes', async () => {
    const drive = createDrive();
    adapter.failWrite = true;
    let failedWrite: unknown;
    try {
      await storage.upload(
        drive.drive_id,
        '/write-failure',
        bytes(3),
        'write.bin',
        'owner',
      );
    } catch (error) {
      failedWrite = error;
    }
    expect(failedWrite).toMatchObject({
      code: 'STORAGE_PROVIDER_UNAVAILABLE',
      retryable: true,
      outcome: 'not-committed',
    });
    expect((failedWrite as Error).message).not.toContain('sensitive-provider-path');

    adapter.failWrite = false;
    await storage.upload(drive.drive_id, '/read-failure', bytes(3), 'read.bin', 'owner');
    adapter.failRead = true;
    await expect(storage.download(drive.drive_id, '/read-failure')).rejects.toMatchObject({
      code: 'STORAGE_PROVIDER_UNAVAILABLE',
      retryable: true,
      outcome: 'not-committed',
    });
    adapter.failRead = false;
    adapter.failRangeRead = true;
    await expect(storage.downloadRange(
      drive.drive_id,
      '/read-failure',
      0,
      1,
    )).rejects.toMatchObject({
      code: 'STORAGE_PROVIDER_UNAVAILABLE',
      retryable: true,
      outcome: 'not-committed',
    });
  });

  test('enforces configured size limits for known blobs and unknown-length streams', async () => {
    const drive = createDrive({ maxFileSize: 4 });
    await expect(storage.upload(
      drive.drive_id,
      '/blob-overflow',
      new Blob(['12345']),
      'blob.bin',
      'owner',
    )).rejects.toMatchObject({
      code: 'STORAGE_LIMIT_EXCEEDED',
      outcome: 'not-committed',
    });

    const unknownLength = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes(3));
        controller.enqueue(bytes(3));
        controller.close();
      },
    });
    await expect(storage.upload(
      drive.drive_id,
      '/stream-overflow',
      unknownLength,
      'stream.bin',
      'owner',
    )).rejects.toMatchObject({
      code: 'STORAGE_LIMIT_EXCEEDED',
      outcome: 'not-committed',
    });
    expect(storage.getFileInfo(drive.drive_id, '/blob-overflow')).toBeNull();
    expect(storage.getFileInfo(drive.drive_id, '/stream-overflow')).toBeNull();
    expect(allBlobs()).toEqual([]);
  });

  test('keeps copy quota and copy rollback atomic with reference counts', async () => {
    const drive = createDrive({ maxSize: 10 });
    await storage.upload(drive.drive_id, '/source', bytes(6), 'source.bin', 'owner');
    const checksum = storage.getFileInfo(drive.drive_id, '/source')!.checksum!;

    await expect(storage.copyObject(
      drive.drive_id,
      '/source',
      '/over-quota',
    )).rejects.toMatchObject({ code: 'STORAGE_QUOTA_EXCEEDED' });
    expect(blob(checksum)?.ref_count).toBe(1);

    db.exec(`
      CREATE TRIGGER storage_test_reject_copy
      BEFORE INSERT ON storage_objects
      WHEN NEW.path = '/nested/copy'
      BEGIN
        SELECT RAISE(ABORT, 'forced copy abort');
      END
    `);
    await expect(storage.copyObject(
      drive.drive_id,
      '/source',
      '/nested/copy',
    )).rejects.toThrow();
    expect(storage.getFileInfo(drive.drive_id, '/nested')).toBeNull();
    expect(storage.getFileInfo(drive.drive_id, '/nested/copy')).toBeNull();
    expect(blob(checksum)?.ref_count).toBe(1);
  });

  test('escapes LIKE wildcards, rejects descendant moves, and rolls tree moves back', async () => {
    const drive = createDrive();
    await storage.upload(drive.drive_id, '/team%/file', bytes(1), 'file.bin', 'owner');
    await storage.upload(drive.drive_id, '/teamX/file', bytes(1, 2), 'file.bin', 'owner');
    await storage.upload(drive.drive_id, '/Case/file', bytes(1, 5), 'file.bin', 'owner');
    await storage.upload(drive.drive_id, '/case/file', bytes(1, 6), 'file.bin', 'owner');
    expect(await storage.deleteObject(drive.drive_id, '/team%')).toBe(true);
    expect(await storage.deleteObject(drive.drive_id, '/Case')).toBe(true);
    expect(storage.getFileInfo(drive.drive_id, '/teamX/file')).not.toBeNull();
    expect(storage.getFileInfo(drive.drive_id, '/case/file')).not.toBeNull();

    storage.createFolder(drive.drive_id, '/root', 'owner');
    await storage.upload(drive.drive_id, '/root/a', bytes(1, 3), 'a.bin', 'owner');
    await storage.upload(drive.drive_id, '/root/b', bytes(1, 4), 'b.bin', 'owner');
    await expect(storage.moveObject(
      drive.drive_id,
      '/root',
      '/root/child',
    )).rejects.toMatchObject({ code: 'STORAGE_PATH_CONFLICT' });

    db.exec(`
      CREATE TRIGGER storage_test_reject_tree_move
      BEFORE UPDATE ON storage_objects
      WHEN OLD.path = '/root/b'
      BEGIN
        SELECT RAISE(ABORT, 'forced tree move abort');
      END
    `);
    await expect(storage.moveObject(
      drive.drive_id,
      '/root',
      '/moved',
    )).rejects.toThrow();
    expect(storage.getFileInfo(drive.drive_id, '/root')).not.toBeNull();
    expect(storage.getFileInfo(drive.drive_id, '/root/a')).not.toBeNull();
    expect(storage.getFileInfo(drive.drive_id, '/root/b')).not.toBeNull();
    expect(storage.getFileInfo(drive.drive_id, '/moved')).toBeNull();
  });

  test('surfaces corrupt persisted metadata as a safe Storage domain error', async () => {
    const drive = createDrive();
    await storage.upload(drive.drive_id, '/file', bytes(1), 'file.bin', 'owner');
    db.prepare(
      "UPDATE storage_objects SET metadata = '{' WHERE drive_id = ? AND path = ?",
    ).run(drive.drive_id, '/file');

    let caught: unknown;
    try {
      storage.getFileInfo(drive.drive_id, '/file');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(StorageDomainError);
    expect(caught).toMatchObject({ code: 'STORAGE_INTERNAL' });
    expect(caught).not.toBeInstanceOf(SyntaxError);
  });

  test('creates reserved nullable-owner drives and purges contents without deleting the drive', async () => {
    const drive = storage.createDriveRecord({
      driveId: 'organization_alpha',
      ownerId: null,
      params: { name: 'Organization Alpha' },
    });
    await storage.upload(drive.drive_id, '/file', bytes(2), 'file.bin', null);
    storage.grantPermission(drive.drive_id, {
      grantType: 'role',
      grantValue: 'member',
      permission: 'read',
    });
    storage.grantPermission(drive.drive_id, {
      objectPath: '/file',
      grantType: 'user',
      grantValue: 'reviewer',
      permission: 'read',
    });

    expect(await storage.purgeDriveContents(drive.drive_id)).toBe(true);
    expect(storage.getDrive(drive.drive_id)).toMatchObject({ owner_id: null });
    expect(allObjects(drive.drive_id)).toEqual([]);
    expect(db.prepare(
      'SELECT * FROM _storage_permissions WHERE drive_id = ?',
    ).all(drive.drive_id)).toEqual([
      expect.objectContaining({
        object_id: null,
        grant_type: 'role',
        grant_value: 'member',
        permission: 'read',
      }),
    ]);
    await storage.retryBlobCleanup();
    expect(allBlobs()).toEqual([]);
  });

  test('purges large managed drives in bounded resumable batches', async () => {
    const drive = storage.createDriveRecord({
      driveId: 'bounded_purge',
      ownerId: null,
      params: { name: 'Bounded purge' },
    });
    for (let index = 0; index < 260; index += 1) {
      storage.createFolder(drive.drive_id, `/folder-${index}`, null);
    }

    expect(await storage.purgeDriveContentsBatch(drive.drive_id, 100)).toEqual({
      exists: true,
      remaining: true,
    });
    expect(allObjects(drive.drive_id)).toHaveLength(160);
    expect(await storage.purgeDriveContentsBatch(drive.drive_id, 100)).toEqual({
      exists: true,
      remaining: true,
    });
    expect(allObjects(drive.drive_id)).toHaveLength(60);
    expect(await storage.purgeDriveContentsBatch(drive.drive_id, 100)).toEqual({
      exists: true,
      remaining: false,
    });
    expect(allObjects(drive.drive_id)).toEqual([]);
    expect(storage.getDrive(drive.drive_id)).not.toBeNull();
  });
});

function createDrive(
  options: Readonly<{ maxSize?: number; maxFileSize?: number; name?: string }> = {},
): DriveRecord {
  return storage.createDrive('owner', {
    name: options.name ?? 'Test drive',
    maxSize: options.maxSize,
    maxFileSize: options.maxFileSize,
  });
}

function allObjects(driveId: string): ObjectRecord[] {
  return db.prepare(
    'SELECT * FROM storage_objects WHERE drive_id = ? ORDER BY path',
  ).all(driveId) as ObjectRecord[];
}

function allBlobs(): BlobRecord[] {
  return db.prepare('SELECT * FROM _storage_blobs ORDER BY checksum').all() as BlobRecord[];
}

function blob(checksum: string): BlobRecord | null {
  return db.prepare(
    'SELECT * FROM _storage_blobs WHERE checksum = ?',
  ).get(checksum) as BlobRecord | null;
}

function bytes(length: number, value = 1): Uint8Array {
  return new Uint8Array(length).fill(value);
}

class MemoryStorageAdapter implements StorageAdapter {
  readonly writeShutdownSafety = 'cooperative' as const;
  readonly blobs = new Map<string, Uint8Array>();
  writeCount = 0;
  failRemove = false;
  readonly failRemoveChecksums = new Set<string>();
  failWrite = false;
  failRead = false;
  failRangeRead = false;
  private staged = 0;
  private releaseBarrier: (() => void) | null = null;
  private readonly barrier: Promise<void> | null;
  private writeBarrier: {
    readonly started: () => void;
    readonly wait: Promise<void>;
  } | null = null;

  constructor(private readonly expectedStagedWrites = 0) {
    this.barrier = expectedStagedWrites > 0
      ? new Promise<void>((resolve) => {
          this.releaseBarrier = resolve;
        })
      : null;
  }

  get blobCount(): number {
    return this.blobs.size;
  }

  has(checksum: string): boolean {
    return this.blobs.has(checksum);
  }

  blockNextWrite(): { readonly started: Promise<void>; release(): void } {
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    this.writeBarrier = { started: markStarted, wait };
    return { started, release };
  }

  async writeBlob(
    data: ReadableStream<Uint8Array> | Uint8Array | Blob,
    maxSize?: number,
  ) {
    this.writeCount += 1;
    if (this.failWrite) {
      throw new Error('sensitive-provider-path/write failed');
    }
    const content = await readBytes(data);
    if (maxSize !== undefined && content.byteLength > maxSize) {
      throw new StorageDomainError(
        'STORAGE_LIMIT_EXCEEDED',
        'File is too large.',
        { outcome: 'not-committed' },
      );
    }
    const checksum = new Bun.CryptoHasher('sha256').update(content).digest('hex');
    this.blobs.set(checksum, content.slice());
    const writeBarrier = this.writeBarrier;
    if (writeBarrier) {
      this.writeBarrier = null;
      writeBarrier.started();
      await writeBarrier.wait;
    }
    if (this.barrier) {
      this.staged += 1;
      if (this.staged === this.expectedStagedWrites) this.releaseBarrier?.();
      await this.barrier;
    }
    return {
      checksum,
      size: content.byteLength,
      headBytes: content.slice(0, 512),
    };
  }

  async readBlob(checksum: string): Promise<ReadableStream<Uint8Array> | null> {
    if (this.failRead) throw new Error('sensitive-provider-path/read failed');
    const content = this.blobs.get(checksum);
    return content ? stream(content) : null;
  }

  async readBlobRange(
    checksum: string,
    start: number,
    end: number,
  ): Promise<ReadableStream<Uint8Array> | null> {
    if (this.failRangeRead) throw new Error('sensitive-provider-path/range failed');
    const content = this.blobs.get(checksum);
    return content ? stream(content.slice(start, end + 1)) : null;
  }

  async removeBlob(checksum: string): Promise<void> {
    if (this.failRemove || this.failRemoveChecksums.has(checksum)) {
      throw new Error('forced provider removal failure');
    }
    this.blobs.delete(checksum);
  }

  removeBlobSync(checksum: string): void {
    if (this.failRemove || this.failRemoveChecksums.has(checksum)) {
      throw new Error('forced provider removal failure');
    }
    this.blobs.delete(checksum);
  }

  async blobExists(checksum: string): Promise<boolean> {
    return this.blobs.has(checksum);
  }

  async blobSize(checksum: string): Promise<number> {
    return this.blobs.get(checksum)?.byteLength ?? 0;
  }
}

async function readBytes(
  data: ReadableStream<Uint8Array> | Uint8Array | Blob,
): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data;
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = data.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    size += value.byteLength;
  }
  const content = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    content.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return content;
}

function stream(content: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(content.slice());
      controller.close();
    },
  });
}
