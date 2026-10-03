import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import type { AuthorizationRoleAssignmentResolver } from '../auth/authorization-access';
import { createAuthorizationKernel } from '../auth/authorization-kernel';
import type { AuthorizationRoleSet } from '../auth/authorization-role-types';
import { trustedSystemServiceDataScope } from '../auth/service-data-scope';
import type { TokenService } from '../auth/token-service';
import type { AuthContext } from '../auth/types';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { StorageAdapter } from './types';
import type { StorageService } from './storage-service';
import { createStoragePlugin } from './storage.plugin';

const TENANT_A = 'tenant_storage_alpha';
const TENANT_B = 'tenant_storage_beta';

interface Harness {
  app: ReturnType<typeof createHarnessApp>;
  baseUrl: string;
  db: ReactiveDB;
  storage: StorageService;
}

const active: Harness[] = [];

afterEach(async () => {
  for (const harness of active.splice(0).reverse()) {
    await harness.app.stop(true);
    harness.db.dispose();
  }
});

describe('storage multi-tenant role projection', () => {
  test('uses live advanced assignments, never platform or membership-role fallbacks', async () => {
    const harness = startHarness();
    const scope = trustedSystemServiceDataScope({
      scopeKind: 'tenant',
      tenantId: TENANT_A,
    });
    const drive = harness.storage.createDrive(
      'owner-user',
      { name: 'Role-projected files' },
      scope,
    );

    harness.storage.grantPermission(drive.drive_id, {
      grantType: 'role',
      grantValue: 'member',
      permission: 'read',
    });

    // The token intentionally says both platform admin and tenant member.
    // Neither compatibility field is an advanced tenant assignment.
    expect(await listDriveIds(harness, 'platform-admin-reader')).toEqual([]);
    expect((await request(
      harness,
      `/storage/drives/${drive.drive_id}/capabilities`,
      'platform-admin-reader',
    )).status).toBe(403);

    harness.storage.grantPermission(drive.drive_id, {
      grantType: 'role',
      grantValue: 'reader',
      permission: 'read',
    });

    expect(await listDriveIds(harness, 'platform-admin-reader')).toEqual([
      drive.drive_id,
    ]);
    const allowed = await request<{
      canRead: boolean;
      canWrite: boolean;
      isPlatformAdmin: boolean;
    }>(
      harness,
      `/storage/drives/${drive.drive_id}/capabilities`,
      'platform-admin-reader',
    );
    expect(allowed).toMatchObject({
      status: 200,
      body: {
        canRead: true,
        canWrite: false,
        isPlatformAdmin: false,
      },
    });

    // A role assignment in another live tenant cannot consume the grant.
    expect(await listDriveIds(harness, 'other-tenant-reader')).toEqual([]);
  });
});

function startHarness(): Harness {
  const db = createReactiveDB({ mode: 'memory' });
  const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({
    tenancy: 'multi',
    authorization: {
      mode: 'advanced',
      roles: {
        admin: { permissions: [] },
        reader: { permissions: [] },
      },
    },
  }));
  const contexts = new Map<string, AuthContext>([
    ['platform-admin-reader', tenantContext(
      'reader-user',
      'admin',
      TENANT_A,
      'membership-reader-a',
    )],
    ['other-tenant-reader', tenantContext(
      'other-reader-user',
      'admin',
      TENANT_B,
      'membership-reader-b',
    )],
  ]);
  const tokenService = {
    async resolveAuthContext(token: string) {
      return contexts.get(token) ?? null;
    },
  } as TokenService;
  const assignments: AuthorizationRoleAssignmentResolver = {
    resolveApplicationRoles() { return null; },
    resolveTenantRoles(input): AuthorizationRoleSet {
      return Object.freeze({
        scopeKind: 'tenant',
        scopeId: input.tenantId,
        tenantId: input.tenantId,
        membershipId: input.membershipId,
        userId: input.userId,
        // A tenant assignment named `admin` is intentionally just a normal
        // role. Storage must not confuse it with legacy platform authority.
        roles: Object.freeze(['admin', 'reader']),
        revision: `roles:${input.tenantId}:${input.userId}`,
      });
    },
  };
  let storage: StorageService | null = null;
  const app = createHarnessApp(
    db,
    tokenService,
    {
      getAuthorizationKernel: () => kernel,
      getPropertyStore: () => null,
      getRoleAssignments: () => assignments,
    },
    (service) => { storage = service; },
  );
  app.listen(0);
  if (!storage) throw new Error('Storage service did not start');
  const harness = {
    app,
    baseUrl: `http://localhost:${app.server!.port}`,
    db,
    storage,
  };
  active.push(harness);
  return harness;
}

function createHarnessApp(
  db: ReactiveDB,
  tokens: TokenService,
  authorization: {
    getAuthorizationKernel: () => ReturnType<typeof createAuthorizationKernel>;
    getPropertyStore: () => null;
    getRoleAssignments: () => AuthorizationRoleAssignmentResolver;
  },
  onStorage: (service: StorageService) => void,
) {
  return new Elysia().use(createStoragePlugin({
    db,
    adapter: emptyStorageAdapter(),
    getTokenService: () => tokens,
    authorization,
    onServiceCreated: onStorage,
  }));
}

function tenantContext(
  userId: string,
  platformRole: string,
  tenantId: string,
  membershipId: string,
): AuthContext {
  return {
    userId,
    email: `${userId}@example.test`,
    role: platformRole,
    sessionKind: 'web',
    sessionId: `session-${userId}-${tenantId}`,
    sessionGeneration: 0,
    sessionScopeKind: 'tenant',
    sessionScopeId: tenantId,
    tenantId,
    membershipId,
    // Compatibility metadata deliberately disagrees with the live assignment.
    tenantRole: 'member',
    tenantAuthorizationGeneration: 0,
    membershipAuthorizationGeneration: 0,
  };
}

async function listDriveIds(harness: Harness, token: string): Promise<string[]> {
  const response = await request<Array<{ drive_id: string }>>(
    harness,
    '/storage/drives',
    token,
  );
  expect(response.status).toBe(200);
  return response.body.map((drive) => drive.drive_id);
}

async function request<T = Record<string, unknown>>(
  harness: Harness,
  path: string,
  token: string,
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${harness.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({})) as T,
  };
}

function emptyStorageAdapter(): StorageAdapter {
  return {
    writeShutdownSafety: 'cooperative',
    async writeBlob() {
      return { checksum: 'unused', size: 0, headBytes: new Uint8Array() };
    },
    async readBlob() { return null; },
    async readBlobRange() { return null; },
    async removeBlob() {},
    removeBlobSync() {},
    async blobExists() { return true; },
    async blobSize() { return 0; },
  };
}
