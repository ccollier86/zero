/**
 * local-adapter.test.ts
 *
 * Regression coverage for streamed local blob staging, runtime temp ownership,
 * and atomic content-addressed publication. These tests intentionally force
 * overlap and filesystem failures; they do not exercise storage metadata.
 */

import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import type { FileHandle } from 'node:fs/promises';
import { LocalStorageAdapter } from './local-adapter';
import { createReactiveDB } from '../sync/reactive-db';
import { defineStorageTables, StorageService } from './storage-service';

const testDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    testDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe('LocalStorageAdapter streamed writes', () => {
  test('writes a Web ReadableStream incrementally while retaining only head bytes', async () => {
    const baseDir = await createTestDirectory();
    const adapter = new LocalStorageAdapter(baseDir);
    const chunks = [
      bytes(0x11, 300),
      bytes(0x22, 400),
      bytes(0x33, 700),
    ];
    let pullIndex = 0;
    let bytesAlreadyProduced = 0;

    const stream = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          if (pullIndex > 0) {
            const staged = await uploadFiles(baseDir);
            expect(staged).toHaveLength(1);
            expect((await stat(staged[0]!)).size).toBe(bytesAlreadyProduced);
          }
          if (pullIndex === chunks.length) {
            controller.close();
            return;
          }
          const chunk = chunks[pullIndex++]!;
          bytesAlreadyProduced += chunk.byteLength;
          controller.enqueue(chunk);
        },
      },
      { highWaterMark: 0 }
    );

    const result = await adapter.writeBlob(stream);
    const expected = concatenate(chunks);

    expect(result.size).toBe(expected.byteLength);
    expect(result.checksum).toBe(sha256(expected));
    expect(result.headBytes).toEqual(expected.slice(0, 512));
    expect(await readStoredBlob(baseDir, result.checksum)).toEqual(expected);
    expect(await uploadFiles(baseDir)).toEqual([]);
  });

  test('writes an async iterable incrementally instead of collecting its chunks', async () => {
    const baseDir = await createTestDirectory();
    const adapter = new LocalStorageAdapter(baseDir);
    const first = bytes(0x41, 384);
    const second = bytes(0x42, 512);

    async function* source(): AsyncGenerator<Uint8Array> {
      yield first;
      const staged = await uploadFiles(baseDir);
      expect(staged).toHaveLength(1);
      expect((await stat(staged[0]!)).size).toBe(first.byteLength);
      yield second;
    }

    const result = await adapter.writeBlob(source());
    const expected = concatenate([first, second]);

    expect(result.checksum).toBe(sha256(expected));
    expect(result.size).toBe(expected.byteLength);
    expect(await readStoredBlob(baseDir, result.checksum)).toEqual(expected);
  });

  test('cleans its staging file when the source fails after yielding bytes', async () => {
    const baseDir = await createTestDirectory();
    const adapter = new LocalStorageAdapter(baseDir);
    const sourceFailure = new Error('forced source failure');
    let pullCount = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pullCount++ === 0) {
          controller.enqueue(bytes(0x51, 256));
          return;
        }
        controller.error(sourceFailure);
      },
    });

    await expect(adapter.writeBlob(stream)).rejects.toBe(sourceFailure);
    expect(await uploadFiles(baseDir)).toEqual([]);
    expect(await blobFiles(baseDir)).toEqual([]);
  });

  test('cleans its staging file when a chunk write fails', async () => {
    const baseDir = await createTestDirectory();
    const writeFailure = new Error('forced staging write failure');
    const adapter = new FailingWriteAdapter(baseDir, writeFailure);

    await expect(adapter.writeBlob(bytes(0x61, 1024))).rejects.toBe(writeFailure);
    expect(await uploadFiles(baseDir)).toEqual([]);
    expect(await blobFiles(baseDir)).toEqual([]);
  });
});

describe('LocalStorageAdapter publication', () => {
  test('publishes concurrent identical uploads as one intact content-addressed blob', async () => {
    const baseDir = await createTestDirectory();
    const adapter = new LocalStorageAdapter(baseDir);
    const content = concatenate([
      bytes(0x71, 64 * 1024),
      bytes(0x72, 64 * 1024),
      bytes(0x73, 64 * 1024),
    ]);

    const results = await Promise.all(
      Array.from({ length: 4 }, () => adapter.writeBlob(chunkedStream(content, 4096)))
    );

    expect(new Set(results.map((result) => result.checksum))).toEqual(
      new Set([sha256(content)])
    );
    expect(await blobFiles(baseDir)).toHaveLength(1);
    expect(await readStoredBlob(baseDir, results[0]!.checksum)).toEqual(content);
    expect(await uploadFiles(baseDir)).toEqual([]);
  }, 20_000);

  test('accepts a destination collision only when the published blob verifies', async () => {
    const baseDir = await createTestDirectory();
    const content = bytes(0x81, 2048);
    const first = await new LocalStorageAdapter(baseDir).writeBlob(content);
    const collision = nodeError('EEXIST', 'forced destination collision');
    const adapter = new FailingRenameAdapter(baseDir, collision);

    const second = await adapter.writeBlob(content);

    expect(second).toMatchObject({
      checksum: first.checksum,
      size: first.size,
      headBytes: first.headBytes,
    });
    expect(await readStoredBlob(baseDir, second.checksum)).toEqual(content);
    expect(await uploadFiles(baseDir)).toEqual([]);
  });

  test('rejects a destination collision when the existing blob fails integrity checks', async () => {
    const baseDir = await createTestDirectory();
    const content = bytes(0x86, 2048);
    const checksum = sha256(content);
    const blobPath = join(
      baseDir,
      'blobs',
      checksum.slice(0, 2),
      checksum.slice(2, 4),
      checksum
    );
    await mkdir(join(baseDir, 'blobs', checksum.slice(0, 2), checksum.slice(2, 4)), {
      recursive: true,
    });
    await writeFile(blobPath, bytes(0x87, content.byteLength));
    const adapter = new FailingRenameAdapter(
      baseDir,
      nodeError('EEXIST', 'forced destination collision')
    );

    await expect(adapter.writeBlob(content)).rejects.toThrow(
      'collided with invalid content'
    );
    expect(await readFile(blobPath)).toEqual(Buffer.from(bytes(0x87, content.byteLength)));
    expect(await uploadFiles(baseDir)).toEqual([]);
  });

  test('propagates a non-benign atomic publication failure and removes its temp file', async () => {
    const baseDir = await createTestDirectory();
    const publishFailure = nodeError('EACCES', 'forced atomic publication failure');
    const adapter = new FailingRenameAdapter(baseDir, publishFailure);

    await expect(adapter.writeBlob(bytes(0x91, 2048))).rejects.toBe(publishFailure);
    expect(await uploadFiles(baseDir)).toEqual([]);
    expect(await blobFiles(baseDir)).toEqual([]);
  });

  test('does not report publication before the destination directory is durable', async () => {
    const baseDir = await createTestDirectory();
    const failure = new Error('forced destination-directory fsync failure');
    const adapter = new FailingPublicationSyncAdapter(baseDir, failure);

    await expect(adapter.writeBlob(bytes(0x92, 2048))).rejects.toBe(failure);
    // Bytes may have reached the CAS namespace, but callers never receive a
    // successful staged result and therefore cannot commit metadata to them.
    expect(await blobFiles(baseDir)).toHaveLength(1);
  });

  test('fences a paused writer after another runtime claims its expired ownership', async () => {
    const baseDir = await createTestDirectory();
    const writer = new PausedPublicationAdapter(baseDir);
    const writing = writer.writeBlob(bytes(0x93, 2048));
    await writer.publicationStarted;
    const runtimeName = (await readdir(join(baseDir, 'tmp')))
      .find((name) => name.startsWith('runtime_'))!;
    const ownerPath = join(baseDir, 'tmp', runtimeName, '.owner.json');
    const owner = JSON.parse(await readFile(ownerPath, 'utf8')) as Record<string, unknown>;
    await writeFile(ownerPath, JSON.stringify({
      ...owner,
      host: 'expired-container-owner',
      heartbeatAt: 0,
    }));

    const recovery = new LocalStorageAdapter(baseDir);
    writer.releasePublication();
    await expect(writing).rejects.toMatchObject({
      code: 'STORAGE_PROVIDER_UNAVAILABLE',
      outcome: 'not-committed',
    });
    expect(await blobFiles(baseDir)).toEqual([]);
    recovery.stop();
    writer.stop();
  });
});

describe('LocalStorageAdapter temporary-file ownership', () => {
  test('startup never deletes another runtime active temp file', async () => {
    const baseDir = await createTestDirectory();
    const tempDir = join(baseDir, 'tmp', 'runtime_active');
    await mkdir(tempDir, { recursive: true });
    const activePath = join(
      tempDir,
      'upload_7e49fe73-052d-48da-81ee-02f9ce8b62a6'
    );
    const activeHandle = await open(activePath, 'wx');
    await activeHandle.write(bytes(0xa1, 128));

    try {
      new LocalStorageAdapter(baseDir);
      expect(existsSync(activePath)).toBe(true);
      expect(await readFile(activePath)).toEqual(Buffer.from(bytes(0xa1, 128)));
    } finally {
      await activeHandle.close();
    }
  });

  test('reclaims a provably crashed same-host runtime without touching live owners', async () => {
    const baseDir = await createTestDirectory();
    const tmpRoot = join(baseDir, 'tmp');
    const crashed = join(tmpRoot, 'runtime_crashed');
    const live = join(tmpRoot, 'runtime_live');
    await mkdir(crashed, { recursive: true });
    await mkdir(live, { recursive: true });
    await writeFile(join(crashed, '.owner.json'), JSON.stringify({
      pid: 2_147_483_647,
      host: hostname(),
    }));
    await writeFile(join(crashed, 'upload_orphan'), bytes(0xc1, 64));
    await writeFile(join(live, '.owner.json'), JSON.stringify({
      pid: process.pid,
      host: hostname(),
    }));
    await writeFile(join(live, 'upload_active'), bytes(0xa2, 64));

    const adapter = new LocalStorageAdapter(baseDir);
    expect(existsSync(crashed)).toBe(false);
    expect(existsSync(join(live, 'upload_active'))).toBe(true);
    adapter.stop();
  });

  test('reclaims crashed owners beyond more than one batch of unreclaimable entries', async () => {
    const baseDir = await createTestDirectory();
    const tmpRoot = join(baseDir, 'tmp');
    await mkdir(tmpRoot, { recursive: true });
    for (let index = 0; index < 40; index += 1) {
      const retained = join(tmpRoot, `runtime_aa_live_${String(index).padStart(2, '0')}`);
      await mkdir(retained);
      await writeFile(join(retained, '.owner.json'), JSON.stringify({
        pid: process.pid,
        host: hostname(),
      }));
    }
    const crashed = join(tmpRoot, 'runtime_zz_crashed');
    await mkdir(crashed);
    await writeFile(join(crashed, '.owner.json'), JSON.stringify({
      pid: 2_147_483_647,
      host: hostname(),
    }));

    const adapter = new LocalStorageAdapter(baseDir);
    expect(existsSync(crashed)).toBe(false);
    adapter.stop();
  });

  test('reclaims an expired runtime lease after a container hostname changes', async () => {
    const baseDir = await createTestDirectory();
    const directory = join(baseDir, 'tmp', 'runtime_previous_container');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, '.owner.json'), JSON.stringify({
      pid: process.pid,
      host: 'previous-container-hostname',
      heartbeatAt: 0,
    }));
    await writeFile(join(directory, 'upload_orphan'), bytes(0xc2, 32));

    const adapter = new LocalStorageAdapter(baseDir);
    expect(existsSync(directory)).toBe(false);
    adapter.stop();
  });

  test('removes a torn temporary receipt from a stale runtime safely', async () => {
    const baseDir = await createTestDirectory();
    const directory = join(baseDir, 'tmp', 'runtime_torn_receipt');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, '.owner.json'), JSON.stringify({
      pid: 2_147_483_647,
      host: hostname(),
      heartbeatAt: 0,
    }));
    await writeFile(join(directory, '.pending_torn'), '{"checksum":');

    const adapter = new LocalStorageAdapter(baseDir);
    expect(existsSync(directory)).toBe(false);
    adapter.stop();
  });

  test('removes its private runtime directory on graceful stop', async () => {
    const baseDir = await createTestDirectory();
    const adapter = new LocalStorageAdapter(baseDir);
    const before = await readdir(join(baseDir, 'tmp'));
    expect(before.filter((name) => name.startsWith('runtime_'))).toHaveLength(1);

    adapter.stop();
    adapter.stop();
    expect(await readdir(join(baseDir, 'tmp'))).toEqual([]);
    await expect(adapter.writeBlob(bytes(0xa3, 1))).rejects.toMatchObject({
      code: 'STORAGE_NOT_READY',
    });
  });

  test('rejects non-SHA checksum paths before resolving the filesystem target', async () => {
    const adapter = new LocalStorageAdapter(await createTestDirectory());

    await expect(adapter.readBlob('../../outside')).rejects.toThrow(
      'checksum is invalid',
    );
    await expect(adapter.removeBlob('/absolute/path')).rejects.toThrow(
      'checksum is invalid',
    );
  });
});

describe('LocalStorageAdapter crash publication receipts', () => {
  test('removes published bytes that crashed before metadata commit', async () => {
    const baseDir = await createTestDirectory();
    const crashed = new LocalStorageAdapter(baseDir);
    const staged = await crashed.writeBlob(bytes(0xb1, 512));
    expect(staged.publicationId).toBeString();
    crashed.stop();

    const db = createReactiveDB({ mode: 'memory' });
    defineStorageTables(db);
    const restarted = new LocalStorageAdapter(baseDir);
    const service = new StorageService(db, restarted);
    expect(await restarted.blobExists(staged.checksum)).toBe(false);
    expect(restarted.listPendingBlobPublications().items).toEqual([]);
    await service.stop();
    db.dispose();
  });

  test('keeps referenced bytes and settles a receipt after metadata committed first', async () => {
    const baseDir = await createTestDirectory();
    const crashed = new LocalStorageAdapter(baseDir);
    const staged = await crashed.writeBlob(bytes(0xb2, 512));
    crashed.stop();

    const db = createReactiveDB({ mode: 'memory' });
    defineStorageTables(db);
    db.prepare(`
      INSERT INTO _storage_blobs (checksum, size_bytes, ref_count, created_at)
      VALUES (?, ?, 1, ?)
    `).run(staged.checksum, staged.size, Date.now());
    const restarted = new LocalStorageAdapter(baseDir);
    const service = new StorageService(db, restarted);
    expect(await restarted.blobExists(staged.checksum)).toBe(true);
    expect(restarted.listPendingBlobPublications().items).toEqual([]);
    await service.stop();
    db.dispose();
  });

  test('continues bounded receipt recovery after startup even without Studio', async () => {
    const baseDir = await createTestDirectory();
    const crashed = new LocalStorageAdapter(baseDir);
    for (let index = 0; index < 40; index += 1) {
      await crashed.writeBlob(bytes(0xc3, 32));
    }
    crashed.stop();

    const db = createReactiveDB({ mode: 'memory' });
    defineStorageTables(db);
    const restarted = new LocalStorageAdapter(baseDir);
    const service = new StorageService(db, restarted);
    const deadline = Date.now() + 1_000;
    while (restarted.listPendingBlobPublications().items.length > 0
      && Date.now() < deadline) await Bun.sleep(10);
    expect(restarted.listPendingBlobPublications().items).toEqual([]);
    await service.stop();
    db.dispose();
  });

  test('settles normal upload receipts before graceful service shutdown', async () => {
    const baseDir = await createTestDirectory();
    const db = createReactiveDB({ mode: 'memory' });
    defineStorageTables(db);
    const adapter = new LocalStorageAdapter(baseDir);
    const service = new StorageService(db, adapter);
    const drive = service.createDrive('owner', { name: 'Receipts' });
    await service.upload(
      drive.drive_id,
      '/settled.bin',
      bytes(0xb3, 512),
      'settled.bin',
      'owner',
    );
    expect((await uploadFiles(baseDir))).toEqual([]);
    expect(await filesBelow(
      join(baseDir, 'tmp'),
      (name) => name.startsWith('publication_'),
    )).toEqual([]);
    await service.stop();
    expect(await readdir(join(baseDir, 'tmp'))).toEqual([]);
    db.dispose();
  });

  test('retains the zero-reference row when unlink directory fsync fails', async () => {
    const baseDir = await createTestDirectory();
    const db = createReactiveDB({ mode: 'memory' });
    defineStorageTables(db);
    const adapter = new FailingRemovalSyncAdapter(baseDir);
    const service = new StorageService(db, adapter);
    const drive = service.createDrive('owner', { name: 'Durable unlink' });
    const uploaded = await service.upload(
      drive.drive_id,
      '/removed.bin',
      bytes(0xb4, 64),
      'removed.bin',
      'owner',
    );
    await service.deleteObject(drive.drive_id, '/removed.bin');
    await Promise.resolve();
    await Promise.resolve();
    expect(db.prepare(
      'SELECT ref_count FROM _storage_blobs WHERE checksum = ?',
    ).get(uploaded.checksum)).toEqual({ ref_count: 0 });

    await service.retryBlobCleanup();
    expect(db.prepare(
      'SELECT ref_count FROM _storage_blobs WHERE checksum = ?',
    ).get(uploaded.checksum)).toBeNull();
    await service.stop();
    db.dispose();
  });
});

class FailingWriteAdapter extends LocalStorageAdapter {
  constructor(baseDir: string, private readonly failure: Error) {
    super(baseDir);
  }

  protected override async writeStagedChunk(
    file: FileHandle,
    chunk: Uint8Array
  ): Promise<void> {
    await super.writeStagedChunk(file, chunk);
    throw this.failure;
  }
}

class PausedPublicationAdapter extends LocalStorageAdapter {
  readonly publicationStarted: Promise<void>;
  private markStarted!: () => void;
  private release!: () => void;
  private readonly wait: Promise<void>;

  constructor(baseDir: string) {
    super(baseDir);
    this.publicationStarted = new Promise<void>((resolve) => { this.markStarted = resolve; });
    this.wait = new Promise<void>((resolve) => { this.release = resolve; });
  }

  releasePublication(): void {
    this.release();
  }

  protected override async publishStagedBlob(
    tempPath: string,
    blobPath: string,
    checksum: string,
    size: number,
  ): Promise<void> {
    this.markStarted();
    await this.wait;
    await super.publishStagedBlob(tempPath, blobPath, checksum, size);
  }
}

class FailingPublicationSyncAdapter extends LocalStorageAdapter {
  private syncCalls = 0;

  constructor(baseDir: string, private readonly failure: Error) {
    super(baseDir);
  }

  protected override async syncDirectory(path: string): Promise<void> {
    this.syncCalls += 1;
    // First two calls persist newly-created shard directories. Fail the
    // post-rename destination sync that gates metadata publication.
    if (this.syncCalls === 3) throw this.failure;
    await super.syncDirectory(path);
  }
}

class FailingRemovalSyncAdapter extends LocalStorageAdapter {
  private fail = true;

  protected override syncRemovalDirectory(path: string): void {
    if (this.fail) {
      this.fail = false;
      throw new Error('forced unlink-directory fsync failure');
    }
    super.syncRemovalDirectory(path);
  }
}

class FailingRenameAdapter extends LocalStorageAdapter {
  constructor(baseDir: string, private readonly failure: Error) {
    super(baseDir);
  }

  protected override async renameStagedBlob(): Promise<void> {
    throw this.failure;
  }
}

function nodeError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function bytes(value: number, size: number): Uint8Array {
  return new Uint8Array(size).fill(value);
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function sha256(value: Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

function chunkedStream(value: Uint8Array, chunkSize: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= value.byteLength) {
        controller.close();
        return;
      }
      const nextOffset = Math.min(value.byteLength, offset + chunkSize);
      controller.enqueue(value.slice(offset, nextOffset));
      offset = nextOffset;
    },
  });
}

async function readStoredBlob(baseDir: string, checksum: string): Promise<Uint8Array> {
  return new Uint8Array(
    await readFile(join(baseDir, 'blobs', checksum.slice(0, 2), checksum.slice(2, 4), checksum))
  );
}

async function uploadFiles(baseDir: string): Promise<string[]> {
  return filesBelow(join(baseDir, 'tmp'), (name) => name.startsWith('upload_'));
}

async function blobFiles(baseDir: string): Promise<string[]> {
  return filesBelow(join(baseDir, 'blobs'), () => true);
}

async function filesBelow(
  directory: string,
  include: (name: string) => boolean
): Promise<string[]> {
  if (!existsSync(directory)) return [];
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await filesBelow(path, include)));
    } else if (entry.isFile() && include(entry.name)) {
      found.push(path);
    }
  }
  return found.sort();
}

async function createTestDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'zero-local-storage-adapter-'));
  testDirectories.push(directory);
  return directory;
}
