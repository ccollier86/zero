/**
 * storage-object-mutations.ts
 *
 * Owns transactional Storage object-tree mutations: upload publication,
 * copy/move/delete, folder-parent creation, and drive-content purging. Byte
 * staging, request authorization, reads, and permission evaluation stay in
 * their dedicated layers.
 */

import {
  serviceDataScopeMatchesTenant,
  type ServiceDataScope,
} from '../auth/service-data-scope';
import type { ReactiveDB } from '../sync/reactive-db';
import type { Row } from '../sync/types';
import { StorageBlobLifecycle } from './storage-blob-lifecycle';
import {
  StorageDrivePurgeStore,
  type StorageDrivePurgeBatchResult,
} from './storage-drive-purge-store';
import { StorageError } from './storage-error';
import {
  parseStorageMetadata,
  storagePathPrefixes,
} from './storage-input';
import { storageMimeTypeAllowed, toStorageFileInfo } from './storage-object-values';
import { StorageObjectTreeMutationStore } from './storage-object-tree-mutations';
import type { StorageManagedObjectPolicy } from './storage-managed-object-policy';
import type { DriveRecord, FileInfo, ObjectRecord } from './types';
import type { StorageUploadAdmission } from './storage-upload-admission';

interface SumRow { total: number }

export interface StorageUploadPublication {
  readonly driveId: string;
  readonly path: string;
  readonly checksum: string;
  readonly size: number;
  readonly detectedMime: string;
  readonly userId: string | null;
  readonly metadata: string | null;
  readonly isPublic: boolean | undefined;
  readonly overwrite: boolean;
  readonly admittedDrive: DriveRecord;
  readonly scope?: ServiceDataScope;
  readonly managedGeneration?: number;
  readonly authorizeCommit?: () => void;
  /** Settle durable upload admission as the final write in this transaction. */
  readonly finalizeCommit?: () => void;
}

/** Transactional persistence boundary for logical Storage object mutations. */
export class StorageObjectMutationStore {
  private readonly stmts;
  private readonly treeMutations: StorageObjectTreeMutationStore;
  private readonly drivePurge: StorageDrivePurgeStore;

  constructor(
    private readonly db: ReactiveDB,
    private readonly blobs: StorageBlobLifecycle,
    private readonly admission?: Pick<StorageUploadAdmission, 'assertObjectCapacity'>,
    private readonly managedPolicy?: StorageManagedObjectPolicy,
  ) {
    this.stmts = {
      getDrive: db.prepare('SELECT * FROM storage_drives WHERE drive_id = ?'),
      getObjectByPath: db.prepare(
        'SELECT * FROM storage_objects WHERE drive_id = ? AND path = ?',
      ),
      getDriveUsage: db.prepare(
        "SELECT COALESCE(SUM(size_bytes), 0) as total FROM storage_objects WHERE drive_id = ? AND type = 'file'",
      ),
    };
    this.treeMutations = new StorageObjectTreeMutationStore(
      db,
      blobs,
      admission,
      managedPolicy,
    );
    this.drivePurge = new StorageDrivePurgeStore(db, blobs);
  }

  /** Read one object by an already canonical path. */
  getByPath(driveId: string, path: string): ObjectRecord | null {
    return this.stmts.getObjectByPath.get(driveId, path) as ObjectRecord | null;
  }

  /** Fail before byte staging when the current logical target cannot upload. */
  assertUploadPrerequisites(
    driveId: string,
    path: string,
    overwrite: boolean,
  ): void {
    const existing = this.getByPath(driveId, path);
    assertUploadTarget(existing, overwrite);
    this.assertParentChainCanContainObject(driveId, path);
    if (existing) parseStorageMetadata(existing.metadata);
  }

  /**
   * Atomically publish staged bytes into object metadata and blob references.
   * The current drive policy and authority are reread inside the transaction.
   */
  publishUpload(input: StorageUploadPublication): FileInfo {
    return this.db.transaction(() => {
      input.authorizeCommit?.();
      const drive = this.stmts.getDrive.get(input.driveId) as DriveRecord | null;
      if (!drive
        || (input.scope && !serviceDataScopeMatchesTenant(input.scope, drive.tenant_id))
        || drive.created_at !== input.admittedDrive.created_at) {
        throw new StorageError(
          403,
          'Storage authority changed during upload.',
          'STORAGE_AUTHORITY_CHANGED',
        );
      }

      const existing = this.getByPath(input.driveId, input.path);
      assertUploadTarget(existing, input.overwrite);
      if (existing) parseStorageMetadata(existing.metadata);
      this.managedPolicy?.assertObjectAccessCurrent(
        input.driveId,
        input.managedGeneration,
      );
      this.managedPolicy?.assertObjectVisibilityAllowed(
        input.driveId,
        input.isPublic ?? existing?.public === 1,
      );
      if (drive.max_file_size_bytes > 0 && input.size > drive.max_file_size_bytes) {
        throw new StorageError(
          413,
          'File exceeds the current drive file-size limit.',
          'STORAGE_LIMIT_EXCEEDED',
        );
      }
      if (!storageMimeTypeAllowed(input.detectedMime, drive.allowed_mime_types.split(','))) {
        throw new StorageError(
          415,
          'Detected file type is not allowed by the drive policy.',
          'STORAGE_CONTENT_TYPE_UNSUPPORTED',
        );
      }

      const { total } = this.stmts.getDriveUsage.get(input.driveId) as SumRow;
      const replacedBytes = existing?.type === 'file' ? existing.size_bytes : 0;
      if (drive.max_size_bytes > 0
        && total - replacedBytes + input.size > drive.max_size_bytes) {
        throw new StorageError(
          413,
          'Upload would exceed drive capacity.',
          'STORAGE_QUOTA_EXCEEDED',
        );
      }

      this.assertPathCapacity(input.driveId, input.path, existing === null);

      const parentId = this.ensureParentFolders(
        input.driveId,
        input.path,
        input.userId,
        drive.tenant_id,
      );
      if (existing?.checksum !== input.checksum) {
        this.blobs.incrementInTransaction(input.checksum, input.size);
        if (existing?.checksum) this.blobs.decrementInTransaction(existing.checksum);
      }

      const now = Date.now();
      const objectId = existing?.object_id ?? `obj_${crypto.randomUUID()}`;
      const record: ObjectRecord = existing
        ? {
            ...existing,
            parent_id: parentId,
            size_bytes: input.size,
            mime_type: input.detectedMime,
            checksum: input.checksum,
            metadata: input.metadata ?? existing.metadata,
            public: input.isPublic === undefined
              ? existing.public
              : input.isPublic ? 1 : 0,
            updated_at: now,
          }
        : {
            object_id: objectId,
            tenant_id: drive.tenant_id,
            drive_id: input.driveId,
            parent_id: parentId,
            name: input.path.split('/').pop()!,
            path: input.path,
            type: 'file',
            mime_type: input.detectedMime,
            size_bytes: input.size,
            checksum: input.checksum,
            public: input.isPublic ? 1 : 0,
            metadata: input.metadata ?? '{}',
            created_by: input.userId,
            created_at: now,
            updated_at: now,
          };

      if (existing) {
        this.db.update('storage_objects', objectId, record as unknown as Row);
      } else {
        this.db.insert('storage_objects', record as unknown as Row);
      }
      input.finalizeCommit?.();
      return toStorageFileInfo(record);
    });
  }

  /** Atomically move one file or complete folder subtree. */
  async move(
    driveId: string,
    from: string,
    to: string,
    authorizeCommit?: () => void,
  ): Promise<FileInfo> {
    return this.treeMutations.move(driveId, from, to, authorizeCommit);
  }

  /** Atomically copy one file, its reference, and any missing parents. */
  async copy(
    driveId: string,
    from: string,
    to: string,
    authorizeCommit?: () => void,
  ): Promise<FileInfo> {
    return this.treeMutations.copy(driveId, from, to, authorizeCommit);
  }

  /** Atomically delete one file or a complete folder subtree. */
  async delete(
    driveId: string,
    path: string,
    authorizeCommit?: () => void,
  ): Promise<boolean> {
    return this.treeMutations.delete(driveId, path, authorizeCommit);
  }

  /** Atomically create a folder and every missing folder parent. */
  createFolder(
    driveId: string,
    path: string,
    userId: string | null,
    isPublic: boolean,
    authorizeCommit?: () => void,
  ): FileInfo {
    return this.treeMutations.createFolder(
      driveId,
      path,
      userId,
      isPublic,
      authorizeCommit,
    );
  }

  /** Replace bounded object metadata inside the caller's validated data scope. */
  updateMetadata(
    driveId: string,
    path: string,
    metadata: string,
    scope?: ServiceDataScope,
    authorizeCommit?: () => void,
  ): FileInfo {
    return this.treeMutations.updateMetadata(
      driveId,
      path,
      metadata,
      scope,
      authorizeCommit,
    );
  }

  /** Purge one bounded metadata batch inside the caller's transaction. */
  purgeDriveContentsBatchInTransaction(
    driveId: string,
    options: {
      readonly limit?: number;
      readonly retainDriveGrants?: boolean;
    } = {},
  ): StorageDrivePurgeBatchResult {
    return this.drivePurge.purgeBatchInTransaction(driveId, options);
  }

  private ensureParentFolders(
    driveId: string,
    objectPath: string,
    userId: string | null,
    tenantId: string | null,
  ): string | null {
    const parts = objectPath.split('/').filter(Boolean);
    if (parts.length <= 1) return null;
    let currentPath = '';
    let parentId: string | null = null;

    for (const part of parts.slice(0, -1)) {
      currentPath += `/${part}`;
      const existing = this.getByPath(driveId, currentPath);
      if (existing) {
        if (existing.type !== 'folder') {
          throw pathConflict('A file cannot be used as a storage parent.');
        }
        parentId = existing.object_id;
        continue;
      }

      const now = Date.now();
      const folder: ObjectRecord = {
        object_id: `obj_${crypto.randomUUID()}`,
        tenant_id: tenantId,
        drive_id: driveId,
        parent_id: parentId,
        name: part,
        path: currentPath,
        type: 'folder',
        mime_type: null,
        size_bytes: 0,
        checksum: null,
        public: 0,
        metadata: '{}',
        created_by: userId,
        created_at: now,
        updated_at: now,
      };
      this.db.insert('storage_objects', folder as unknown as Row);
      parentId = folder.object_id;
    }
    return parentId;
  }

  private assertPathCapacity(
    driveId: string,
    path: string,
    includeTarget: boolean,
  ): void {
    if (!this.admission) return;
    const prefixes = storagePathPrefixes(path);
    const candidates = includeTarget ? prefixes : prefixes.slice(0, -1);
    const additional = candidates.reduce(
      (count, candidate) => count + (this.getByPath(driveId, candidate) ? 0 : 1),
      0,
    );
    this.admission.assertObjectCapacity(driveId, additional);
  }

  private assertParentChainCanContainObject(driveId: string, path: string): void {
    for (const parentPath of storagePathPrefixes(path).slice(0, -1)) {
      if (this.getByPath(driveId, parentPath)?.type === 'file') {
        throw pathConflict('A file cannot be used as a storage parent.');
      }
    }
  }
}

function assertUploadTarget(existing: ObjectRecord | null, overwrite: boolean): void {
  if (!existing) return;
  if (existing.type !== 'file') {
    throw pathConflict('A folder already occupies the upload path.');
  }
  if (!overwrite) throw pathConflict('A file already occupies the upload path.');
}

function pathConflict(message: string): StorageError {
  return new StorageError(409, message, 'STORAGE_PATH_CONFLICT');
}
