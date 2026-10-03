import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import { AuthAuditService } from '../auth/auth-audit-service';
import { resolveAuthAuditConfig } from '../auth/auth-audit-config';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { createRequestAuthorizationAccess } from '../auth/authorization-access';
import { createAuthorizationKernel } from '../auth/authorization-kernel';
import { defineAuthTables } from '../auth/auth-schema';
import { trustedSystemServiceDataScope } from '../auth/service-data-scope';
import type { TokenService } from '../auth/token-service';
import type { AuthContext } from '../auth/types';
import { createScopedStorageService } from '../frontend/server/server-request-services/scoped-storage-service';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { resolveStorageStudioConfig } from './storage-config';
import { StoragePermissionService } from './storage-permission-service';
import {
  StorageService,
  defineStorageTables,
} from './storage-service';
import { defineStorageStudioTables } from './storage-studio-schema';
import { StorageStudioService } from './storage-studio-service';
import { createStoragePlugin } from './storage.plugin';
import type {
  GrantPermissionParams,
  StorageAdapter,
} from './types';

interface AuditRow {
  action: string;
  scope_kind: string;
  tenant_id: string | null;
  actor_user_id: string | null;
  actor_session_id: string | null;
  actor_client_id: string | null;
  actor_provenance: string;
  target_id: string | null;
  metadata_json: string;
}

const runningApps: Array<{
  app: { stop(closeActiveConnections?: boolean): unknown };
  db: ReactiveDB;
}> = [];

afterEach(async () => {
  for (const current of runningApps.splice(0).reverse()) {
    await current.app.stop(true);
    current.db.dispose();
  }
});

describe('Storage ACL input hardening', () => {
  test('rejects hostile direct StoragePermissionService grants before persistence', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      defineStorageTables(db);
      const storage = new StorageService(db, memoryAdapter());
      const drive = storage.createDrive('owner', { name: 'ACL validation' });
      const permissions = new StoragePermissionService(db, {
        tenancyMode: 'single',
        isPolicyTrustedProperty: (key) => key === 'department',
      });
      const valid: GrantPermissionParams = {
        grantType: 'role',
        grantValue: 'member',
        permission: 'read',
      };
      const hostile: GrantPermissionParams[] = [
        { ...valid, grantType: 'group' as never },
        { ...valid, permission: 'execute' as never },
        { ...valid, grantValue: '' },
        { ...valid, grantValue: '   ' },
        { ...valid, grantValue: 'member\u0000admin' },
        { ...valid, grantValue: 'x'.repeat(201) },
        {
          grantType: 'property',
          grantKey: 42 as never,
          grantValue: 'engineering',
          permission: 'read',
        },
        {
          grantType: 'property',
          grantValue: 'engineering',
          permission: 'read',
        },
        {
          grantType: 'property',
          grantKey: '   ',
          grantValue: 'engineering',
          permission: 'read',
        },
        {
          grantType: 'property',
          grantKey: 'department\u0000admin',
          grantValue: 'engineering',
          permission: 'read',
        },
        {
          grantType: 'property',
          grantKey: 'x'.repeat(101),
          grantValue: 'engineering',
          permission: 'read',
        },
        {
          grantType: 'property',
          grantKey: 'selfReportedDepartment',
          grantValue: 'engineering',
          permission: 'read',
        },
      ];

      for (const input of hostile) {
        expect(() => permissions.grant(drive.drive_id, input)).toThrow(
          expect.objectContaining({
            code: 'STORAGE_INPUT_INVALID',
            status: 400,
          }),
        );
      }
      expect(permissions.list(drive.drive_id)).toEqual([]);
    } finally {
      db.dispose();
    }
  });

  test('normalizes rejected HTTP grants into the canonical Storage failure', async () => {
    const harness = startHttpHarness();
    const drive = harness.storage.createDrive('http-admin', { name: 'HTTP ACLs' });
    const endpoint = `${harness.baseUrl}/storage/drives/${drive.drive_id}/permissions`;
    const invalidBodies = [
      {
        grantType: 'group',
        grantValue: 'member',
        permission: 'read',
      },
      {
        grantType: 'role',
        grantValue: 'member',
        permission: 'execute',
      },
      {
        grantType: 'role',
        grantValue: ' ',
        permission: 'read',
      },
      {
        grantType: 'property',
        grantKey: 'x'.repeat(101),
        grantValue: 'engineering',
        permission: 'read',
      },
    ];

    for (const body of invalidBodies) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: requestHeaders('http-admin-token'),
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: 'Storage input is invalid.',
        code: 'STORAGE_INPUT_INVALID',
      });
    }
    expect(harness.storage.listPermissions(drive.drive_id)).toEqual([]);
  });
});

describe('Storage ACL durable audit', () => {
  test('records secret-free drive grant and revoke events through HTTP', async () => {
    const harness = startHttpHarness();
    const drive = harness.storage.createDrive('http-admin', { name: 'HTTP audit' });
    const endpoint = `${harness.baseUrl}/storage/drives/${drive.drive_id}/permissions`;
    const grantValue = 'sensitive-role-value';

    const granted = await fetch(endpoint, {
      method: 'POST',
      headers: requestHeaders('http-admin-token'),
      body: JSON.stringify({
        grantType: 'role',
        grantValue,
        permission: 'admin',
      }),
    });
    expect(granted.status).toBe(200);
    const permission = await granted.json() as { permission_id: string };

    const revoked = await fetch(
      `${harness.baseUrl}/storage/permissions/${permission.permission_id}`,
      {
        method: 'DELETE',
        headers: { Authorization: 'Bearer http-admin-token' },
      },
    );
    expect(revoked.status).toBe(200);

    const rows = readAclAudit(harness.db);
    expect(rows.map((row) => row.action)).toEqual([
      'storage.permission-granted',
      'storage.permission-revoked',
    ]);
    for (const row of rows) {
      expect(row.scope_kind).toBe('application');
      expect(row.tenant_id).toBeNull();
      expect(row.actor_user_id).toBe('http-admin');
      expect(row.actor_session_id).toBe('http-admin-session');
      expect(row.actor_provenance).toBe('authenticated-request');
      expect(row.target_id).toBe(drive.drive_id);
      expect(JSON.parse(row.metadata_json)).toEqual({
        permission_id: permission.permission_id,
        acl_scope: 'drive',
        object_id: null,
        grant_type: 'role',
        permission: 'admin',
      });
      expect(row.metadata_json).not.toContain(grantValue);
      expect(row.metadata_json.toLowerCase()).not.toContain('secret');
      expect(row.metadata_json).not.toContain('grant_value');
    }
  });

  test('records scoped Torrent ACL changes as a system continuation of the actor', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      defineAuthTables(db);
      defineStorageTables(db);
      defineStorageStudioTables(db);
      seedTenantIdentity(db, 'tenant-a', 'membership-a');
      const audit = new AuthAuditService(db, resolveAuthAuditConfig(undefined));
      const storage = new StorageService(db, memoryAdapter(), {
        tenancyMode: 'multi',
        aclAudit: audit,
      });
      const studio = new StorageStudioService({
        db,
        storage,
        config: resolveStorageStudioConfig({
          enabled: true,
          organizationDrives: true,
          defaultGrants: [],
        }),
        tenancyMode: 'multi',
      });
      storage.attachStudioService(studio);
      const scoped = scopedTenantStorage(
        storage,
        'tenant-a',
        'membership-a',
        'system',
      );
      const provisioned = scoped.studio!.drives.provision({
        operationId: 'acl-audit-provision',
        owner: 'organization',
        key: 'audited-files',
        name: 'Audited files',
        creatorAccess: 'admin',
      });
      const drive = scoped.studio!.drives.get(provisioned.value.drive.drive_id);
      const folder = drive.objects.createFolder('/records');
      const grantValue = 'sensitive-machine-role';
      const permission = drive.permissions.grant({
        objectPath: '/records',
        grantType: 'role',
        grantValue,
        permission: 'write',
      });
      expect(drive.permissions.revoke(permission.permission_id)).toBe(true);

      const rows = readAclAudit(db);
      expect(rows.map((row) => row.action)).toEqual([
        'storage.permission-granted',
        'storage.permission-revoked',
      ]);
      for (const row of rows) {
        expect(row.scope_kind).toBe('tenant');
        expect(row.tenant_id).toBe('tenant-a');
        expect(row.actor_user_id).toBe('user-tenant-a');
        expect(row.actor_session_id).toBeNull();
        expect(row.actor_client_id).toBeNull();
        expect(row.actor_provenance).toBe('system');
        expect(row.target_id).toBe(provisioned.value.drive.drive_id);
        expect(JSON.parse(row.metadata_json)).toEqual({
          permission_id: permission.permission_id,
          acl_scope: 'object',
          object_id: folder.id,
          grant_type: 'role',
          permission: 'write',
        });
        expect(row.metadata_json).not.toContain(grantValue);
        expect(row.metadata_json.toLowerCase()).not.toContain('secret');
        expect(row.metadata_json).not.toContain('grant_value');
      }
    } finally {
      db.dispose();
    }
  });
});

function startHttpHarness(): {
  baseUrl: string;
  db: ReactiveDB;
  storage: StorageService;
} {
  const db = createReactiveDB({ mode: 'memory' });
  defineAuthTables(db);
  const audit = new AuthAuditService(db, resolveAuthAuditConfig(undefined));
  const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({
    tenancy: 'single',
  }));
  const context = applicationAdminContext();
  const tokens = {
    async resolveAuthContext(token: string) {
      return token === 'http-admin-token' ? context : null;
    },
    captureAuthContextAuthority(admitted: AuthContext) {
      return admitted === context ? ({ fixture: true } as never) : null;
    },
    resolveAuthContextAuthority() {
      return context;
    },
  } as unknown as TokenService;
  let storage: StorageService | null = null;
  const app = new Elysia().use(createStoragePlugin({
    db,
    adapter: memoryAdapter(),
    getTokenService: () => tokens,
    getAuditService: () => audit,
    authorization: {
      getAuthorizationKernel: () => kernel,
      getPropertyStore: () => null,
    },
    onServiceCreated(service) {
      storage = service;
    },
  })).listen(0);
  if (!storage) throw new Error('Storage plugin did not start.');
  runningApps.push({ app, db });
  return {
    baseUrl: `http://localhost:${app.server!.port}`,
    db,
    storage,
  };
}

function scopedTenantStorage(
  storage: StorageService,
  tenantId: string,
  membershipId: string,
  auditProvenance: 'authenticated-request' | 'system' = 'authenticated-request',
): ReturnType<typeof createScopedStorageService> {
  const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({
    tenancy: 'multi',
    authorization: {
      mode: 'simple',
      roles: { owner: { allPermissions: true } },
    },
  }));
  const context = tenantOwnerContext(tenantId, membershipId);
  const access = createRequestAuthorizationAccess({
    authContext: context,
    kernel,
    propertyStore: { getProperties: () => ({}) },
  });
  return createScopedStorageService(
    storage,
    trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId }),
    access,
    () => ({}),
    async () => {},
    () => {},
    false,
    auditProvenance,
  );
}

function readAclAudit(db: ReactiveDB): AuditRow[] {
  return db.prepare(`
    SELECT action, scope_kind, tenant_id, actor_user_id, actor_session_id,
      actor_client_id, actor_provenance, target_id, metadata_json
    FROM _auth_audit_events
    WHERE action IN ('storage.permission-granted', 'storage.permission-revoked')
    ORDER BY occurred_at ASC, rowid ASC
  `).all() as AuditRow[];
}

function requestHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
}

function applicationAdminContext(): AuthContext {
  return {
    userId: 'http-admin',
    email: 'http-admin@example.test',
    role: 'admin',
    sessionKind: 'web',
    sessionId: 'http-admin-session',
    sessionGeneration: 0,
    sessionScopeKind: 'application',
    sessionScopeId: 'application',
  };
}

function tenantOwnerContext(tenantId: string, membershipId: string): AuthContext {
  return {
    userId: `user-${tenantId}`,
    email: `${tenantId}@example.test`,
    role: 'user',
    sessionKind: 'web',
    sessionId: `session-${tenantId}`,
    sessionGeneration: 0,
    sessionScopeKind: 'tenant',
    sessionScopeId: tenantId,
    tenantId,
    membershipId,
    tenantRole: 'owner',
    tenantAuthorizationGeneration: 0,
    membershipAuthorizationGeneration: 0,
  };
}

function seedTenantIdentity(
  db: ReactiveDB,
  tenantId: string,
  membershipId: string,
): void {
  const userId = `user-${tenantId}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO users (
      user_id, username, email, role, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'user', 'active', ?, ?)
  `).run(userId, userId, `${tenantId}@example.test`, now, now);
  db.prepare(`
    INSERT INTO _auth_tenants (
      tenant_id, slug, name, status, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, 'active', ?, ?, ?)
  `).run(tenantId, tenantId, tenantId, userId, now, now);
  db.prepare(`
    INSERT INTO _auth_tenant_memberships (
      membership_id, tenant_id, user_id, status, role_key,
      joined_at, created_at, updated_at, created_by
    ) VALUES (?, ?, ?, 'active', 'owner', ?, ?, ?, ?)
  `).run(membershipId, tenantId, userId, now, now, now, userId);
}

function memoryAdapter(): StorageAdapter {
  return {
    writeShutdownSafety: 'cooperative',
    supportedStudioIsolation: ['shared-cas'],
    async writeBlob(data) {
      const bytes = data instanceof Uint8Array
        ? data
        : data instanceof Blob
          ? new Uint8Array(await data.arrayBuffer())
          : new Uint8Array(await new Response(data).arrayBuffer());
      return {
        checksum: `test-${crypto.randomUUID()}`,
        size: bytes.byteLength,
        headBytes: bytes,
      };
    },
    async readBlob() { return null; },
    async readBlobRange() { return null; },
    async removeBlob() {},
    removeBlobSync() {},
    async blobExists() { return true; },
    async blobSize() { return 0; },
  };
}
