import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';
import { Elysia, type AnyElysia } from 'elysia';

import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { StorageError, type StorageService } from './storage-service';
import { createStoragePlugin } from './storage.plugin';
import type { StorageAdapter } from './types';

interface MountedStorage {
  app: AnyElysia;
  db: ReactiveDB;
  service: StorageService;
}

describe('storage capability signing-secret lifecycle', () => {
  test('keeps grants valid after a file-backed runtime restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zero-storage-signing-restart-'));
    const dbPath = join(root, 'app.db');
    let first: MountedStorage | null = null;
    let restarted: MountedStorage | null = null;
    try {
      first = mountStorage(dbPath);
      const drive = first.service.drives.create('owner-a', { name: 'Documents' });
      const grant = await first.service.uploads.create(drive.drive_id, {
        path: '/after-restart.txt',
        expiresIn: 60,
      });
      const persistedBefore = storedSigningSecret(first.db);
      expect(persistedBefore).toMatch(/^[A-Za-z0-9_-]{43}$/);

      await closeStorage(first);
      first = null;

      restarted = mountStorage(dbPath);
      expect(storedSigningSecret(restarted.db)).toBe(persistedBefore);
      const response = await executeGrant(restarted.app, grant.token, 'restart-safe');
      expect(response.status).toBe(201);
    } finally {
      if (restarted) await closeStorage(restarted);
      if (first) await closeStorage(first);
      await rm(root, { recursive: true, force: true });
    }
  });

  test('shares one generated key across two live runtimes on the same database', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zero-storage-signing-shared-'));
    const dbPath = join(root, 'app.db');
    let first: MountedStorage | null = null;
    let second: MountedStorage | null = null;
    try {
      first = mountStorage(dbPath);
      second = mountStorage(dbPath);
      expect(storedSigningSecret(second.db)).toBe(storedSigningSecret(first.db));

      const drive = first.service.drives.create('owner-a', { name: 'Shared Documents' });
      const grant = await first.service.uploads.create(drive.drive_id, {
        path: '/other-runtime.txt',
        expiresIn: 60,
      });
      const response = await executeGrant(second.app, grant.token, 'shared-key');
      expect(response.status).toBe(201);
    } finally {
      if (second) await closeStorage(second);
      if (first) await closeStorage(first);
      await rm(root, { recursive: true, force: true });
    }
  });
});

function mountStorage(dbPath: string): MountedStorage {
  const db = createReactiveDB({ mode: 'file', path: dbPath });
  let service: StorageService | null = null;
  const app = new Elysia()
    .use(createStoragePlugin({
      db,
      adapter: createMemoryAdapter(),
      onServiceCreated(created) {
        service = created;
      },
    }))
    .listen(0);
  if (!service) throw new Error('Storage service did not start');
  return { app, db, service };
}

async function closeStorage(mounted: MountedStorage): Promise<void> {
  await mounted.app.stop(true);
  mounted.db.dispose();
}

function storedSigningSecret(db: ReactiveDB): string {
  const row = db.prepare(`
    SELECT value FROM _auth_config
    WHERE key = 'storage_capability_signing_secret'
  `).get() as { value?: unknown } | null;
  if (typeof row?.value !== 'string') throw new Error('Storage signing secret was not persisted');
  return row.value;
}

function executeGrant(app: AnyElysia, token: string, body: string): Promise<Response> {
  return Promise.resolve(app.handle(new Request(
    `http://storage.test/storage/upload-grants/${token}`,
    { method: 'PUT', body },
  )));
}

function createMemoryAdapter(): StorageAdapter {
  const blobs = new Map<string, Uint8Array>();
  return {
    writeShutdownSafety: 'cooperative',
    async writeBlob(data, maxSize) {
      const bytes = await readBytes(data);
      if (maxSize !== undefined && bytes.byteLength > maxSize) {
        throw new StorageError(413, `File exceeds max size: ${maxSize} bytes`);
      }
      const checksum = `memory_${crypto.randomUUID()}`;
      blobs.set(checksum, bytes);
      return {
        checksum,
        size: bytes.byteLength,
        headBytes: bytes.slice(0, 512),
      };
    },
    async readBlob(checksum) {
      const bytes = blobs.get(checksum);
      return bytes ? streamBytes(bytes) : null;
    },
    async readBlobRange(checksum, start, end) {
      const bytes = blobs.get(checksum);
      return bytes ? streamBytes(bytes.slice(start, end + 1)) : null;
    },
    async removeBlob(checksum) {
      blobs.delete(checksum);
    },
    removeBlobSync(checksum) {
      blobs.delete(checksum);
    },
    async blobExists(checksum) {
      return blobs.has(checksum);
    },
    async blobSize(checksum) {
      return blobs.get(checksum)?.byteLength ?? 0;
    },
  };
}

async function readBytes(
  data: ReadableStream<Uint8Array> | Uint8Array | Blob,
): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data;
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  return new Uint8Array(await new Response(data).arrayBuffer());
}

function streamBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}
