/**
 * Proves storage role grants consume the complete live advanced-RBAC role set
 * projected by auth middleware, rather than the legacy users.role column.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import { createAuthPlugin } from '../auth/auth.plugin';
import type { AuthRuntime } from '../auth/auth-runtime';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { StorageAdapter, StorageAccessCapabilities } from './types';
import { createStoragePlugin } from './storage.plugin';
import type { StorageService } from './storage-service';

let db: ReactiveDB;
let app: ReturnType<typeof createAdvancedStorageApp> | null = null;
let authRuntime: AuthRuntime;
let storage: StorageService;
let baseUrl = '';

const adapter: StorageAdapter = {
  writeShutdownSafety: 'cooperative',
  async writeBlob() {
    return { checksum: crypto.randomUUID(), size: 0, headBytes: new Uint8Array() };
  },
  async readBlob() { return null; },
  async readBlobRange() { return null; },
  async removeBlob() {},
  removeBlobSync() {},
  async blobExists() { return true; },
  async blobSize() { return 0; },
};

beforeAll(async () => {
  db = createReactiveDB({ mode: 'memory' });
  const startedApp = createAdvancedStorageApp();
  app = startedApp;
  baseUrl = `http://localhost:${startedApp.server!.port}`;

  for (let attempt = 0; attempt < 20; attempt++) {
    if (authRuntime.getStore() && authRuntime.getTokenService() && storage) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Advanced auth and storage plugins did not start');
});

function createAdvancedStorageApp() {
  return new Elysia()
    .use(createAuthPlugin({
      db,
      bootstrap: 'public',
      authorization: {
        mode: 'advanced',
        permissions: {
          'documents:read': { label: 'Read documents' },
        },
        roles: {
          reader: { permissions: ['documents:read'] },
          reporter: { permissions: [] },
        },
      },
      onRuntimeCreated(runtime) {
        authRuntime = runtime;
      },
    }))
    .use(createStoragePlugin({
      db,
      adapter,
      getTokenService: () => authRuntime.getTokenService(),
      authorization: {
        getAuthorizationKernel: () => authRuntime.getAuthorizationKernel(),
        getPropertyStore: () => authRuntime.getStore(),
        getRoleAssignments: () => authRuntime.getAuthorizationRoleService(),
      },
      onServiceCreated(service) {
        storage = service;
      },
    }))
    .listen(0);
}

afterAll(async () => {
  await app?.stop(true);
  app = null;
  db.dispose();
});

describe('storage advanced RBAC integration', () => {
  test('honors every retained role without changing the legacy single-role API', async () => {
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
    const legacyAdmin = await users.createUser({
      username: `legacy_admin_${crypto.randomUUID()}`,
      email: `${crypto.randomUUID()}@test.local`,
      password: 'password123',
      role: 'admin',
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
    roles.assignApplicationRole({
      userId: legacyAdmin.userId,
      roleKey: 'reporter',
      createdBy: owner.userId,
    });

    const drive = storage.drives.create(owner.userId, { name: 'Advanced grants' });
    storage.permissions.grant(drive.drive_id, {
      grantType: 'role',
      grantValue: 'reader',
      permission: 'read',
    });

    // The service remains source-compatible for legacy callers while accepting
    // the additive role set used by advanced authorization.
    expect(storage.permissions.checkAccess(
      drive.drive_id,
      null,
      member.userId,
      ['reporter', 'reader'],
      {},
      'read',
    )).toBe(true);

    const pair = await tokens.issueTokenPair(member);
    const response = await fetch(
      `${baseUrl}/storage/drives/${drive.drive_id}/capabilities`,
      { headers: { Authorization: `Bearer ${pair.accessToken}` } },
    );
    expect(response.status).toBe(200);
    const capabilities = await response.json() as StorageAccessCapabilities;
    expect(capabilities.canRead).toBe(true);
    expect(capabilities.canWrite).toBe(false);
    expect(capabilities.effectiveAccess).toBe('read');

    // Advanced assignments are additive in single mode; they must not erase
    // the historical global-admin Storage contract.
    const adminPair = await tokens.issueTokenPair(legacyAdmin);
    const adminResponse = await fetch(
      `${baseUrl}/storage/drives/${drive.drive_id}/capabilities`,
      { headers: { Authorization: `Bearer ${adminPair.accessToken}` } },
    );
    expect(adminResponse.status).toBe(200);
    expect(await adminResponse.json()).toMatchObject({
      canRead: true,
      canWrite: true,
      canAdmin: true,
      isPlatformAdmin: true,
    });
  });
});
