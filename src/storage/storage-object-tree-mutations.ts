/** Transactional move/copy/delete/folder/metadata mutations for Storage trees. */

import {
  serviceDataScopeMatchesTenant,
  type ServiceDataScope,
} from '../auth/service-data-scope';
import type { ReactiveDB } from '../sync/reactive-db';
import type { Row } from '../sync/types';
import {
  StorageBlobLifecycle,
  storageBlobMutationKey,
  storagePathMutationKeys,
} from './storage-blob-lifecycle';
import { StorageDomainError } from './storage-domain-error';
import { StorageError } from './storage-error';
import {
  isStoragePathDescendant,
  parseStorageMetadata,
  storageDescendantLikePattern,
  storagePathPrefixes,
} from './storage-input';
import type { StorageManagedObjectPolicy } from './storage-managed-object-policy';
import { toStorageFileInfo } from './storage-object-values';
import type { DriveRecord, FileInfo, ObjectRecord } from './types';
import type { StorageUploadAdmission } from './storage-upload-admission';

interface SumRow { total: number }

/** Owns object-tree mutations other than staged upload publication. */
export class StorageObjectTreeMutationStore {
  private readonly stmts;

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
      getAllChildren: db.prepare(
        `SELECT * FROM storage_objects
         WHERE drive_id = ?
           AND path LIKE ? ESCAPE '\\'
           AND substr(path, 1, length(?)) = ?
         ORDER BY length(path), path`,
      ),
      deletePermissionsByObject: db.prepare(
        'DELETE FROM _storage_permissions WHERE object_id = ?',
      ),
    };
  }

  async move(
    driveId: string,
    from: string,
    to: string,
    authorizeCommit?: () => void,
  ): Promise<FileInfo> {
    if (isStoragePathDescendant(to, from)) {
      throw pathConflict('A folder cannot be moved into its own descendant.');
    }
    return this.blobs.run(
      [
        ...storagePathMutationKeys(driveId, from),
        ...storagePathMutationKeys(driveId, to),
      ],
      async () => this.db.transaction(() => {
        this.managedPolicy?.assertObjectAccessAllowed(driveId);
        authorizeCommit?.();
        const object = this.getByPath(driveId, from);
        if (!object) {
          throw new StorageError(
            404,
            'Storage object was not found.',
            'STORAGE_OBJECT_NOT_FOUND',
          );
        }
        if (this.getByPath(driveId, to)) throw pathConflict('Target path already exists.');

        this.assertPathCapacity(driveId, to, false);
        const parentId = this.ensureParentFolders(
          driveId,
          to,
          object.created_by,
          object.tenant_id,
        );
        const now = Date.now();
        const updated: ObjectRecord = {
          ...object,
          path: to,
          name: to.split('/').pop()!,
          parent_id: parentId,
          updated_at: now,
        };
        this.db.update('storage_objects', object.object_id, updated as unknown as Row);

        if (object.type === 'folder') {
          for (const child of this.getDescendants(driveId, from)) {
            this.db.update('storage_objects', child.object_id, {
              ...child,
              path: to + child.path.slice(from.length),
              updated_at: now,
            } as unknown as Row);
          }
        }
        return toStorageFileInfo(updated);
      }),
    );
  }

  async copy(
    driveId: string,
    from: string,
    to: string,
    authorizeCommit?: () => void,
  ): Promise<FileInfo> {
    return this.blobs.run(
      [
        ...storagePathMutationKeys(driveId, from),
        ...storagePathMutationKeys(driveId, to),
      ],
      async () => {
        const sourceBeforeCommit = this.getByPath(driveId, from);
        return this.blobs.run(
          [storageBlobMutationKey(sourceBeforeCommit?.checksum)],
          async () => this.db.transaction(() => {
            this.managedPolicy?.assertObjectAccessAllowed(driveId);
            authorizeCommit?.();
            const drive = this.stmts.getDrive.get(driveId) as DriveRecord | null;
            if (!drive) {
              throw new StorageError(
                404,
                'Storage drive was not found.',
                'STORAGE_DRIVE_NOT_FOUND',
              );
            }
            const source = this.getByPath(driveId, from);
            if (!source || source.type !== 'file' || !source.checksum) {
              throw new StorageError(
                404,
                'Source file was not found.',
                'STORAGE_OBJECT_NOT_FOUND',
              );
            }
            parseStorageMetadata(source.metadata);
            this.managedPolicy?.assertObjectVisibilityAllowed(
              driveId,
              source.public === 1,
            );
            if (this.getByPath(driveId, to)) {
              throw pathConflict('Target path already exists.');
            }

            const { total } = this.stmts.getDriveUsage.get(driveId) as SumRow;
            if (drive.max_size_bytes > 0
              && total + source.size_bytes > drive.max_size_bytes) {
              throw new StorageError(
                413,
                'Copy would exceed drive capacity.',
                'STORAGE_QUOTA_EXCEEDED',
              );
            }
            const blob = this.blobs.getRecord(source.checksum);
            if (!blob || blob.ref_count < 1) throw invalidReferenceState();

            this.assertPathCapacity(driveId, to, true);
            const parentId = this.ensureParentFolders(
              driveId,
              to,
              source.created_by,
              source.tenant_id,
            );
            this.blobs.incrementInTransaction(source.checksum, source.size_bytes);
            const now = Date.now();
            const copy: ObjectRecord = {
              object_id: `obj_${crypto.randomUUID()}`,
              tenant_id: source.tenant_id,
              drive_id: driveId,
              parent_id: parentId,
              name: to.split('/').pop()!,
              path: to,
              type: 'file',
              mime_type: source.mime_type,
              size_bytes: source.size_bytes,
              checksum: source.checksum,
              public: source.public,
              metadata: source.metadata,
              created_by: source.created_by,
              created_at: now,
              updated_at: now,
            };
            this.db.insert('storage_objects', copy as unknown as Row);
            return toStorageFileInfo(copy);
          }),
        );
      },
    );
  }

  async delete(
    driveId: string,
    path: string,
    authorizeCommit?: () => void,
  ): Promise<boolean> {
    return this.blobs.run(
      storagePathMutationKeys(driveId, path),
      async () => this.db.transaction(() => {
        this.managedPolicy?.assertObjectAccessAllowed(driveId);
        authorizeCommit?.();
        const object = this.getByPath(driveId, path);
        if (!object) return false;
        const descendants = object.type === 'folder'
          ? this.getDescendants(driveId, path)
          : [];
        for (const candidate of [...descendants, object]) {
          if (candidate.type === 'file' && candidate.checksum) {
            this.blobs.decrementInTransaction(candidate.checksum);
          }
          this.stmts.deletePermissionsByObject.run(candidate.object_id);
        }
        for (const child of [...descendants].reverse()) {
          this.db.delete('storage_objects', child.object_id);
        }
        this.db.delete('storage_objects', object.object_id);
        return true;
      }),
    );
  }

  createFolder(
    driveId: string,
    path: string,
    userId: string | null,
    isPublic: boolean,
    authorizeCommit?: () => void,
  ): FileInfo {
    return this.db.transaction(() => {
      authorizeCommit?.();
      this.managedPolicy?.assertObjectAccessAllowed(driveId);
      this.managedPolicy?.assertObjectVisibilityAllowed(driveId, isPublic);
      const drive = this.stmts.getDrive.get(driveId) as DriveRecord | null;
      if (!drive) {
        throw new StorageError(404, 'Storage drive was not found.', 'STORAGE_DRIVE_NOT_FOUND');
      }
      const existing = this.getByPath(driveId, path);
      if (existing) {
        if (existing.type === 'folder') return toStorageFileInfo(existing);
        throw pathConflict('A file already occupies the path.');
      }

      this.assertPathCapacity(driveId, path, true);
      const parentId = this.ensureParentFolders(driveId, path, userId, drive.tenant_id);
      const now = Date.now();
      const record: ObjectRecord = {
        object_id: `obj_${crypto.randomUUID()}`,
        tenant_id: drive.tenant_id,
        drive_id: driveId,
        parent_id: parentId,
        name: path.split('/').pop()!,
        path,
        type: 'folder',
        mime_type: null,
        size_bytes: 0,
        checksum: null,
        public: isPublic ? 1 : 0,
        metadata: '{}',
        created_by: userId,
        created_at: now,
        updated_at: now,
      };
      this.db.insert('storage_objects', record as unknown as Row);
      return toStorageFileInfo(record);
    });
  }

  updateMetadata(
    driveId: string,
    path: string,
    metadata: string,
    scope?: ServiceDataScope,
    authorizeCommit?: () => void,
  ): FileInfo {
    return this.db.transaction(() => {
      authorizeCommit?.();
      this.managedPolicy?.assertObjectAccessAllowed(driveId);
      const drive = this.stmts.getDrive.get(driveId) as DriveRecord | null;
      if (!drive || (scope && !serviceDataScopeMatchesTenant(scope, drive.tenant_id))) {
        throw new StorageError(404, 'Storage object was not found.', 'STORAGE_OBJECT_NOT_FOUND');
      }
      const object = this.getByPath(driveId, path);
      if (!object) {
        throw new StorageError(404, 'Storage object was not found.', 'STORAGE_OBJECT_NOT_FOUND');
      }
      const updated: ObjectRecord = {
        ...object,
        metadata,
        updated_at: Date.now(),
      };
      this.db.update('storage_objects', object.object_id, updated as unknown as Row);
      return toStorageFileInfo(updated);
    });
  }

  private getByPath(driveId: string, path: string): ObjectRecord | null {
    return this.stmts.getObjectByPath.get(driveId, path) as ObjectRecord | null;
  }

  private getDescendants(driveId: string, path: string): ObjectRecord[] {
    const descendantPrefix = `${path}/`;
    return this.stmts.getAllChildren.all(
      driveId,
      storageDescendantLikePattern(path),
      descendantPrefix,
      descendantPrefix,
    ) as ObjectRecord[];
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

  private assertPathCapacity(driveId: string, path: string, includeTarget: boolean): void {
    if (!this.admission) return;
    const prefixes = storagePathPrefixes(path);
    const candidates = includeTarget ? prefixes : prefixes.slice(0, -1);
    const additional = candidates.reduce(
      (count, candidate) => count + (this.getByPath(driveId, candidate) ? 0 : 1),
      0,
    );
    this.admission.assertObjectCapacity(driveId, additional);
  }
}

function pathConflict(message: string): StorageError {
  return new StorageError(409, message, 'STORAGE_PATH_CONFLICT');
}

function invalidReferenceState(): StorageDomainError {
  return new StorageDomainError(
    'STORAGE_INTERNAL',
    'Storage blob reference state is invalid.',
    { outcome: 'not-committed' },
  );
}
