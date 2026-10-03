/**
 * Scope-safe StorageService projection for requests and workflow steps.
 *
 * This module owns drive/object ACL projection and authority fencing. Storage
 * persistence, adapters, and byte transport remain in StorageService.
 */

import type { RequestAuthorizationAccess } from '../../../auth/authorization-access';
import { effectiveServiceDataRoles } from '../../../auth/service-data-authority';
import {
  serviceDataScopeMatchesTenant,
  type ServiceDataScope,
} from '../../../auth/service-data-scope';
import {
  StorageError,
  type StorageActorRoles,
  type StorageService,
} from '../../../storage/storage-service';
import type { StorageAclAuditProvenance } from '../../../storage/storage-acl-audit';
import {
  createScopedStorageStudioApi,
  type ScopedStorageStudioApi,
} from '../../../storage/storage-studio-scoped-api';
import type { DriveRecord, PermissionLevel } from '../../../storage/types';
import type { CompleteServiceMemberInventory } from './restricted-service-proxy';
import type {
  ScopedStorageDriveApi,
  ScopedStorageMethods,
  ScopedStorageObjectApi,
  ScopedStoragePermissionApi,
  ScopedStorageService,
  ScopedStorageUploadGrantApi,
} from './scoped-storage-contracts';
import { createScopedStorageProxy } from './scoped-storage-proxy';

export type {
  ScopedStorageDriveApi,
  ScopedStorageMethods,
  ScopedStorageObjectApi,
  ScopedStoragePermissionApi,
  ScopedStorageService,
  ScopedStorageUploadData,
  ScopedStorageUploadGrantApi,
} from './scoped-storage-contracts';

type ScopedStorageMembers = keyof ScopedStorageMethods
  | 'drives'
  | 'objects'
  | 'permissions'
  | 'uploads'
  | 'studio';

const STORAGE_SERVICE_INVENTORY: CompleteServiceMemberInventory<
  StorageService,
  ScopedStorageMembers,
  | 'createDriveRecord'
  | 'updateDriveRecord'
  | 'deleteDriveRecord'
  | 'setDriveVisibilityRecord'
  | 'purgeDriveContents'
  | 'purgeDriveContentsBatch'
  | 'retryBlobCleanup'
  | 'stop'
  | 'rollbackFailedStart'
  | 'attachStudioService'
  | 'getAttachedStudioService'
  | 'detachStudioService'
  | 'captureObjectCommitFence'
  | 'captureManagedObjectAccess'
  | 'assertManagedObjectAccessCurrent'
  | 'getDriveForScope'
  | 'listDrivesForUser'
> = true;
void STORAGE_SERVICE_INVENTORY;

export function createScopedStorageService(
  service: StorageService,
  scope: ServiceDataScope,
  access: RequestAuthorizationAccess,
  getProperties: () => Record<string, string>,
  assertCurrentAuthority: () => Promise<void>,
  assertCurrentAuthoritySync: () => void,
  privilegedSystem: boolean,
  auditProvenance: StorageAclAuditProvenance = 'authenticated-request',
): ScopedStorageService {
  const auth = access.context;

  const actorRoles = (): StorageActorRoles => {
    if (!auth) return null;
    return effectiveServiceDataRoles(access, scope);
  };

  const canAccess = (
    driveId: string,
    level: PermissionLevel,
    path: string | null = null,
  ): boolean => {
    assertCurrentAuthoritySync();
    if (privilegedSystem) return true;
    if (!auth) return scope.scopeKind === 'application';
    const properties = getProperties();
    return service.checkAccess(
      driveId,
      path,
      auth.userId,
      actorRoles(),
      properties,
      level,
      scope,
    );
  };

  const requireDrive = (
    driveId: string,
    level: PermissionLevel,
    path: string | null = null,
  ): DriveRecord => {
    assertCurrentAuthoritySync();
    const drive = service.getDriveForScope(driveId, scope);
    if (!drive) throw new StorageError(404, 'Drive not found');
    if (!canAccess(driveId, level, path)) throw new StorageError(403, 'Forbidden');
    return drive;
  };

  const requireActorId = (): string => {
    assertCurrentAuthoritySync();
    if (!auth) throw new StorageError(401, 'Storage actor is required');
    return auth.userId;
  };

  const commitAccess = (
    driveId: string,
    requirements: ReadonlyArray<Readonly<{
      level: PermissionLevel;
      path?: string | null;
    }>>,
  ): (() => void) => service.captureObjectCommitFence(driveId, () => {
    for (const requirement of requirements) {
      requireDrive(driveId, requirement.level, requirement.path ?? null);
    }
  });

  const commitDriveAccess = (
    driveId: string,
    level: PermissionLevel,
    path: string | null = null,
  ): (() => void) => commitAccess(driveId, [{ level, path }]);

  const listVisibleDrives = (): DriveRecord[] => {
    assertCurrentAuthoritySync();
    return service.listDrives()
      .filter((drive) => serviceDataScopeMatchesTenant(scope, drive.tenant_id))
      .filter((drive) => canAccess(drive.drive_id, 'read'));
  };

  const methods: ScopedStorageMethods = {
    createDrive(params) {
      const ownerId = requireActorId();
      return service.createDrive(ownerId, params, scope, assertCurrentAuthoritySync);
    },
    getDrive(driveId) {
      assertCurrentAuthoritySync();
      const drive = service.getDriveForScope(driveId, scope);
      return drive && canAccess(driveId, 'read') ? drive : null;
    },
    updateDrive(driveId, updates) {
      requireDrive(driveId, 'admin');
      const commitFence = commitDriveAccess(driveId, 'admin');
      return service.updateDrive(driveId, updates, commitFence);
    },
    listDrives() {
      return listVisibleDrives();
    },
    deleteDrive(driveId) {
      requireDrive(driveId, 'admin');
      const commitFence = commitDriveAccess(driveId, 'admin');
      return service.deleteDrive(driveId, commitFence);
    },
    getDriveUsage(driveId) {
      requireDrive(driveId, 'read');
      return service.getDriveUsage(driveId);
    },
    async upload(driveId, path, data, fileName, options) {
      const userId = requireActorId();
      requireDrive(driveId, 'write', path);
      const commitFence = commitDriveAccess(driveId, 'write', path);
      await assertCurrentAuthority();
      return service.upload(
        driveId,
        path,
        data,
        fileName,
        userId,
        options,
        scope,
        assertCurrentAuthority,
        undefined,
        commitFence,
      );
    },
    async createUploadGrant(driveId, params) {
      requireDrive(driveId, 'write', params.path);
      const returnFence = commitDriveAccess(driveId, 'write', params.path);
      await assertCurrentAuthority();
      const result = await service.createUploadGrant(driveId, params);
      returnFence();
      return result;
    },
    async download(driveId, path) {
      requireDrive(driveId, 'read', path);
      const returnFence = commitDriveAccess(driveId, 'read', path);
      await assertCurrentAuthority();
      return service.download(driveId, path, returnFence);
    },
    async downloadRange(driveId, path, start, end) {
      requireDrive(driveId, 'read', path);
      const returnFence = commitDriveAccess(driveId, 'read', path);
      await assertCurrentAuthority();
      return service.downloadRange(driveId, path, start, end, returnFence);
    },
    getFileInfo(driveId, path) {
      requireDrive(driveId, 'read', path);
      return service.getFileInfo(driveId, path);
    },
    listFolder(driveId, parentPath, options) {
      requireDrive(driveId, 'read', parentPath ?? null);
      return service.listFolder(driveId, parentPath, options);
    },
    async moveObject(driveId, fromPath, toPath) {
      requireDrive(driveId, 'write', fromPath);
      requireDrive(driveId, 'write', toPath);
      const commitFence = commitAccess(driveId, [
        { level: 'write', path: fromPath },
        { level: 'write', path: toPath },
      ]);
      await assertCurrentAuthority();
      return service.moveObject(
        driveId,
        fromPath,
        toPath,
        commitFence,
      );
    },
    async copyObject(driveId, fromPath, toPath) {
      requireDrive(driveId, 'read', fromPath);
      requireDrive(driveId, 'write', toPath);
      const commitFence = commitAccess(driveId, [
        { level: 'read', path: fromPath },
        { level: 'write', path: toPath },
      ]);
      await assertCurrentAuthority();
      return service.copyObject(
        driveId,
        fromPath,
        toPath,
        commitFence,
      );
    },
    async deleteObject(driveId, path) {
      requireDrive(driveId, 'write', path);
      const commitFence = commitDriveAccess(driveId, 'write', path);
      await assertCurrentAuthority();
      return service.deleteObject(driveId, path, commitFence);
    },
    createFolder(driveId, path, isPublic) {
      const userId = requireActorId();
      requireDrive(driveId, 'write', path);
      const commitFence = commitDriveAccess(driveId, 'write', path);
      return service.createFolder(
        driveId, path, userId, isPublic, commitFence,
      );
    },
    setVisibility(driveId, path, isPublic) {
      requireDrive(driveId, 'admin', path);
      const commitFence = commitDriveAccess(driveId, 'admin', path);
      return service.setVisibility(
        driveId, path, isPublic, commitFence,
      );
    },
    updateObjectMetadata(driveId, path, metadata) {
      requireDrive(driveId, 'write', path);
      const commitFence = commitDriveAccess(driveId, 'write', path);
      return service.updateObjectMetadata(
        driveId, path, metadata, scope, commitFence,
      );
    },
    setDriveVisibility(driveId, isPublic) {
      requireDrive(driveId, 'admin');
      const commitFence = commitDriveAccess(driveId, 'admin');
      return service.setDriveVisibility(
        driveId, isPublic, commitFence,
      );
    },
    grantPermission(driveId, params) {
      requireDrive(driveId, 'admin', params.objectPath ?? null);
      const commitFence = commitDriveAccess(
        driveId,
        'admin',
        params.objectPath ?? null,
      );
      return service.grantPermission(
        driveId,
        params,
        { context: auth, scope, provenance: auditProvenance },
        commitFence,
      );
    },
    listPermissions(driveId, options) {
      requireDrive(driveId, 'admin', options?.objectPath ?? null);
      return service.listPermissions(driveId, options);
    },
    getPermission(permissionId) {
      assertCurrentAuthoritySync();
      const permission = service.getPermission(permissionId);
      if (!permission || !serviceDataScopeMatchesTenant(scope, permission.tenant_id)) return null;
      requireDrive(permission.drive_id, 'admin');
      return permission;
    },
    revokePermission(permissionId) {
      const permission = methods.getPermission(permissionId);
      if (!permission) return false;
      const commitFence = commitDriveAccess(permission.drive_id, 'admin');
      return service.revokePermission(
        permissionId,
        { context: auth, scope, provenance: auditProvenance },
        commitFence,
      );
    },
    checkAccess(driveId, path, level) {
      return canAccess(driveId, level, path);
    },
  };

  const drives: ScopedStorageDriveApi = {
    create: methods.createDrive,
    get: methods.getDrive,
    update: methods.updateDrive,
    list: methods.listDrives,
    delete: methods.deleteDrive,
    usage: methods.getDriveUsage,
    setVisibility: methods.setDriveVisibility,
  };
  const objects: ScopedStorageObjectApi = {
    upload: methods.upload,
    download: methods.download,
    downloadRange: methods.downloadRange,
    get: methods.getFileInfo,
    list: methods.listFolder,
    move: methods.moveObject,
    copy: methods.copyObject,
    delete: methods.deleteObject,
    createFolder: methods.createFolder,
    setVisibility: methods.setVisibility,
    updateMetadata: methods.updateObjectMetadata,
  };
  const permissions: ScopedStoragePermissionApi = {
    grant: methods.grantPermission,
    list: methods.listPermissions,
    get: methods.getPermission,
    revoke: methods.revokePermission,
    checkAccess: methods.checkAccess,
  };
  const uploads: ScopedStorageUploadGrantApi = { create: methods.createUploadGrant };

  let scopedProxy!: ScopedStorageService;
  const attachedStudio = service.getAttachedStudioService();
  const studio: ScopedStorageStudioApi | null = attachedStudio
    ? createScopedStorageStudioApi({
        studio: attachedStudio,
        access,
        scope,
        getUserProperties: getProperties,
        getStorage: () => scopedProxy,
        assertCurrentAuthority,
        assertCurrentAuthoritySync,
      })
    : null;

  scopedProxy = createScopedStorageProxy({
    service,
    methods,
    drives,
    objects,
    permissions,
    uploads,
    studio,
  });
  return scopedProxy;
}
