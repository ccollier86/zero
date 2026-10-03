import { describe, expect, test } from 'bun:test';
import { applicationServiceDataScope } from '../auth/service-data-scope';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { resolveStorageStudioConfig } from './storage-config';
import type { StorageService } from './storage-service';
import type { StorageStudioAudit } from './storage-studio-audit';
import type { StorageStudioAuthority } from './storage-studio-authority';
import type { StorageStudioCatalog } from './storage-studio-catalog';
import type { StorageStudioDrive } from './storage-studio-contracts';
import { StorageStudioEditor } from './storage-studio-editor';
import {
  normalizeStorageDriveUpdate,
  normalizeStorageProvision,
  storageStudioRequestHash,
} from './storage-studio-policy';
import { StorageStudioProvisioner } from './storage-studio-provisioner';
import {
  defineStorageStudioTables,
  type StorageStudioDriveProfile,
} from './storage-studio-schema';
import {
  type StorageStudioOperationRecord,
  StorageStudioStore,
} from './storage-studio-store';

const DRIVE_ID = 'drv_00000000-0000-4000-8000-000000000001';
const CONFIG = resolveStorageStudioConfig({ enabled: true }, 3_600);
const AUTHORITY: StorageStudioAuthority = {
  actor: {
    userId: 'user_one',
    email: 'user@example.com',
    role: 'admin',
    sessionId: 'session_one',
    sessionKind: 'web',
    tenantId: undefined,
    membershipId: undefined,
    clientId: undefined,
  },
  scope: applicationServiceDataScope(),
  dataRoles: ['admin'],
  canReadCatalog: true,
  canProvisionOrganization: true,
  canProvisionPersonal: false,
  canManage: true,
  canDelete: true,
  ownerChoices: ['organization'],
};
const DRIVE = Object.freeze({ marker: 'drive' }) as unknown as StorageStudioDrive;

describe('Storage Studio idempotency collision handling', () => {
  test('replays a completed update before applying stale revision checks', () => {
    const request = {
      operationId: 'update-one',
      expectedRevision: 1,
      name: 'Renamed drive',
    };
    const hash = storageStudioRequestHash({
      driveId: DRIVE_ID,
      ...normalizeStorageDriveUpdate(request, CONFIG),
    });
    const editor = createEditor(operation('update', request.operationId, hash, 'succeeded'));

    const result = editor.update(AUTHORITY, {}, DRIVE_ID, request);

    expect(result).toEqual({
      operationId: request.operationId,
      replayed: true,
      value: DRIVE,
    });
  });

  test('reports a known failed update as terminal instead of in progress', () => {
    const request = {
      operationId: 'update-failed',
      expectedRevision: 1,
      name: 'Renamed drive',
    };
    const hash = storageStudioRequestHash({
      driveId: DRIVE_ID,
      ...normalizeStorageDriveUpdate(request, CONFIG),
    });
    const editor = createEditor(operation('update', request.operationId, hash, 'failed'));

    expect(() => editor.update(AUTHORITY, {}, DRIVE_ID, request)).toThrow(
      expect.objectContaining({ code: 'STORAGE_CONFLICT', retryable: false }),
    );
  });

  test('replays the winner when an update receipt insert loses a unique-key race', () => {
    const request = {
      operationId: 'update-race',
      expectedRevision: 2,
      name: 'Concurrent rename',
    };
    const hash = storageStudioRequestHash({
      driveId: DRIVE_ID,
      ...normalizeStorageDriveUpdate(request, CONFIG),
    });
    const winner = operation('update', request.operationId, hash, 'succeeded');
    let reads = 0;
    const store = {
      getOperation: () => (++reads === 1 ? null : winner),
      insertOperation: () => {
        throw new Error('UNIQUE constraint failed: _storage_studio_operations.idempotency_key');
      },
    } as unknown as StorageStudioStore;
    const editor = createEditor(null, store, 2);

    expect(editor.update(AUTHORITY, {}, DRIVE_ID, request)).toEqual({
      operationId: request.operationId,
      replayed: true,
      value: DRIVE,
    });
  });

  test('does not overwrite a concurrent update winner while recording failure', () => {
    const request = {
      operationId: 'update-settlement-race',
      expectedRevision: 1,
      name: 'Concurrent winner',
    };
    const hash = storageStudioRequestHash({
      driveId: DRIVE_ID,
      ...normalizeStorageDriveUpdate(request, CONFIG),
    });
    const pending = operation('update', request.operationId, hash, 'pending');
    const winner = operation('update', request.operationId, hash, 'succeeded');
    let durable = pending;
    const store = {
      getOperation: () => pending,
      getOperationById: () => durable,
      failPendingOperation: () => {
        durable = winner;
        return false;
      },
    } as unknown as StorageStudioStore;
    const editor = new StorageStudioEditor({
      db: transactionDb(),
      storage: {
        getDriveUsage: () => ({ totalBytes: 0 }),
        updateDriveRecord: () => { throw new Error('losing mutation'); },
      } as unknown as StorageService,
      store,
      catalog: catalog(1),
      audit: {} as StorageStudioAudit,
      config: CONFIG,
    });

    expect(editor.update(AUTHORITY, {}, DRIVE_ID, request)).toEqual({
      operationId: request.operationId,
      replayed: true,
      value: DRIVE,
    });
    expect(durable.status).toBe('succeeded');
  });

  test('replays the winner when provisioning loses an operation-key race', () => {
    const request = {
      operationId: 'provision-race',
      owner: 'organization' as const,
      key: 'artifacts',
      name: 'Artifacts',
    };
    const normalized = normalizeStorageProvision(AUTHORITY, request, CONFIG, 'single');
    const winner = operation(
      'provision',
      request.operationId,
      storageStudioRequestHash(normalized.hashInput),
      'succeeded',
    );
    let reads = 0;
    const store = {
      getOperation: () => (++reads === 1 ? null : winner),
      countOwnerDrives: () => 0,
      getProfileByKey: () => null,
      insertOperation: () => {
        throw new Error('UNIQUE constraint failed: _storage_studio_operations.idempotency_key');
      },
    } as unknown as StorageStudioStore;
    const provisioner = new StorageStudioProvisioner({
      db: transactionDb(),
      storage: {
        createDriveRecord: () => ({ drive_id: DRIVE_ID }),
      } as unknown as StorageService,
      store,
      catalog: catalog(1),
      audit: {} as StorageStudioAudit,
      config: CONFIG,
      tenancyMode: 'single',
      providerKey: 'storage',
    });

    expect(provisioner.provision(AUTHORITY, {}, request)).toEqual({
      operationId: request.operationId,
      replayed: true,
      value: DRIVE,
    });
  });

  test('resumes a pending update receipt after the reserving process stops', () => {
    const database = createReactiveDB({ mode: 'memory' });
    try {
      database.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE users (user_id TEXT PRIMARY KEY);
        CREATE TABLE _auth_tenant_memberships (membership_id TEXT PRIMARY KEY);
        CREATE TABLE storage_drives (drive_id TEXT PRIMARY KEY);
        INSERT INTO users (user_id) VALUES ('user_one');
        INSERT INTO storage_drives (drive_id) VALUES ('${DRIVE_ID}');
      `);
      defineStorageStudioTables(database);
      const store = new StorageStudioStore(database);
      store.insertProfile(readyProfile());
      const request = {
        operationId: 'update-after-restart',
        expectedRevision: 1,
        name: 'Recovered name',
      };
      const hash = storageStudioRequestHash({
        driveId: DRIVE_ID,
        ...normalizeStorageDriveUpdate(request, CONFIG),
      });
      store.insertOperation({
        operationId: 'stop_before_update_commit',
        idempotencyKey: request.operationId,
        kind: 'update',
        scopeKind: 'application',
        scopeId: 'application',
        actorUserId: AUTHORITY.actor.userId,
        actorMembershipId: null,
        requestHash: hash,
        driveId: DRIVE_ID,
        createdAt: 100,
        expiresAt: 10_000,
      });

      let recordedName: string | undefined;
      const editorAfterRestart = new StorageStudioEditor({
        db: database,
        storage: {
          getDriveUsage: () => ({ totalBytes: 0 }),
          updateDriveRecord: (_driveId: string, values: { name?: string }) => {
            recordedName = values.name;
          },
        } as unknown as StorageService,
        store,
        catalog: {
          requireProfile: () => store.getProfile(DRIVE_ID)!,
          get: () => DRIVE,
        } as unknown as StorageStudioCatalog,
        audit: { append: () => {} } as unknown as StorageStudioAudit,
        config: CONFIG,
      });

      expect(editorAfterRestart.update(AUTHORITY, {}, DRIVE_ID, request)).toEqual({
        operationId: request.operationId,
        replayed: true,
        value: DRIVE,
      });
      expect(recordedName).toBe('Recovered name');
      expect(store.getProfile(DRIVE_ID)?.revision).toBe(2);
      expect(store.getOperationById('stop_before_update_commit')).toMatchObject({
        status: 'succeeded',
        profile_revision: 2,
      });
    } finally {
      database.dispose();
    }
  });
});

function createEditor(
  existing: StorageStudioOperationRecord | null,
  storeOverride?: StorageStudioStore,
  revision = 2,
): StorageStudioEditor {
  const store = storeOverride ?? ({ getOperation: () => existing } as unknown as StorageStudioStore);
  return new StorageStudioEditor({
    db: transactionDb(),
    storage: {} as StorageService,
    store,
    catalog: catalog(revision),
    audit: {} as StorageStudioAudit,
    config: CONFIG,
  });
}

function transactionDb(): ReactiveDB {
  return {
    transaction<T>(callback: () => T): T {
      return callback();
    },
  } as unknown as ReactiveDB;
}

function catalog(revision: number): StorageStudioCatalog {
  return {
    requireProfile: () => ({
      drive_id: DRIVE_ID,
      scope_kind: 'application',
      scope_id: 'application',
      owner_kind: 'application',
      owner_id: 'application',
      lifecycle: 'ready',
      revision,
    }),
    get: () => DRIVE,
  } as unknown as StorageStudioCatalog;
}

function operation(
  kind: 'provision' | 'update',
  key: string,
  hash: string,
  status: StorageStudioOperationRecord['status'],
): StorageStudioOperationRecord {
  return {
    operation_id: 'stop_existing',
    idempotency_key: key,
    operation_kind: kind,
    scope_kind: 'application',
    scope_id: 'application',
    actor_user_id: AUTHORITY.actor.userId,
    actor_membership_id: null,
    request_hash: hash,
    status,
    drive_id: DRIVE_ID,
    profile_revision: status === 'succeeded' ? 2 : null,
    error_code: status === 'failed' ? 'STORAGE_CONFLICT' : null,
    created_at: 1,
    updated_at: 2,
    completed_at: status === 'pending' ? null : 2,
    expires_at: 10,
  };
}

function readyProfile(): StorageStudioDriveProfile {
  return {
    drive_id: DRIVE_ID,
    drive_key: 'artifacts',
    owner_kind: 'application',
    owner_id: 'application',
    scope_kind: 'application',
    scope_id: 'application',
    lifecycle: 'ready',
    revision: 1,
    provider: 'local',
    provider_namespace: 'namespace_idempotency',
    isolation_mode: 'shared-cas',
    generation: 1,
    created_by_user_id: AUTHORITY.actor.userId,
    created_by_membership_id: null,
    updated_by_user_id: AUTHORITY.actor.userId,
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
