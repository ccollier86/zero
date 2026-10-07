/**
 * storage-service.ts
 *
 * Public Storage service facade for drive metadata and object transport. It
 * coordinates focused validation, ACL, tree-mutation, and blob-lifecycle
 * modules; HTTP routing and auth token verification stay in plugin/auth layers.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import type { Row } from '../sync/types';
import type {
  StorageAdapter,
  DriveRecord,
  ObjectRecord,
  CreateDriveParams,
  FileInfo,
  UploadOptions,
  ListOptions,
  ListResult,
  ListPermissionsOptions,
  DriveUsage,
  GrantPermissionParams,
  PermissionRecord,
  PermissionLevel,
  CreateUploadGrantParams,
  StorageUploadGrant,
  StorageBlobWriteResult,
} from './types';
import { assertStorageAdapterSafety } from './storage-adapter-isolation';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { ScopedStorageStudioApi } from './storage-studio-scoped-api';
import type { StorageStudioService } from './storage-studio-service';
import { detectMimeType } from './mime';
import { createUploadGrantToken } from './upload-grant';
import {
  applicationServiceDataScope,
  serviceDataScopeMatchesTenant,
  serviceDataTenantId,
  type ServiceDataScope,
} from '../auth/service-data-scope';
import { ensureNullableTenantColumn } from '../runtime/tenant-schema';
import {
  normalizeStorageActorRoles,
  type StorageActorRoleInput,
} from './storage-access';
import {
  StorageBlobLifecycle,
  storageBlobMutationKey,
  storagePathMutationKeys,
  type StorageBlobCleanupOptions,
  type StorageBlobCleanupPass,
} from './storage-blob-lifecycle';
import { StorageDomainError, normalizeStorageError } from './storage-domain-error';
import { StorageError } from './storage-error';
import {
  normalizeStorageByteLimit,
  normalizeStorageDriveId,
  normalizeStorageMimeTypes,
  normalizeStorageName,
  normalizeStoragePath,
  parseStorageMetadata,
  serializeStorageMetadata,
} from './storage-input';
import { storageMimeTypeAllowed, toStorageFileInfo } from './storage-object-values';
import {
  storageObjectListOffset,
  storageObjectSearchLikePattern,
} from './storage-object-search';
import { StorageObjectMutationStore } from './storage-object-mutations';
import { StoragePermissionService } from './storage-permission-service';
import {
  normalizeStorageProviderReadError,
  normalizeStorageProviderWriteError,
} from './storage-provider-error';
import {
  runWithStorageUploadHeartbeat,
  type StorageUploadAdmission,
} from './storage-upload-admission';
import {
  StorageUploadOperationTracker,
  type StorageUploadOperationContext,
} from './storage-upload-operation-tracker';
import type { StorageManagedObjectPolicy } from './storage-managed-object-policy';
import {
  appendStorageAclAudit,
  type StorageAclAuditAuthority,
} from './storage-acl-audit';
import type { AuthAuditService } from '../auth/auth-audit-service';

export { StorageError } from './storage-error';

// ─── SQL Row Types ──────────────────────────────────────────────────────────

interface SumRow { total: number }
interface CountRow { count: number }

/** Synchronous legacy deletion remains atomic but never processes an unbounded tree. */
const LEGACY_ATOMIC_DRIVE_DELETE_OBJECT_LIMIT = 4_096;

export type StorageDriveUpdates = Partial<
  Pick<DriveRecord, 'name' | 'max_size_bytes' | 'max_file_size_bytes' | 'allowed_mime_types'>
>;

/** One legacy role or the complete effective role set projected by RBAC. */
export type StorageActorRoles = StorageActorRoleInput;

/** Canonical input for atomically inserting a pre-reserved drive row. */
export interface CreateDriveRecordInput {
  readonly driveId: string;
  readonly ownerId: string | null;
  readonly params: CreateDriveParams;
  readonly scope?: ServiceDataScope;
}

/** Canonical grouped API for storage drive metadata operations. */
export interface StorageDriveApi {
  /** Create a drive owned by `ownerId`. */
  create(ownerId: string, params: CreateDriveParams, scope?: ServiceDataScope): DriveRecord;
  /** Read one drive by id. */
  get(driveId: string): DriveRecord | null;
  /** Update mutable drive settings. */
  update(driveId: string, updates: StorageDriveUpdates): DriveRecord;
  /** List all drives without user filtering. */
  list(): DriveRecord[];
  /** List drives visible to a concrete user/security context. */
  listForUser(
    userId: string,
    userRole: StorageActorRoles,
    userProperties?: Record<string, string>,
    scope?: ServiceDataScope,
  ): DriveRecord[];
  /** Delete a drive, its object metadata, and tracked blob references. */
  delete(driveId: string): boolean;
  /** Return aggregate usage for one drive. */
  usage(driveId: string): DriveUsage;
  /** Toggle drive-level public read visibility. */
  setVisibility(driveId: string, isPublic: boolean): DriveRecord;
}

/** Canonical grouped API for storage object and folder operations. */
export interface StorageObjectApi {
  /** Upload file bytes and create or overwrite object metadata. */
  upload(
    driveId: string,
    path: string,
    data: ReadableStream<Uint8Array> | Uint8Array | Blob,
    fileName: string,
    userId: string | null,
    options?: UploadOptions,
    scope?: ServiceDataScope,
    authorizeCommit?: () => Promise<void>,
    expectedManagedGeneration?: number,
    authorizeCommitSync?: () => void,
  ): Promise<FileInfo>;
  /** Download a full file by drive/path. */
  download(
    driveId: string,
    path: string,
    authorizeReturn?: () => void,
    expectedManagedGeneration?: number,
  ): Promise<{ stream: ReadableStream<Uint8Array>; info: FileInfo } | null>;
  /** Download a byte range for media/file streaming. */
  downloadRange(
    driveId: string,
    path: string,
    start: number,
    end: number,
    authorizeReturn?: () => void,
    expectedManagedGeneration?: number,
  ): Promise<{ stream: ReadableStream<Uint8Array>; info: FileInfo } | null>;
  /** Read file or folder metadata by path. */
  get(driveId: string, path: string): FileInfo | null;
  /** List children under a folder path. */
  list(driveId: string, parentPath?: string, options?: ListOptions): ListResult;
  /** Move a file or folder to a new path. */
  move(
    driveId: string,
    fromPath: string,
    toPath: string,
    authorizeCommit?: () => void,
  ): Promise<FileInfo>;
  /** Copy a file to a new path. */
  copy(
    driveId: string,
    fromPath: string,
    toPath: string,
    authorizeCommit?: () => void,
  ): Promise<FileInfo>;
  /** Delete a file or folder subtree. */
  delete(driveId: string, path: string, authorizeCommit?: () => void): Promise<boolean>;
  /** Create a folder and any missing parent folders. */
  createFolder(driveId: string, path: string, userId: string | null, isPublic?: boolean): FileInfo;
  /** Toggle object-level public read visibility. */
  setVisibility(driveId: string, path: string, isPublic: boolean): FileInfo;
  /** Replace bounded application metadata on an existing file or folder. */
  updateMetadata(
    driveId: string,
    path: string,
    metadata: Record<string, unknown>,
    scope?: ServiceDataScope,
  ): FileInfo;
}

/** Canonical grouped API for storage permission operations. */
export interface StoragePermissionApi {
  /** Grant drive or object access to a role, user, or user property. */
  grant(driveId: string, params: GrantPermissionParams): PermissionRecord;
  /** List drive-level or object-relevant permissions. */
  list(driveId: string, options?: ListPermissionsOptions): PermissionRecord[];
  /** Read one permission by id. */
  get(permissionId: string): PermissionRecord | null;
  /** Revoke a permission by id. */
  revoke(permissionId: string): boolean;
  /** Check whether a concrete user/security context has enough access. */
  checkAccess(
    driveId: string,
    path: string | null,
    userId: string | null,
    userRole: StorageActorRoles,
    userProperties: Record<string, string>,
    requiredLevel: PermissionLevel,
    scope?: ServiceDataScope,
  ): boolean;
}

/** Canonical grouped API for scoped upload grants. */
export interface StorageUploadGrantApi {
  /**
   * Create a short-lived token that allows unauthenticated upload to exactly
   * one storage path. Uploaded objects are private unless `public` is true.
   */
  create(driveId: string, params: CreateUploadGrantParams): Promise<StorageUploadGrant>;
}

export interface StorageServiceOptions {
  /** HMAC secret used by storage upload grant tokens. */
  uploadGrantSecret?: string;
  /** Default expiry in seconds for upload grants and presigned URLs. */
  defaultPresignedTTL?: number;
  /**
   * Return whether a user property is explicitly configured as a trusted
   * authorization input. Property grants fail closed when this validator is
   * unavailable or rejects the key.
   */
  isPolicyTrustedProperty?: (key: string) => boolean;
  /** Runtime tenancy profile. Multi mode rejects unscoped drive creation/listing. */
  tenancyMode?: 'single' | 'multi';
  /** Optional managed-drive capability issuance fence supplied by Studio. */
  prepareCapability?: (
    driveId: string,
    expiresIn: number,
  ) => Readonly<{ generation?: number }>;
  /** Optional managed-drive object and concurrent-upload admission policy. */
  uploadAdmission?: StorageUploadAdmission;
  /** Optional managed-drive lifecycle and public-object policy fence. */
  managedObjectPolicy?: StorageManagedObjectPolicy;
  /** Guardian audit sink used for authority-attributed ACL mutations. */
  aclAudit?: AuthAuditService | null;
}

// ─── Table Definitions ──────────────────────────────────────────────────────

/**
 * Define all storage tables on the shared ReactiveDB.
 * Called once during plugin onStart — idempotent.
 */
export function defineStorageTables(db: ReactiveDB): void {
  ensureNullableTenantColumn(db, 'storage_drives');
  ensureNullableTenantColumn(db, 'storage_objects');
  ensureNullableTenantColumn(db, '_storage_permissions');
  // Drives — reactive, broadcast to sync subscribers
  db.defineTable('storage_drives', {
    drive_id: 'text primary key',
    tenant_id: 'text',
    name: 'text not null',
    owner_id: 'text',
    max_size_bytes: 'integer not null default 0',
    max_file_size_bytes: 'integer not null default 0',
    allowed_mime_types: "text not null default '*'",
    public: 'integer not null default 0',
    created_at: 'integer not null',
  });

  // Objects (files + folders) — reactive
  db.defineTable('storage_objects', {
    object_id: 'text primary key',
    tenant_id: 'text',
    drive_id: 'text not null',
    parent_id: 'text',
    name: 'text not null',
    path: 'text not null',
    type: 'text not null',
    mime_type: 'text',
    size_bytes: 'integer not null default 0',
    checksum: 'text',
    public: 'integer not null default 0',
    metadata: "text not null default '{}'",
    created_by: 'text',
    created_at: 'integer not null',
    updated_at: 'integer not null',
  });

  // Blob reference tracking — internal, no broadcast
  db.exec(`
    CREATE TABLE IF NOT EXISTS _storage_blobs (
      checksum    TEXT PRIMARY KEY,
      size_bytes  INTEGER NOT NULL,
      ref_count   INTEGER NOT NULL DEFAULT 1,
      created_at  INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS _storage_blob_leases (
      checksum     TEXT PRIMARY KEY,
      lease_token  TEXT NOT NULL,
      acquired_at  INTEGER NOT NULL,
      expires_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_storage_blob_leases_expiry
      ON _storage_blob_leases(expires_at);
  `);

  // Permissions — internal, no broadcast
  db.exec(`
    CREATE TABLE IF NOT EXISTS _storage_permissions (
      permission_id TEXT PRIMARY KEY,
      tenant_id     TEXT,
      drive_id      TEXT NOT NULL,
      object_id     TEXT,
      grant_type    TEXT NOT NULL,
      grant_key     TEXT,
      grant_value   TEXT NOT NULL,
      permission    TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_storage_perms_drive ON _storage_permissions(drive_id)'
  );
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_storage_objects_drive_path ON storage_objects(drive_id, path)'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_storage_objects_parent ON storage_objects(drive_id, parent_id)'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_storage_drives_tenant ON storage_drives(tenant_id)'
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_storage_objects_tenant_drive
     ON storage_objects(tenant_id, drive_id)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_storage_permissions_tenant_drive
     ON _storage_permissions(tenant_id, drive_id)`
  );
}

// ─── StorageService ─────────────────────────────────────────────────────────

/**
 * Coordinate storage metadata, permissions, and blob adapter operations.
 *
 * The service accepts concrete user IDs, roles, and adapter inputs; it does
 * not depend on Elysia route context or transport details.
 */
export class StorageService {
  /** Narrow domain identity for consumers that atomically compose private metadata with Storage. */
  getTransactionDomain(): ReturnType<ReactiveDB['getTransactionDomain']> { return this.db.getTransactionDomain(); }
  private stmts!: ReturnType<typeof this.prepareStatements>;
  private readonly blobLifecycle: StorageBlobLifecycle;
  private readonly objectMutations: StorageObjectMutationStore;
  private readonly permissionService: StoragePermissionService;
  private readonly uploadOperations = new StorageUploadOperationTracker();
  private providerShutdown: Promise<void> | null = null;
  private publicationRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private publicationRecoveryDelayMs = 50;
  private stopping = false;
  private studioControl: StorageStudioService | null = null;

  /**
   * Scope-bound Studio API. The raw service deliberately exposes null; request
   * and workflow projections replace this getter with a live authority-bound
   * facade so no caller can supply its own tenant or actor.
   */
  get studio(): ScopedStorageStudioApi | null {
    return null;
  }

  /** Canonical grouped API for drive metadata. */
  readonly drives: StorageDriveApi = {
    create: (ownerId, params, scope) => this.createDrive(ownerId, params, scope),
    get: (driveId) => this.getDrive(driveId),
    update: (driveId, updates) => this.updateDrive(driveId, updates),
    list: () => this.listDrives(),
    listForUser: (userId, userRole, userProperties = {}, scope) =>
      this.listDrivesForUser(userId, userRole, userProperties, scope),
    delete: (driveId) => this.deleteDrive(driveId),
    usage: (driveId) => this.getDriveUsage(driveId),
    setVisibility: (driveId, isPublic) => this.setDriveVisibility(driveId, isPublic),
  };

  /** Canonical grouped API for files and folders. */
  readonly objects: StorageObjectApi = {
    upload: (
      driveId,
      path,
      data,
      fileName,
      userId,
      options = {},
      scope,
      authorizeCommit,
      expectedManagedGeneration,
      authorizeCommitSync,
    ) => this.upload(
      driveId,
      path,
      data,
      fileName,
      userId,
      options,
      scope,
      authorizeCommit,
      expectedManagedGeneration,
      authorizeCommitSync,
    ),
    download: (driveId, path, authorizeReturn, expectedManagedGeneration) =>
      this.download(driveId, path, authorizeReturn, expectedManagedGeneration),
    downloadRange: (driveId, path, start, end, authorizeReturn, expectedManagedGeneration) =>
      this.downloadRange(
        driveId, path, start, end, authorizeReturn, expectedManagedGeneration,
      ),
    get: (driveId, path) => this.getFileInfo(driveId, path),
    list: (driveId, parentPath, options) => this.listFolder(driveId, parentPath, options),
    move: (driveId, fromPath, toPath, authorizeCommit) =>
      this.moveObject(driveId, fromPath, toPath, authorizeCommit),
    copy: (driveId, fromPath, toPath, authorizeCommit) =>
      this.copyObject(driveId, fromPath, toPath, authorizeCommit),
    delete: (driveId, path, authorizeCommit) =>
      this.deleteObject(driveId, path, authorizeCommit),
    createFolder: (driveId, path, userId, isPublic = false) =>
      this.createFolder(driveId, path, userId, isPublic),
    setVisibility: (driveId, path, isPublic) => this.setVisibility(driveId, path, isPublic),
    updateMetadata: (driveId, path, metadata, scope) =>
      this.updateObjectMetadata(driveId, path, metadata, scope),
  };

  /** Canonical grouped API for storage grants and access checks. */
  readonly permissions: StoragePermissionApi = {
    grant: (driveId, params) => this.grantPermission(driveId, params),
    list: (driveId, options) => this.listPermissions(driveId, options),
    get: (permissionId) => this.getPermission(permissionId),
    revoke: (permissionId) => this.revokePermission(permissionId),
    checkAccess: (driveId, path, userId, userRole, userProperties, requiredLevel, scope) =>
      this.checkAccess(
        driveId,
        path,
        userId,
        userRole,
        userProperties,
        requiredLevel,
        scope,
      ),
  };

  /** Canonical grouped API for scoped public-upload grants. */
  readonly uploads: StorageUploadGrantApi = {
    create: (driveId, params) => this.createUploadGrant(driveId, params),
  };

  constructor(
    private db: ReactiveDB,
    private adapter: StorageAdapter,
    private options: StorageServiceOptions = {}
  ) {
    assertStorageAdapterSafety(adapter);
    this.stmts = this.prepareStatements();
    this.blobLifecycle = new StorageBlobLifecycle(db, adapter);
    this.objectMutations = new StorageObjectMutationStore(
      db,
      this.blobLifecycle,
      options.uploadAdmission,
      options.managedObjectPolicy,
    );
    this.permissionService = new StoragePermissionService(db, options);
    const recovered = this.recoverPendingBlobPublications();
    if (recovered.remaining > 0) this.schedulePublicationRecovery();
  }

  /** Drain Storage provider mutations before plugin/runtime teardown. */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.publicationRecoveryTimer) clearTimeout(this.publicationRecoveryTimer);
    this.publicationRecoveryTimer = null;
    const drained = await this.uploadOperations.stop();
    if (!drained) {
      // A third-party provider may ignore AbortSignal. Keep the adapter and
      // checksum coordinator alive until that mutation eventually hands off;
      // plugin shutdown remains bounded and never closes resources underneath
      // a live write.
      void this.finishProviderShutdownAfterUploads();
      return;
    }
    await this.stopProviderResources();
  }

  /** Synchronously fence a service that failed before application startup. */
  rollbackFailedStart(): void {
    this.stopping = true;
    if (this.publicationRecoveryTimer) clearTimeout(this.publicationRecoveryTimer);
    this.publicationRecoveryTimer = null;
    void this.uploadOperations.stop().then((drained) => (
      drained ? this.stopProviderResources() : this.finishProviderShutdownAfterUploads()
    )).catch(() => undefined);
  }

  /** Capture managed lifecycle generation into a synchronous mutation fence. */
  captureObjectCommitFence(driveId: string, fence: () => void): () => void {
    return this.managedObjectCommitFence(driveId, fence);
  }

  /** Capture managed lifecycle state for async capability issuance. */
  captureManagedObjectAccess(driveId: string): Readonly<{ generation?: number }> {
    return this.options.managedObjectPolicy?.captureObjectAccess(driveId)
      ?? Object.freeze({});
  }

  /** Revalidate a previously captured managed lifecycle generation. */
  assertManagedObjectAccessCurrent(
    driveId: string,
    generation: number | undefined,
  ): void {
    this.options.managedObjectPolicy?.assertObjectAccessCurrent(driveId, generation);
  }

  /** Trusted composition seam; never exposed through request-scoped services. */
  attachStudioService(service: StorageStudioService): void {
    if (this.studioControl && this.studioControl !== service) {
      throw new StorageDomainError(
        'STORAGE_CONFLICT',
        'A Storage Studio service is already attached.',
      );
    }
    this.studioControl = service;
  }

  /** Trusted composition seam used only while building a scoped projection. */
  getAttachedStudioService(): StorageStudioService | null {
    return this.studioControl;
  }

  /** Trusted lifecycle seam used when the owning plugin stops. */
  detachStudioService(service: StorageStudioService): void {
    if (this.studioControl === service) this.studioControl = null;
  }

  private prepareStatements() {
    return {
      getDrive: this.db.prepare('SELECT * FROM storage_drives WHERE drive_id = ?'),
      listDrives: this.db.prepare('SELECT * FROM storage_drives ORDER BY name'),
      getObject: this.db.prepare('SELECT * FROM storage_objects WHERE object_id = ?'),
      getObjectByPath: this.db.prepare(
        'SELECT * FROM storage_objects WHERE drive_id = ? AND path = ?'
      ),
      listFolder: this.db.prepare(
        `SELECT * FROM storage_objects
         WHERE drive_id = ? AND parent_id IS ?
         ORDER BY type DESC, name ASC`
      ),
      listFolderPaged: this.db.prepare(
        `SELECT * FROM storage_objects
         WHERE drive_id = ? AND parent_id IS ?
         ORDER BY type DESC, name ASC
         LIMIT ? OFFSET ?`
      ),
      countFolder: this.db.prepare(
        'SELECT COUNT(*) as count FROM storage_objects WHERE drive_id = ? AND parent_id IS ?'
      ),
      getDriveUsage: this.db.prepare(
        "SELECT COALESCE(SUM(size_bytes), 0) as total FROM storage_objects WHERE drive_id = ? AND type = 'file'"
      ),
      getDriveFileCount: this.db.prepare(
        "SELECT COUNT(*) as count FROM storage_objects WHERE drive_id = ? AND type = 'file'"
      ),
      getDriveFolderCount: this.db.prepare(
        "SELECT COUNT(*) as count FROM storage_objects WHERE drive_id = ? AND type = 'folder'"
      ),
    };
  }

  // ─── Drives ─────────────────────────────────────────────────────────────

  createDrive(
    ownerId: string,
    params: CreateDriveParams,
    scope?: ServiceDataScope,
    authorizeCommit?: () => void,
  ): DriveRecord {
    this.options.managedObjectPolicy?.assertLegacyDriveCreationAllowed();
    return this.createDriveRecord({
      driveId: `drv_${crypto.randomUUID()}`,
      ownerId,
      params,
      scope,
    }, authorizeCommit);
  }

  /** Insert a validated canonical drive using a server-reserved identifier. */
  createDriveRecord(
    input: CreateDriveRecordInput,
    authorizeCommit?: () => void,
  ): DriveRecord {
    const boundary = this.requireCreationScope(input.scope);
    const driveId = normalizeStorageDriveId(input.driveId);
    const maxSize = normalizeStorageByteLimit(input.params.maxSize ?? 0, 'Drive size limit');
    const maxFileSize = normalizeStorageByteLimit(
      input.params.maxFileSize ?? 0,
      'File size limit',
    );
    if (maxSize > 0 && maxFileSize > maxSize) {
      throw new StorageDomainError(
        'STORAGE_INPUT_INVALID',
        'File size limit cannot exceed the drive size limit.',
      );
    }
    const allowedMimeTypes = normalizeStorageMimeTypes(
      input.params.allowedMimeTypes ?? ['*'],
    );
    if (this.getDrive(driveId)) {
      throw new StorageDomainError(
        'STORAGE_CONFLICT',
        'Storage drive id is already in use.',
        { outcome: 'not-committed' },
      );
    }
    const now = Date.now();

    const drive: DriveRecord = {
      drive_id: driveId,
      tenant_id: serviceDataTenantId(boundary),
      name: normalizeStorageName(input.params.name, 'Drive name'),
      owner_id: input.ownerId,
      max_size_bytes: maxSize,
      max_file_size_bytes: maxFileSize,
      allowed_mime_types: allowedMimeTypes.join(','),
      public: input.params.public ? 1 : 0,
      created_at: now,
    };

    return this.db.transaction(() => {
      authorizeCommit?.();
      if (this.getDrive(driveId)) {
        throw new StorageDomainError(
          'STORAGE_CONFLICT',
          'Storage drive id is already in use.',
          { outcome: 'not-committed' },
        );
      }
      this.db.insert('storage_drives', drive as unknown as Row);
      return drive;
    });
  }

  getDrive(driveId: string): DriveRecord | null {
    return this.stmts.getDrive.get(driveId) as DriveRecord | null;
  }

  /** Read a drive only inside an already validated request/execution scope. */
  getDriveForScope(driveId: string, scope: ServiceDataScope): DriveRecord | null {
    const drive = this.getDrive(driveId);
    return drive && serviceDataScopeMatchesTenant(scope, drive.tenant_id)
      ? drive
      : null;
  }

  /**
   * Update drive settings while preserving fields omitted by the caller.
   */
  updateDrive(
    driveId: string,
    updates: StorageDriveUpdates,
    authorizeCommit?: () => void,
  ): DriveRecord {
    this.options.managedObjectPolicy?.assertLegacyDriveControlAllowed(driveId);
    return this.db.transaction(() => {
      authorizeCommit?.();
      return this.updateDriveRecord(driveId, updates);
    });
  }

  /** Trusted record mutation used by Studio's revisioned control plane. */
  updateDriveRecord(
    driveId: string,
    updates: StorageDriveUpdates,
  ): DriveRecord {
    const drive = this.getDrive(driveId);
    if (!drive) throw new StorageError(404, `Drive not found: ${driveId}`);

    const sanitizedUpdates: Partial<Pick<
      DriveRecord,
      'name' | 'max_size_bytes' | 'max_file_size_bytes' | 'allowed_mime_types'
    >> = {};

    if (updates.name !== undefined) {
      sanitizedUpdates.name = normalizeStorageName(updates.name, 'Drive name');
    }
    if (updates.max_size_bytes !== undefined) {
      sanitizedUpdates.max_size_bytes = normalizeStorageByteLimit(
        updates.max_size_bytes,
        'Drive size limit',
      );
    }
    if (updates.max_file_size_bytes !== undefined) {
      sanitizedUpdates.max_file_size_bytes = normalizeStorageByteLimit(
        updates.max_file_size_bytes,
        'File size limit',
      );
    }
    if (updates.allowed_mime_types !== undefined) {
      sanitizedUpdates.allowed_mime_types = normalizeStorageMimeTypes(
        updates.allowed_mime_types.split(','),
      ).join(',');
    }

    const updated: DriveRecord = { ...drive, ...sanitizedUpdates };
    if (updated.max_size_bytes > 0
      && updated.max_file_size_bytes > updated.max_size_bytes) {
      throw new StorageDomainError(
        'STORAGE_INPUT_INVALID',
        'File size limit cannot exceed the drive size limit.',
      );
    }
    this.db.update('storage_drives', driveId, updated as unknown as Row);
    return updated;
  }

  listDrives(): DriveRecord[] {
    return this.stmts.listDrives.all() as DriveRecord[];
  }

  /**
   * List drives accessible by a user.
   * Checks ownership, public flag, and all permission grant types (user, role, property).
   */
  listDrivesForUser(
    userId: string,
    userRole: StorageActorRoles,
    userProperties: Record<string, string> = {},
    scope?: ServiceDataScope,
  ): DriveRecord[] {
    const boundary = this.requireCreationScope(scope);
    const allDrives = this.listDrives()
      .filter((drive) => serviceDataScopeMatchesTenant(boundary, drive.tenant_id));
    return allDrives.filter(drive => {
      if (drive.public) return true;
      if (drive.owner_id === userId) return true;
      // `admin` is the historical global-platform bypass only in legacy
      // single mode. In multi mode role names are tenant assignments and must
      // receive an explicit storage grant like every other role.
      if (
        this.options.tenancyMode === 'single'
        && normalizeStorageActorRoles(userRole).includes('admin')
      ) return true;
      return this.checkAccess(
        drive.drive_id, null, userId, userRole, userProperties, 'read', boundary,
      );
    });
  }

  deleteDrive(driveId: string, authorizeCommit?: () => void): boolean {
    this.options.managedObjectPolicy?.assertLegacyDriveControlAllowed(driveId);
    return this.deleteDriveRecord(driveId, authorizeCommit);
  }

  /** Trusted record deletion for framework-owned lifecycle composition. */
  deleteDriveRecord(driveId: string, authorizeCommit?: () => void): boolean {
    return this.db.transaction(() => {
      authorizeCommit?.();
      if (!this.getDrive(driveId)) return false;
      const fileCount = (this.stmts.getDriveFileCount.get(driveId) as CountRow).count;
      const folderCount = (this.stmts.getDriveFolderCount.get(driveId) as CountRow).count;
      if (fileCount + folderCount > LEGACY_ATOMIC_DRIVE_DELETE_OBJECT_LIMIT) {
        throw new StorageDomainError(
          'STORAGE_LIMIT_EXCEEDED',
          'Legacy atomic drive deletion exceeds its bounded object limit.',
          { outcome: 'not-committed' },
        );
      }
      while (this.objectMutations.purgeDriveContentsBatchInTransaction(driveId).remaining) {
        // The preflight bound above caps memory and writer-lock duration.
        // Managed deletion uses the durable one-batch worker entry point.
      }
      this.db.delete('storage_drives', driveId);
      return true;
    });
  }

  /**
   * Atomically purge drive objects and grants while retaining its canonical row.
   *
   * Storage Studio uses this boundary before retaining a lifecycle tombstone;
   * zero-reference physical blobs are removed asynchronously and retryably.
   */
  async purgeDriveContents(driveId: string): Promise<boolean> {
    while (true) {
      const result = await this.purgeDriveContentsBatch(driveId);
      if (!result.exists) return false;
      if (!result.remaining) return true;
      await Bun.sleep(0);
    }
  }

  /** Delete one bounded managed-drive batch for durable cleanup workers. */
  async purgeDriveContentsBatch(
    driveId: string,
    limit?: number,
    authorizeCommit?: () => void,
    signal?: AbortSignal,
  ): Promise<{ readonly exists: boolean; readonly remaining: boolean }> {
    throwIfStorageOperationAborted(signal, 'Storage cleanup was cancelled.');
    return this.db.transaction(() => {
      authorizeCommit?.();
      throwIfStorageOperationAborted(signal, 'Storage cleanup was cancelled.');
      if (!this.getDrive(driveId)) {
        return Object.freeze({ exists: false, remaining: false });
      }
      const result = this.objectMutations.purgeDriveContentsBatchInTransaction(
        driveId,
        { limit, retainDriveGrants: true },
      );
      return Object.freeze({ exists: true, remaining: result.remaining });
    });
  }

  getDriveUsage(driveId: string): DriveUsage {
    const drive = this.getDrive(driveId);
    if (!drive) throw new StorageError(404, `Drive not found: ${driveId}`);

    const { total } = this.stmts.getDriveUsage.get(driveId) as SumRow;
    const { count: fileCount } = this.stmts.getDriveFileCount.get(driveId) as CountRow;
    const { count: folderCount } = this.stmts.getDriveFolderCount.get(driveId) as CountRow;

    return {
      driveId,
      name: drive.name,
      totalBytes: total,
      maxBytes: drive.max_size_bytes,
      fileCount,
      folderCount,
      percentUsed: drive.max_size_bytes > 0
        ? Math.round((total / drive.max_size_bytes) * 10000) / 100
        : 0,
    };
  }

  // ─── File Operations ────────────────────────────────────────────────────

  async upload(
    driveId: string,
    path: string,
    data: ReadableStream<Uint8Array> | Uint8Array | Blob,
    fileName: string,
    userId: string | null,
    options: UploadOptions = {},
    scope?: ServiceDataScope,
    authorizeCommit?: () => Promise<void>,
    expectedManagedGeneration?: number,
    authorizeCommitSync?: () => void,
  ): Promise<FileInfo> {
    return this.uploadOperations.run((operationContext) => this.performUpload(
      driveId,
      path,
      data,
      fileName,
      userId,
      options,
      scope,
      authorizeCommit,
      expectedManagedGeneration,
      authorizeCommitSync,
      operationContext,
    ));
  }

  private async performUpload(
    driveId: string,
    path: string,
    data: ReadableStream<Uint8Array> | Uint8Array | Blob,
    fileName: string,
    userId: string | null,
    options: UploadOptions = {},
    scope?: ServiceDataScope,
    authorizeCommit?: () => Promise<void>,
    expectedManagedGeneration?: number,
    authorizeCommitSync?: () => void,
    operationContext?: StorageUploadOperationContext,
  ): Promise<FileInfo> {
    const normalizedPath = normalizeStoragePath(path);
    const normalizedFileName = normalizeStorageName(fileName, 'File name');
    const suppliedMetadata = options.metadata === undefined
      ? null
      : serializeStorageMetadata(options.metadata);
    const admittedDrive = scope
      ? this.getDriveForScope(driveId, scope)
      : this.getDrive(driveId);
    if (!admittedDrive) {
      throw new StorageError(404, 'Storage drive was not found.', 'STORAGE_DRIVE_NOT_FOUND');
    }
    const managedAccess = this.options.managedObjectPolicy?.captureObjectAccess(driveId);
    if (expectedManagedGeneration !== undefined) {
      this.options.managedObjectPolicy?.assertObjectAccessCurrent(
        driveId,
        expectedManagedGeneration,
      );
    }
    const existingPublic = this.objectMutations.getByPath(driveId, normalizedPath)?.public === 1;
    this.options.managedObjectPolicy?.assertObjectVisibilityAllowed(
      driveId,
      options.public ?? existingPublic,
    );

    this.objectMutations.assertUploadPrerequisites(
      driveId,
      normalizedPath,
      options.overwrite === true,
    );

    const declaredBytes = uploadInputByteLength(data, options.contentLength);
    const capabilityMaxSize = options.maxSize === undefined
      ? undefined
      : normalizeStorageByteLimit(options.maxSize, 'Upload size limit');
    const reservation = this.options.uploadAdmission?.begin(
      driveId,
      declaredBytes,
    ) ?? null;

    const maxFileSize = minimumPositiveLimit(
      admittedDrive.max_file_size_bytes,
      capabilityMaxSize,
    );
    if (maxFileSize !== undefined
      && declaredBytes !== undefined
      && declaredBytes > maxFileSize) {
      reservation?.release();
      throw new StorageDomainError(
        'STORAGE_LIMIT_EXCEEDED',
        'Storage upload exceeds the configured file-size limit.',
        { outcome: 'not-committed' },
      );
    }
    const capabilityMimeTypes = options.allowedMimeTypes === undefined
      ? null
      : normalizeStorageMimeTypes(options.allowedMimeTypes);
    let staged: Awaited<ReturnType<StorageAdapter['writeBlob']>> | null = null;
    let published = false;
    try {
      try {
        operationContext?.setProviderHandoffSafe(
          this.adapter.writeShutdownSafety === 'durable-publication',
        );
        try {
          staged = await runWithStorageUploadHeartbeat(
            reservation,
            () => this.adapter.writeBlob(data, maxFileSize, {
              signal: operationContext?.signal,
            }),
            30_000,
            operationContext?.signal,
          );
        } finally {
          operationContext?.setProviderHandoffSafe(false);
        }
        throwIfStorageUploadAborted(operationContext?.signal);
      } catch (cause) {
        throw normalizeStorageProviderWriteError(cause);
      }
      reservation?.adjust(staged.size);
      const detectedMime = detectMimeType(staged.headBytes, normalizedFileName);
      if (capabilityMimeTypes
        && !storageMimeTypeAllowed(detectedMime, capabilityMimeTypes)) {
        throw new StorageDomainError(
          'STORAGE_CONTENT_TYPE_UNSUPPORTED',
          'Detected file type is not allowed by the upload capability.',
          { outcome: 'not-committed' },
        );
      }

      const result = await this.blobLifecycle.run(
        storagePathMutationKeys(driveId, normalizedPath),
        async () => {
          const objectBeforeCommit = this.objectMutations.getByPath(driveId, normalizedPath);
          return this.blobLifecycle.run(
            [
              storageBlobMutationKey(staged!.checksum),
              storageBlobMutationKey(objectBeforeCommit?.checksum),
            ],
            async () => {
              // A failed publication may delete a zero-reference CAS blob while
              // another same-checksum adapter write is still in flight. The
              // checksum lease closes that cleanup race, and this final
              // provider check prevents metadata from committing after the
              // concurrent cleanup won and removed the bytes.
              let blobExists = false;
              try {
                blobExists = await this.adapter.blobExists(staged!.checksum);
              } catch (cause) {
                throw normalizeStorageProviderWriteError(cause);
              }
              if (!blobExists) {
                throw new StorageDomainError(
                  'STORAGE_PROVIDER_UNAVAILABLE',
                  'Staged storage bytes are no longer available; retry the upload.',
                  { retryable: true, outcome: 'not-committed' },
                );
              }
              await authorizeCommit?.();
              return this.objectMutations.publishUpload({
                driveId,
                path: normalizedPath,
                checksum: staged!.checksum,
                size: staged!.size,
                detectedMime,
                userId,
                metadata: suppliedMetadata,
                isPublic: options.public,
                overwrite: options.overwrite === true,
                admittedDrive,
                scope,
                managedGeneration: expectedManagedGeneration ?? managedAccess?.generation,
                authorizeCommit: () => {
                  reservation?.assertCurrent();
                  authorizeCommitSync?.();
                },
                finalizeCommit: () => reservation?.commit(),
              });
            },
          );
        },
      );
      published = true;
      this.settleBlobPublication(staged);
      return result;
    } catch (error) {
      if (operationContext?.isDetached()) {
        // The adapter owns a durable publication receipt. Runtime shutdown may
        // now dispose ReactiveDB; startup reconciliation will decide whether
        // these bytes gained a reference, so this continuation performs no DB
        // or receipt mutation.
        throw error;
      }
      if (!published) reservation?.release();
      if (staged) {
        await this.blobLifecycle.cleanupUnreferenced(staged.checksum, staged.size);
        this.settleBlobPublication(staged);
      }
      throw error;
    }
  }

  /**
   * Create a scoped public-upload grant for one exact object path.
   */
  async createUploadGrant(
    driveId: string,
    params: CreateUploadGrantParams
  ): Promise<StorageUploadGrant> {
    const drive = this.getDrive(driveId);
    if (!drive) throw new StorageError(404, `Drive not found: ${driveId}`);
    if (!this.options.uploadGrantSecret) {
      throw new StorageError(500, 'Storage upload grants are not configured');
    }

    const expiresIn = params.expiresIn ?? this.options.defaultPresignedTTL ?? 3600;
    this.options.managedObjectPolicy?.assertObjectAccessAllowed(driveId);
    this.options.managedObjectPolicy?.assertObjectVisibilityAllowed(
      driveId,
      params.public === true,
    );
    const capability = this.options.prepareCapability?.(driveId, expiresIn);
    const path = normalizeStoragePath(params.path);
    const metadata = params.metadata === undefined
      ? undefined
      : parseStorageMetadata(serializeStorageMetadata(params.metadata));
    return createUploadGrantToken({
      ...params,
      path,
      metadata,
      driveId,
      expiresIn,
      secret: this.options.uploadGrantSecret,
      generation: capability?.generation,
    });
  }

  async download(
    driveId: string,
    path: string,
    authorizeReturn?: () => void,
    expectedManagedGeneration?: number,
  ): Promise<{ stream: ReadableStream<Uint8Array>; info: FileInfo } | null> {
    const managedAccess = this.options.managedObjectPolicy?.captureObjectAccess(driveId);
    if (expectedManagedGeneration !== undefined) {
      this.options.managedObjectPolicy?.assertObjectAccessCurrent(
        driveId,
        expectedManagedGeneration,
      );
    }
    const normalizedPath = normalizeStoragePath(path);
    const obj = this.stmts.getObjectByPath.get(driveId, normalizedPath) as ObjectRecord | null;
    if (!obj || obj.type !== 'file' || !obj.checksum) return null;

    let stream: ReadableStream<Uint8Array> | null;
    try {
      stream = await this.adapter.readBlob(obj.checksum);
    } catch (cause) {
      throw normalizeStorageProviderReadError(cause);
    }
    if (!stream) return null;
    authorizeReturn?.();
    this.options.managedObjectPolicy?.assertObjectAccessCurrent(
      driveId,
      expectedManagedGeneration ?? managedAccess?.generation,
    );

    return { stream, info: toStorageFileInfo(obj) };
  }

  async downloadRange(
    driveId: string,
    path: string,
    start: number,
    end: number,
    authorizeReturn?: () => void,
    expectedManagedGeneration?: number,
  ): Promise<{ stream: ReadableStream<Uint8Array>; info: FileInfo } | null> {
    const managedAccess = this.options.managedObjectPolicy?.captureObjectAccess(driveId);
    if (expectedManagedGeneration !== undefined) {
      this.options.managedObjectPolicy?.assertObjectAccessCurrent(
        driveId,
        expectedManagedGeneration,
      );
    }
    const normalizedPath = normalizeStoragePath(path);
    const obj = this.stmts.getObjectByPath.get(driveId, normalizedPath) as ObjectRecord | null;
    if (!obj || obj.type !== 'file' || !obj.checksum) return null;

    let stream: ReadableStream<Uint8Array> | null;
    try {
      stream = await this.adapter.readBlobRange(obj.checksum, start, end);
    } catch (cause) {
      throw normalizeStorageProviderReadError(cause);
    }
    if (!stream) return null;
    authorizeReturn?.();
    this.options.managedObjectPolicy?.assertObjectAccessCurrent(
      driveId,
      expectedManagedGeneration ?? managedAccess?.generation,
    );

    return { stream, info: toStorageFileInfo(obj) };
  }

  getFileInfo(driveId: string, path: string): FileInfo | null {
    this.options.managedObjectPolicy?.assertObjectAccessAllowed(driveId);
    const normalizedPath = normalizeStoragePath(path);
    const obj = this.stmts.getObjectByPath.get(driveId, normalizedPath) as ObjectRecord | null;
    if (!obj) return null;
    return toStorageFileInfo(obj);
  }

  listFolder(driveId: string, parentPath?: string, options?: ListOptions): ListResult {
    this.options.managedObjectPolicy?.assertObjectAccessAllowed(driveId);
    const normalizedPath = parentPath
      ? normalizeStoragePath(parentPath, { allowRoot: true })
      : null;
    let parentId: string | null = null;

    if (normalizedPath && normalizedPath !== '/') {
      const parent = this.stmts.getObjectByPath.get(driveId, normalizedPath) as ObjectRecord | null;
      if (!parent || parent.type !== 'folder') return { items: [], cursor: null, total: 0 };
      parentId = parent.object_id;
    }

    const searchPattern = storageObjectSearchLikePattern(options?.search);
    const total = this.countFolderRows(
      driveId,
      parentId,
      options?.type,
      searchPattern,
    );
    const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500);
    const offset = storageObjectListOffset(options?.cursor);

    const rows = this.listFolderRows(
      driveId,
      parentId,
      limit,
      offset,
      options,
      searchPattern,
    );

    const nextOffset = offset + rows.length;
    const cursor = nextOffset < total ? String(nextOffset) : null;

    return {
      items: rows.map(toStorageFileInfo),
      cursor,
      total,
    };
  }

  async moveObject(
    driveId: string,
    fromPath: string,
    toPath: string,
    authorizeCommit?: () => void,
  ): Promise<FileInfo> {
    this.options.managedObjectPolicy?.assertObjectAccessAllowed(driveId);
    const commitFence = this.managedObjectCommitFence(driveId, authorizeCommit);
    const from = normalizeStoragePath(fromPath);
    const to = normalizeStoragePath(toPath);
    return this.objectMutations.move(driveId, from, to, commitFence);
  }

  async copyObject(
    driveId: string,
    fromPath: string,
    toPath: string,
    authorizeCommit?: () => void,
  ): Promise<FileInfo> {
    this.options.managedObjectPolicy?.assertObjectAccessAllowed(driveId);
    const commitFence = this.managedObjectCommitFence(driveId, authorizeCommit);
    const from = normalizeStoragePath(fromPath);
    const to = normalizeStoragePath(toPath);
    const source = this.objectMutations.getByPath(driveId, from);
    this.options.managedObjectPolicy?.assertObjectVisibilityAllowed(
      driveId,
      source?.public === 1,
    );

    return this.objectMutations.copy(driveId, from, to, commitFence);
  }

  async deleteObject(
    driveId: string,
    path: string,
    authorizeCommit?: () => void,
  ): Promise<boolean> {
    this.options.managedObjectPolicy?.assertObjectAccessAllowed(driveId);
    const commitFence = this.managedObjectCommitFence(driveId, authorizeCommit);
    const normalizedPath = normalizeStoragePath(path);
    return this.objectMutations.delete(driveId, normalizedPath, commitFence);
  }

  createFolder(
    driveId: string,
    path: string,
    userId: string | null,
    isPublic = false,
    authorizeCommit?: () => void,
  ): FileInfo {
    this.options.managedObjectPolicy?.assertObjectAccessAllowed(driveId);
    this.options.managedObjectPolicy?.assertObjectVisibilityAllowed(driveId, isPublic);
    const commitFence = this.managedObjectCommitFence(driveId, authorizeCommit);
    const normalizedPath = normalizeStoragePath(path);
    return this.objectMutations.createFolder(
      driveId,
      normalizedPath,
      userId,
      isPublic,
      commitFence,
    );
  }

  // ─── Visibility ─────────────────────────────────────────────────────────

  setVisibility(
    driveId: string,
    path: string,
    isPublic: boolean,
    authorizeCommit?: () => void,
  ): FileInfo {
    this.options.managedObjectPolicy?.assertObjectAccessAllowed(driveId);
    this.options.managedObjectPolicy?.assertObjectVisibilityAllowed(driveId, isPublic);
    const commitFence = this.managedObjectCommitFence(driveId, authorizeCommit);
    const normalizedPath = normalizeStoragePath(path);
    return this.db.transaction(() => {
      commitFence();
      this.options.managedObjectPolicy?.assertObjectAccessAllowed(driveId);
      this.options.managedObjectPolicy?.assertObjectVisibilityAllowed(driveId, isPublic);
      const obj = this.stmts.getObjectByPath.get(
        driveId,
        normalizedPath,
      ) as ObjectRecord | null;
      if (!obj) throw new StorageError(404, `Not found: ${normalizedPath}`);

      const updated: ObjectRecord = {
        ...obj,
        public: isPublic ? 1 : 0,
        updated_at: Date.now(),
      };
      this.db.update('storage_objects', obj.object_id, updated as unknown as Row);
      return toStorageFileInfo(updated);
    });
  }

  /** Replace application metadata without rewriting object bytes. */
  updateObjectMetadata(
    driveId: string,
    path: string,
    metadata: Record<string, unknown>,
    scope?: ServiceDataScope,
    authorizeCommit?: () => void,
  ): FileInfo {
    this.options.managedObjectPolicy?.assertObjectAccessAllowed(driveId);
    const commitFence = this.managedObjectCommitFence(driveId, authorizeCommit);
    const normalizedPath = normalizeStoragePath(path);
    const serialized = serializeStorageMetadata(metadata);
    return this.objectMutations.updateMetadata(
      driveId,
      normalizedPath,
      serialized,
      scope,
      commitFence,
    );
  }

  setDriveVisibility(
    driveId: string,
    isPublic: boolean,
    authorizeCommit?: () => void,
  ): DriveRecord {
    this.options.managedObjectPolicy?.assertLegacyDriveControlAllowed(driveId);
    return this.db.transaction(() => {
      authorizeCommit?.();
      return this.setDriveVisibilityRecord(driveId, isPublic);
    });
  }

  /** Trusted visibility mutation used by Studio's revisioned editor. */
  setDriveVisibilityRecord(driveId: string, isPublic: boolean): DriveRecord {
    const drive = this.getDrive(driveId);
    if (!drive) throw new StorageError(404, `Drive not found: ${driveId}`);

    const updated: DriveRecord = { ...drive, public: isPublic ? 1 : 0 };
    this.db.update('storage_drives', driveId, updated as unknown as Row);
    return updated;
  }

  // ─── Permissions ────────────────────────────────────────────────────────

  grantPermission(
    driveId: string,
    params: GrantPermissionParams,
    auditAuthority?: StorageAclAuditAuthority,
    authorizeCommit?: () => void,
  ): PermissionRecord {
    this.options.managedObjectPolicy?.assertObjectAccessAllowed(driveId);
    const commitFence = this.managedObjectCommitFence(driveId, authorizeCommit);
    return this.db.transaction(() => {
      commitFence();
      const permission = this.permissionService.grant(driveId, params);
      appendStorageAclAudit(
        this.options.aclAudit,
        auditAuthority,
        'storage.permission-granted',
        permission,
      );
      return permission;
    });
  }

  /**
   * List permissions for a drive or the permissions considered for one object.
   */
  listPermissions(driveId: string, options: ListPermissionsOptions = {}): PermissionRecord[] {
    return this.permissionService.list(driveId, options);
  }

  /** Get a permission by ID (for authorization checks before revoke). */
  getPermission(permissionId: string): PermissionRecord | null {
    return this.permissionService.get(permissionId);
  }

  revokePermission(
    permissionId: string,
    auditAuthority?: StorageAclAuditAuthority,
    authorizeCommit?: () => void,
  ): boolean {
    const admitted = this.permissionService.get(permissionId);
    if (admitted) this.options.managedObjectPolicy?.assertObjectAccessAllowed(admitted.drive_id);
    const commitFence = admitted
      ? this.managedObjectCommitFence(admitted.drive_id, authorizeCommit)
      : authorizeCommit;
    return this.db.transaction(() => {
      commitFence?.();
      const permission = this.permissionService.get(permissionId);
      const revoked = this.permissionService.revoke(permissionId);
      if (permission) {
        appendStorageAclAudit(
          this.options.aclAudit,
          auditAuthority,
          'storage.permission-revoked',
          permission,
        );
      }
      return revoked;
    });
  }

  /**
   * Check if a user has the required permission level on a drive/object.
   *
   * Access is granted if ANY of these are true:
   * 1. In legacy single mode, user is a platform admin
   * 2. Drive is public (for read access)
   * 3. Object is public (for read access)
   * 4. User is the drive owner
   * 5. User has a matching permission grant (role, user ID, or property)
   */
  checkAccess(
    driveId: string,
    path: string | null,
    userId: string | null,
    userRole: StorageActorRoles,
    userProperties: Record<string, string>,
    requiredLevel: PermissionLevel,
    scope?: ServiceDataScope,
  ): boolean {
    return this.permissionService.checkAccess(
      driveId,
      path,
      userId,
      userRole,
      userProperties,
      requiredLevel,
      scope,
    );
  }

  // ─── Blob Ref Counting ─────────────────────────────────────────────────

  /** Retry one bounded batch of retained zero-reference blob cleanup. */
  async retryBlobCleanup(options?: StorageBlobCleanupOptions): Promise<StorageBlobCleanupPass> {
    const publications = this.recoverPendingBlobPublications(options?.batchSize);
    const blobs = await this.blobLifecycle.retryCleanup(options);
    return Object.freeze({
      attempted: publications.attempted + blobs.attempted,
      remaining: publications.remaining + blobs.remaining,
    });
  }

  // ─── Internal Helpers ───────────────────────────────────────────────────

  private listFolderRows(
    driveId: string,
    parentId: string | null,
    limit: number,
    offset: number,
    options?: ListOptions,
    searchPattern: string | null = null,
  ): ObjectRecord[] {
    const sortBy = toStorageSortColumn(options?.sortBy);
    const sortDir = options?.sortDir === 'desc' ? 'DESC' : 'ASC';
    const clauses = ['drive_id = ?', 'parent_id IS ?'];
    const parameters: Array<string | number | null> = [driveId, parentId];
    if (options?.type && options.type !== 'all') {
      clauses.push('type = ?');
      parameters.push(options.type);
    }
    if (searchPattern) {
      clauses.push(
        `(name COLLATE NOCASE LIKE ? ESCAPE '\\'
          OR path COLLATE NOCASE LIKE ? ESCAPE '\\')`,
      );
      parameters.push(searchPattern, searchPattern);
    }
    parameters.push(limit, offset);
    return this.db.prepare(
      `SELECT * FROM storage_objects
       WHERE ${clauses.join(' AND ')}
       ORDER BY type DESC, ${sortBy} ${sortDir}
       LIMIT ? OFFSET ?`,
    ).all(...parameters) as ObjectRecord[];
  }

  private countFolderRows(
    driveId: string,
    parentId: string | null,
    type: ListOptions['type'] | undefined,
    searchPattern: string | null,
  ): number {
    const clauses = ['drive_id = ?', 'parent_id IS ?'];
    const parameters: Array<string | null> = [driveId, parentId];
    if (type && type !== 'all') {
      clauses.push('type = ?');
      parameters.push(type);
    }
    if (searchPattern) {
      clauses.push(
        `(name COLLATE NOCASE LIKE ? ESCAPE '\\'
          OR path COLLATE NOCASE LIKE ? ESCAPE '\\')`,
      );
      parameters.push(searchPattern, searchPattern);
    }
    const row = this.db.prepare(
      `SELECT COUNT(*) as count FROM storage_objects
       WHERE ${clauses.join(' AND ')}`,
    ).get(...parameters) as CountRow;
    return row.count;
  }

  private requireCreationScope(scope: ServiceDataScope | undefined): ServiceDataScope {
    if (scope) return scope;
    if (this.options.tenancyMode === 'multi') {
      throw new StorageError(403, 'A validated tenant data scope is required');
    }
    return applicationServiceDataScope();
  }

  private managedObjectCommitFence(
    driveId: string,
    authorizeCommit?: () => void,
  ): () => void {
    const access = this.options.managedObjectPolicy?.captureObjectAccess(driveId);
    return () => {
      authorizeCommit?.();
      this.options.managedObjectPolicy?.assertObjectAccessCurrent(
        driveId,
        access?.generation,
      );
    };
  }

  private recoverPendingBlobPublications(limit = 32): StorageBlobCleanupPass & {
    readonly settled: number;
  } {
    const list = this.adapter.listPendingBlobPublications;
    const settle = this.adapter.settleBlobPublication;
    if (!list || !settle) return Object.freeze({ attempted: 0, remaining: 0, settled: 0 });
    let batch: ReturnType<NonNullable<StorageAdapter['listPendingBlobPublications']>>;
    try {
      batch = list.call(this.adapter, limit);
    } catch (cause) {
      this.emitPublicationRecoveryFailure(cause);
      return Object.freeze({ attempted: 0, remaining: 1, settled: 0 });
    }
    let retained = batch.remaining ? 1 : 0;
    let settledCount = 0;
    for (const publication of batch.items) {
      try {
        if (!this.blobLifecycle.recoverPendingPublication(publication)) {
          retained += 1;
          continue;
        }
        settle.call(this.adapter, publication.publicationId);
        settledCount += 1;
      } catch (cause) {
        retained += 1;
        this.emitPublicationRecoveryFailure(cause);
      }
    }
    return Object.freeze({
      attempted: batch.items.length,
      remaining: retained,
      settled: settledCount,
    });
  }

  private settleBlobPublication(staged: StorageBlobWriteResult): void {
    if (!staged.publicationId || !this.adapter.settleBlobPublication) return;
    try {
      this.adapter.settleBlobPublication(staged.publicationId);
    } catch (cause) {
      // Metadata or a zero-reference cleanup row is already durable. Retaining
      // the receipt is safe and lets startup maintenance retry deterministically.
      this.emitPublicationRecoveryFailure(cause);
    }
  }

  private schedulePublicationRecovery(): void {
    if (this.stopping || this.publicationRecoveryTimer) return;
    this.publicationRecoveryTimer = setTimeout(() => {
      this.publicationRecoveryTimer = null;
      if (this.stopping) return;
      const pass = this.recoverPendingBlobPublications();
      if (pass.settled > 0) this.publicationRecoveryDelayMs = 50;
      else this.publicationRecoveryDelayMs = Math.min(
        this.publicationRecoveryDelayMs * 2,
        30_000,
      );
      if (pass.remaining > 0) this.schedulePublicationRecovery();
    }, this.publicationRecoveryDelayMs);
    this.publicationRecoveryTimer.unref?.();
  }

  private emitPublicationRecoveryFailure(cause: unknown): void {
    const normalized = normalizeStorageError(cause);
    const error = new StorageDomainError(
      'STORAGE_PROVIDER_UNAVAILABLE',
      'Storage publication receipt recovery did not complete.',
      { retryable: true, outcome: 'not-committed', cause: normalized },
    );
    emitPlatformCode(OBS_CODES.STORAGE_BLOB_CLEANUP_FAILED, {
      error,
      metadata: { retryable: true, phase: 'publication-receipt' },
    });
  }

  private finishProviderShutdownAfterUploads(): Promise<void> {
    if (this.providerShutdown) return this.providerShutdown;
    this.providerShutdown = this.uploadOperations.whenDrained()
      .then(() => this.performProviderStop())
      .catch((cause) => {
        this.emitPublicationRecoveryFailure(cause);
      });
    return this.providerShutdown;
  }

  private stopProviderResources(): Promise<void> {
    if (this.providerShutdown) return this.providerShutdown;
    const shutdown = this.performProviderStop();
    this.providerShutdown = shutdown;
    return shutdown;
  }

  private async performProviderStop(): Promise<void> {
    const failures: unknown[] = [];
    try { await this.blobLifecycle.stop(); } catch (error) { failures.push(error); }
    try { await this.adapter.stop?.(); } catch (error) { failures.push(error); }
    if (failures.length > 0) throw failures[0];
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function throwIfStorageUploadAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new StorageDomainError(
    'STORAGE_NOT_READY',
    'Storage upload was cancelled during shutdown.',
    { retryable: true, outcome: 'not-committed' },
  );
}

function throwIfStorageOperationAborted(signal: AbortSignal | undefined, message: string): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new StorageDomainError(
    'STORAGE_PROVIDER_UNAVAILABLE',
    message,
    { retryable: true, outcome: 'not-committed' },
  );
}

function toStorageSortColumn(sortBy: ListOptions['sortBy'] | undefined): string {
  switch (sortBy) {
    case 'size':
      return 'size_bytes';
    case 'created_at':
      return 'created_at';
    case 'updated_at':
      return 'updated_at';
    case 'name':
    default:
      return 'name';
  }
}

function uploadInputByteLength(
  data: ReadableStream<Uint8Array> | Uint8Array | Blob,
  declared: number | undefined,
): number | undefined {
  if (declared !== undefined) {
    if (!Number.isSafeInteger(declared) || declared < 0) {
      throw new StorageDomainError(
        'STORAGE_INPUT_INVALID',
        'Upload content length is invalid.',
      );
    }
    return declared;
  }
  if (data instanceof Uint8Array) return data.byteLength;
  if (data instanceof Blob) return data.size;
  return undefined;
}

function minimumPositiveLimit(
  driveLimit: number,
  capabilityLimit: number | undefined,
): number | undefined {
  const limits = [driveLimit, capabilityLimit]
    .filter((value): value is number => value !== undefined && value > 0);
  return limits.length > 0 ? Math.min(...limits) : undefined;
}
