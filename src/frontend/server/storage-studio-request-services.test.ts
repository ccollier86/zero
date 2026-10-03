import { describe, expect, test } from 'bun:test';

import { resolveAuthBehaviorConfig } from '../../auth/auth-config';
import { createRequestAuthorizationAccess } from '../../auth/authorization-access';
import { createAuthorizationKernel } from '../../auth/authorization-kernel';
import { defineAuthTables } from '../../auth/auth-schema';
import { trustedSystemServiceDataScope } from '../../auth/service-data-scope';
import type { AuthContext } from '../../auth/types';
import { createReactiveDB } from '../../sync/reactive-db';
import { resolveStorageStudioConfig } from '../../storage/storage-config';
import { StorageStudioIngressPolicy } from '../../storage/storage-studio-ingress-policy';
import {
  StorageService,
  defineStorageTables,
} from '../../storage/storage-service';
import { defineStorageStudioTables } from '../../storage/storage-studio-schema';
import { StorageStudioService } from '../../storage/storage-studio-service';
import type { StorageAdapter } from '../../storage/types';
import { createScopedStorageService } from './server-request-services/scoped-storage-service';

describe('request-scoped Storage Studio', () => {
  test('projects one live tenant authority and hides trusted composition seams', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      defineAuthTables(db);
      defineStorageTables(db);
      defineStorageStudioTables(db);
      seedTenantIdentity(db, 'ten_alpha', 'mem_alpha');
      seedTenantIdentity(db, 'ten_beta', 'mem_beta');
      const storage = new StorageService(db, memoryAdapter(), { tenancyMode: 'multi' });
      const studio = new StorageStudioService({
        db,
        storage,
        config: resolveStorageStudioConfig({
          enabled: true,
          organizationDrives: true,
          defaultGrants: [{
            grantType: 'role',
            grantValue: 'owner',
            permission: 'admin',
          }],
        }),
        tenancyMode: 'multi',
      });
      storage.attachStudioService(studio);

      let synchronousFences = 0;
      let asynchronousFences = 0;
      const alpha = scopedStorage(storage, 'ten_alpha', 'mem_alpha', {
        asynchronous: async () => { asynchronousFences += 1; },
        synchronous: () => { synchronousFences += 1; },
      });

      expect(storage.studio).toBeNull();
      expect(alpha.studio).not.toBeNull();
      const hidden = alpha as unknown as StorageService;
      expect(() => hidden.getAttachedStudioService()).toThrow('not available');
      expect(() => hidden.attachStudioService(studio)).toThrow('not available');

      const provisioned = alpha.studio!.drives.provision({
        operationId: 'provision-artifacts',
        owner: 'organization',
        key: 'artifacts',
        name: 'Artifacts',
        creatorAccess: 'admin',
      });
      expect(provisioned.value.drive.tenant_id).toBe('ten_alpha');
      expect(alpha.studio!.drives.open('artifacts').catalog.profile.ownerKind)
        .toBe('organization');

      const beta = scopedStorage(storage, 'ten_beta', 'mem_beta');
      expect(() => beta.studio!.drives.open('artifacts')).toThrow();

      await alpha.studio!.drives.lifecycle(provisioned.value.drive.drive_id, {
        operationId: 'suspend-artifacts',
        expectedRevision: provisioned.value.profile.revision,
        action: 'suspend',
      });
      expect(asynchronousFences).toBe(1);
      expect(synchronousFences).toBeGreaterThan(0);
    } finally {
      db.dispose();
    }
  });

  test('enforces managed lifecycle and public-object policy across scoped machine objects', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      defineAuthTables(db);
      defineStorageTables(db);
      defineStorageStudioTables(db);
      seedTenantIdentity(db, 'ten_alpha', 'mem_alpha');
      const config = resolveStorageStudioConfig({
        enabled: true,
        organizationDrives: true,
        publicAccess: { allowPublicObjects: false },
        defaultGrants: [{
          grantType: 'role',
          grantValue: 'owner',
          permission: 'admin',
        }],
      });
      const storage = new StorageService(db, memoryAdapter(), {
        tenancyMode: 'multi',
        managedObjectPolicy: new StorageStudioIngressPolicy(db, config),
      });
      const studio = new StorageStudioService({
        db,
        storage,
        config,
        tenancyMode: 'multi',
      });
      storage.attachStudioService(studio);
      const alpha = scopedStorage(storage, 'ten_alpha', 'mem_alpha');
      expect(() => alpha.createDrive({ name: 'Legacy bypass' }))
        .toThrow(expect.objectContaining({ code: 'STORAGE_POLICY_VIOLATION' }));
      const provisioned = alpha.studio!.drives.provision({
        operationId: 'provision-policy-drive',
        owner: 'organization',
        key: 'policy-drive',
        name: 'Policy drive',
        creatorAccess: 'admin',
      });
      const drive = alpha.studio!.drives.open('policy-drive');
      expect(() => alpha.updateDrive(provisioned.value.drive.drive_id, { name: 'Bypass' }))
        .toThrow(expect.objectContaining({ code: 'STORAGE_POLICY_VIOLATION' }));
      expect(() => alpha.setDriveVisibility(provisioned.value.drive.drive_id, true))
        .toThrow(expect.objectContaining({ code: 'STORAGE_POLICY_VIOLATION' }));
      expect(() => alpha.deleteDrive(provisioned.value.drive.drive_id))
        .toThrow(expect.objectContaining({ code: 'STORAGE_POLICY_VIOLATION' }));

      const privateFolder = drive.objects.createFolder('/private');
      expect(privateFolder.isPublic).toBeFalse();
      const uploaded = await drive.objects.upload(
        '/private/source.bin',
        new Uint8Array([1]),
        { metadata: { source: 'studio-scoped' } },
      );
      expect(uploaded.metadata).toEqual({ source: 'studio-scoped' });
      expect(uploaded.createdBy).toBe('usr_ten_alpha');
      drive.objects.updateMetadata('/private/source.bin', { purpose: 'test' });
      expect(() => drive.objects.createFolder('/public', true))
        .toThrow(expect.objectContaining({ code: 'STORAGE_POLICY_VIOLATION' }));
      expect(() => drive.objects.setVisibility('/private/source.bin', true))
        .toThrow(expect.objectContaining({ code: 'STORAGE_POLICY_VIOLATION' }));

      await alpha.studio!.drives.lifecycle(provisioned.value.drive.drive_id, {
        operationId: 'suspend-policy-drive',
        expectedRevision: provisioned.value.profile.revision,
        action: 'suspend',
      });

      const suspended = { code: 'STORAGE_POLICY_VIOLATION' };
      expect(() => drive.objects.get('/private/source.bin'))
        .toThrow(expect.objectContaining(suspended));
      expect(() => drive.objects.list('/private'))
        .toThrow(expect.objectContaining(suspended));
      expect(() => drive.objects.createFolder('/blocked'))
        .toThrow(expect.objectContaining(suspended));
      expect(() => drive.objects.setVisibility('/private/source.bin', false))
        .toThrow(expect.objectContaining(suspended));
      expect(() => drive.objects.updateMetadata('/private/source.bin', {}))
        .toThrow(expect.objectContaining(suspended));
      await expect(drive.objects.download('/private/source.bin'))
        .rejects.toMatchObject(suspended);
      await expect(drive.objects.downloadRange('/private/source.bin', 0, 0))
        .rejects.toMatchObject(suspended);
      await expect(drive.objects.upload('/private/blocked.bin', new Uint8Array([2])))
        .rejects.toMatchObject(suspended);
      await expect(drive.objects.move('/private/source.bin', '/private/moved.bin'))
        .rejects.toMatchObject(suspended);
      await expect(drive.objects.copy('/private/source.bin', '/private/copied.bin'))
        .rejects.toMatchObject(suspended);
      await expect(drive.objects.delete('/private/source.bin'))
        .rejects.toMatchObject(suspended);
    } finally {
      db.dispose();
    }
  });

  test('completes system-owned scoped restore but withholds response after revocation', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      defineAuthTables(db);
      defineStorageTables(db);
      defineStorageStudioTables(db);
      seedTenantIdentity(db, 'ten_alpha', 'mem_alpha');
      const config = resolveStorageStudioConfig({
        enabled: true,
        organizationDrives: true,
        defaultGrants: [{
          grantType: 'role',
          grantValue: 'owner',
          permission: 'admin',
        }],
      });
      let entered!: () => void;
      let release!: () => void;
      const providerEntered = new Promise<void>((resolve) => { entered = resolve; });
      const providerRelease = new Promise<void>((resolve) => { release = resolve; });
      let blockRestore = false;
      const storage = new StorageService(db, memoryAdapter(), {
        tenancyMode: 'multi',
        managedObjectPolicy: new StorageStudioIngressPolicy(db, config),
      });
      const studio = new StorageStudioService({
        db,
        storage,
        config,
        tenancyMode: 'multi',
        lifecycleProvider: {
          retryProvisioning: () => undefined,
          async restoreDrive() {
            if (!blockRestore) return;
            entered();
            await providerRelease;
          },
        },
      });
      storage.attachStudioService(studio);
      let revoked = false;
      const assertCurrent = () => {
        if (revoked) throw new Error('forced scoped authority revocation');
      };
      const alpha = scopedStorage(storage, 'ten_alpha', 'mem_alpha', {
        asynchronous: async () => assertCurrent(),
        synchronous: assertCurrent,
      });
      const provisioned = alpha.studio!.drives.provision({
        operationId: 'provision-scoped-restore-race',
        owner: 'organization',
        key: 'scoped-restore-race',
        name: 'Scoped restore race',
        creatorAccess: 'admin',
      });
      const driveId = provisioned.value.drive.drive_id;
      const deleted = await alpha.studio!.drives.lifecycle(driveId, {
        operationId: 'delete-scoped-restore-race',
        expectedRevision: provisioned.value.profile.revision,
        action: 'delete',
      });
      blockRestore = true;
      const restoring = alpha.studio!.drives.lifecycle(driveId, {
        operationId: 'restore-scoped-authority-race',
        expectedRevision: deleted.value.profile.revision,
        action: 'restore',
      });
      await providerEntered;
      revoked = true;
      release();

      await expect(restoring).rejects.toMatchObject({
        code: 'STORAGE_AUTHORITY_CHANGED',
        outcome: 'committed',
      });
      expect(db.prepare(`
        SELECT lifecycle, failure_code FROM _storage_drive_profiles
        WHERE drive_id = ?
      `).get(driveId)).toEqual({
        lifecycle: 'ready',
        failure_code: null,
      });
      expect(db.prepare(`
        SELECT status, error_code FROM _storage_studio_operations
        WHERE idempotency_key = ?
      `).get('restore-scoped-authority-race')).toEqual({
        status: 'succeeded',
        error_code: null,
      });
    } finally {
      db.dispose();
    }
  });
});

function scopedStorage(
  storage: StorageService,
  tenantId: string,
  membershipId: string,
  fences: {
    readonly asynchronous: () => Promise<void>;
    readonly synchronous: () => void;
  } = {
    asynchronous: async () => {},
    synchronous: () => {},
  },
): ReturnType<typeof createScopedStorageService> {
  const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({
    tenancy: 'multi',
    authorization: {
      mode: 'simple',
      roles: { owner: { allPermissions: true } },
    },
  }));
  const access = createRequestAuthorizationAccess({
    authContext: tenantContext(tenantId, membershipId),
    kernel,
    propertyStore: { getProperties: () => ({}) },
  });
  return createScopedStorageService(
    storage,
    trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId }),
    access,
    () => ({}),
    fences.asynchronous,
    fences.synchronous,
    false,
  );
}

function tenantContext(tenantId: string, membershipId: string): AuthContext {
  return {
    userId: `usr_${tenantId}`,
    email: `${tenantId}@example.test`,
    role: 'user',
    sessionKind: 'web',
    sessionId: `ses_${tenantId}`,
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
      return { checksum: 'sha256:test', size: bytes.byteLength, headBytes: bytes };
    },
    async readBlob() { return null; },
    async readBlobRange() { return null; },
    async removeBlob() {},
    removeBlobSync() {},
    async blobExists() { return true; },
    async blobSize() { return 0; },
  };
}

function seedTenantIdentity(
  db: ReturnType<typeof createReactiveDB>,
  tenantId: string,
  membershipId: string,
): void {
  const userId = `usr_${tenantId}`;
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
