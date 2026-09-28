import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import type { TokenService } from '../auth/token-service';
import { ZeroRuntimeAmbiguousError } from '../runtime/compatibility-provider-registry';
import { ZERO_STORAGE_SERVICE } from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { createPresignedToken } from './presigned';
import { StorageError, type StorageService } from './storage-service';
import { createStoragePlugin, getStorageService } from './storage.plugin';
import type { StorageAccessCapabilities, StorageAdapter } from './types';

interface StorageApp {
  handle(request: Request): Response | Promise<Response>;
  stop(closeActiveConnections?: boolean): Promise<unknown>;
}

interface MountedStorageApp {
  app: StorageApp;
  db: ReactiveDB;
  runtime: ZeroAppRuntime;
  service: StorageService;
}

const mountedApps: MountedStorageApp[] = [];

afterEach(async () => {
  for (const mounted of mountedApps.splice(0).reverse()) {
    await mounted.app.stop(true);
    mounted.db.dispose();
  }
});

describe('storage plugin runtime isolation', () => {
  test('isolates routes, signing secrets, policy dependencies, and lifecycle state', async () => {
    const storageA = mountStorageApp('a', 'storage-secret-a', 'team-a');
    const storageB = mountStorageApp('b', 'storage-secret-b', 'team-b');

    expect(storageA.runtime.get(ZERO_STORAGE_SERVICE)).toBe(storageA.service);
    expect(storageB.runtime.get(ZERO_STORAGE_SERVICE)).toBe(storageB.service);
    expect(() => getStorageService()).toThrow(ZeroRuntimeAmbiguousError);

    const driveA = storageA.service.drives.create('owner-a', {
      name: 'A documents',
      public: true,
    });
    const driveB = storageB.service.drives.create('owner-b', {
      name: 'B documents',
      public: true,
    });

    const listA = await requestJson<Array<{ drive_id: string }>>(
      storageA.app,
      '/storage/drives',
    );
    const listB = await requestJson<Array<{ drive_id: string }>>(
      storageB.app,
      '/storage/drives',
    );
    expect(listA.status).toBe(200);
    expect(listA.data.map((drive) => drive.drive_id)).toEqual([driveA.drive_id]);
    expect(listB.status).toBe(200);
    expect(listB.data.map((drive) => drive.drive_id)).toEqual([driveB.drive_id]);

    expect(() => storageA.service.permissions.grant(driveA.drive_id, {
      grantType: 'property',
      grantKey: 'team-a',
      grantValue: 'engineering',
      permission: 'read',
    })).not.toThrow();
    expect(() => storageA.service.permissions.grant(driveA.drive_id, {
      grantType: 'property',
      grantKey: 'team-b',
      grantValue: 'engineering',
      permission: 'read',
    })).toThrow(StorageError);
    expect(() => storageB.service.permissions.grant(driveB.drive_id, {
      grantType: 'property',
      grantKey: 'team-b',
      grantValue: 'engineering',
      permission: 'read',
    })).not.toThrow();

    const privateA = storageA.service.drives.create('owner-a', {
      name: 'A property-scoped drive',
    });
    storageA.service.permissions.grant(privateA.drive_id, {
      grantType: 'property',
      grantKey: 'team-a',
      grantValue: 'member',
      permission: 'read',
    });
    const injectedAuthAccess = await requestJson<StorageAccessCapabilities>(
      storageA.app,
      `/storage/drives/${privateA.drive_id}/capabilities`,
      { headers: { Authorization: 'Bearer a-token' } },
    );
    expect(injectedAuthAccess.status).toBe(200);
    expect(injectedAuthAccess.data.effectiveAccess).toBe('read');

    const otherAppToken = await requestJson<{ error: string }>(
      storageA.app,
      `/storage/drives/${privateA.drive_id}/capabilities`,
      { headers: { Authorization: 'Bearer b-token' } },
    );
    expect(otherAppToken.status).toBe(401);

    await storageA.service.objects.upload(
      driveA.drive_id,
      '/from-a.txt',
      new TextEncoder().encode('bytes owned by A'),
      'from-a.txt',
      'owner-a',
      { public: true },
    );
    const tokenA = await createPresignedToken({
      driveId: driveA.drive_id,
      path: '/from-a.txt',
      method: 'download',
      expiresIn: 60,
      secret: 'storage-secret-a',
    });

    const signedA = await storageA.app.handle(
      new Request(`http://a.test/storage/presigned/${tokenA}`),
    );
    expect(signedA.status).toBe(200);

    const rejectedByB = await storageB.app.handle(
      new Request(`http://b.test/storage/presigned/${tokenA}`),
    );
    expect(rejectedByB.status).toBe(403);

    const uploadGrantA = await storageA.service.uploads.create(
      driveA.drive_id,
      { path: '/grant-a.txt', expiresIn: 60 },
    );
    const grantAcceptedByA = await storageA.app.handle(new Request(
      `http://a.test/storage/upload-grants/${uploadGrantA.token}`,
      { method: 'PUT', body: 'grant bytes' },
    ));
    expect(grantAcceptedByA.status).toBe(201);

    const grantRejectedByB = await storageB.app.handle(new Request(
      `http://b.test/storage/upload-grants/${uploadGrantA.token}`,
      { method: 'PUT', body: 'wrong app' },
    ));
    expect(grantRejectedByB.status).toBe(403);

    await storageB.app.stop(true);
    mountedApps.splice(mountedApps.indexOf(storageB), 1);
    storageB.db.dispose();

    expect(storageB.runtime.get(ZERO_STORAGE_SERVICE)).toBeNull();
    expect(storageA.runtime.get(ZERO_STORAGE_SERVICE)).toBe(storageA.service);
    expect(getStorageService()).toBe(storageA.service);

    const afterBStops = await requestJson<Array<{ drive_id: string }>>(
      storageA.app,
      '/storage/drives',
    );
    expect(afterBStops.status).toBe(200);
    expect(afterBStops.data.map((drive) => drive.drive_id)).toEqual([
      driveA.drive_id,
    ]);

    await storageA.app.stop(true);
    mountedApps.splice(mountedApps.indexOf(storageA), 1);
    storageA.db.dispose();

    expect(storageA.runtime.get(ZERO_STORAGE_SERVICE)).toBeNull();
    expect(getStorageService()).toBeNull();
  });
});

function mountStorageApp(
  name: string,
  signingSecret: string,
  trustedProperty: string,
): MountedStorageApp {
  const db = createReactiveDB({ mode: 'memory' });
  const runtime = new ZeroAppRuntime(`storage-${name}`);
  const tokenService = {
    async resolveAuthContext(token: string) {
      return token === `${name}-token`
        ? {
            userId: `member-${name}`,
            email: `member-${name}@example.test`,
            role: 'user',
          }
        : null;
    },
  } as unknown as TokenService;
  let service: StorageService | null = null;
  const app = new Elysia({ name: `storage-isolation-${name}` })
    .use(createStoragePlugin({
      db,
      runtime,
      adapter: createMemoryAdapter(),
      signingSecret,
      getTokenService: () => tokenService,
      getUserProperties: (userId) => userId === `member-${name}`
        ? { [trustedProperty]: 'member' }
        : {},
      isPolicyTrustedProperty: (key) => key === trustedProperty,
      onServiceCreated(created) {
        service = created;
      },
    }))
    .listen(0);

  if (!service) throw new Error('Storage service did not start');
  const mounted: MountedStorageApp = { app, db, runtime, service };
  mountedApps.push(mounted);
  return mounted;
}

function createMemoryAdapter(): StorageAdapter {
  const blobs = new Map<string, Uint8Array>();

  return {
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

  const reader = data.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    size += value.byteLength;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function streamBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(copy);
      controller.close();
    },
  });
}

async function requestJson<T>(
  app: StorageApp,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; data: T }> {
  const response = await app.handle(
    new Request(`http://storage.test${path}`, init),
  );
  return {
    status: response.status,
    data: await response.json() as T,
  };
}
