import type { RequestAuthorizationAccess } from '../../../auth/authorization-access';
import { effectiveServiceDataRoles } from '../../../auth/service-data-authority';
import {
  serviceDataScopeMatchesTenant,
  type ServiceDataScope,
} from '../../../auth/service-data-scope';
import {
  StorageError,
  type StorageActorRoles,
  type StorageDriveApi,
  type StorageObjectApi,
  type StoragePermissionApi,
  type StorageService,
  type StorageUploadGrantApi,
} from '../../../storage/storage-service';
import type { DriveRecord, PermissionLevel } from '../../../storage/types';
import type { CompleteServiceMemberInventory } from './restricted-service-proxy';

type ScopedStorageMethods = Pick<
  StorageService,
  | 'createDrive'
  | 'getDrive'
  | 'getDriveForScope'
  | 'updateDrive'
  | 'listDrives'
  | 'listDrivesForUser'
  | 'deleteDrive'
  | 'getDriveUsage'
  | 'upload'
  | 'createUploadGrant'
  | 'download'
  | 'downloadRange'
  | 'getFileInfo'
  | 'listFolder'
  | 'moveObject'
  | 'copyObject'
  | 'deleteObject'
  | 'createFolder'
  | 'setVisibility'
  | 'setDriveVisibility'
  | 'grantPermission'
  | 'listPermissions'
  | 'getPermission'
  | 'revokePermission'
  | 'checkAccess'
>;

type ScopedStorageMembers = keyof ScopedStorageMethods
  | 'drives'
  | 'objects'
  | 'permissions'
  | 'uploads';

const STORAGE_SERVICE_INVENTORY: CompleteServiceMemberInventory<
  StorageService,
  ScopedStorageMembers,
  never
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
): StorageService {
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
    const drive = service.getDriveForScope(driveId, scope);
    if (!drive) throw new StorageError(404, 'Drive not found');
    if (!canAccess(driveId, level, path)) throw new StorageError(403, 'Forbidden');
    return drive;
  };

  const requireActor = (userId: string | null): void => {
    if (auth && userId !== null && userId !== auth.userId) {
      throw new StorageError(403, 'Storage actor must match the authenticated user');
    }
  };

  const listVisibleDrives = (): DriveRecord[] => service.listDrives()
    .filter((drive) => serviceDataScopeMatchesTenant(scope, drive.tenant_id))
    .filter((drive) => canAccess(drive.drive_id, 'read'));

  const methods: ScopedStorageMethods = {
    createDrive(ownerId, params) {
      requireActor(ownerId);
      assertCurrentAuthoritySync();
      return service.createDrive(ownerId, params, scope);
    },
    getDrive(driveId) {
      const drive = service.getDriveForScope(driveId, scope);
      return drive && canAccess(driveId, 'read') ? drive : null;
    },
    getDriveForScope(driveId) {
      const drive = service.getDriveForScope(driveId, scope);
      return drive && canAccess(driveId, 'read') ? drive : null;
    },
    updateDrive(driveId, updates) {
      requireDrive(driveId, 'admin');
      assertCurrentAuthoritySync();
      return service.updateDrive(driveId, updates);
    },
    listDrives() {
      return listVisibleDrives();
    },
    listDrivesForUser(userId) {
      requireActor(userId);
      return listVisibleDrives();
    },
    deleteDrive(driveId) {
      requireDrive(driveId, 'admin');
      assertCurrentAuthoritySync();
      return service.deleteDrive(driveId);
    },
    getDriveUsage(driveId) {
      requireDrive(driveId, 'read');
      return service.getDriveUsage(driveId);
    },
    async upload(driveId, path, data, fileName, userId, options) {
      requireActor(userId);
      requireDrive(driveId, 'write', path);
      await assertCurrentAuthority();
      const result = await service.upload(
        driveId,
        path,
        data,
        fileName,
        userId,
        options,
        scope,
        assertCurrentAuthority,
      );
      await assertCurrentAuthority();
      return result;
    },
    async createUploadGrant(driveId, params) {
      requireDrive(driveId, 'write', params.path);
      await assertCurrentAuthority();
      const result = await service.createUploadGrant(driveId, params);
      await assertCurrentAuthority();
      return result;
    },
    async download(driveId, path) {
      requireDrive(driveId, 'read', path);
      await assertCurrentAuthority();
      const result = await service.download(driveId, path);
      await assertCurrentAuthority();
      return result;
    },
    async downloadRange(driveId, path, start, end) {
      requireDrive(driveId, 'read', path);
      await assertCurrentAuthority();
      const result = await service.downloadRange(driveId, path, start, end);
      await assertCurrentAuthority();
      return result;
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
      await assertCurrentAuthority();
      const result = await service.moveObject(driveId, fromPath, toPath);
      await assertCurrentAuthority();
      return result;
    },
    async copyObject(driveId, fromPath, toPath) {
      requireDrive(driveId, 'write', fromPath);
      await assertCurrentAuthority();
      const result = await service.copyObject(driveId, fromPath, toPath);
      await assertCurrentAuthority();
      return result;
    },
    async deleteObject(driveId, path) {
      requireDrive(driveId, 'write', path);
      await assertCurrentAuthority();
      const result = await service.deleteObject(driveId, path);
      await assertCurrentAuthority();
      return result;
    },
    createFolder(driveId, path, userId, isPublic) {
      requireActor(userId);
      requireDrive(driveId, 'write', path);
      assertCurrentAuthoritySync();
      return service.createFolder(driveId, path, userId, isPublic);
    },
    setVisibility(driveId, path, isPublic) {
      requireDrive(driveId, 'admin', path);
      assertCurrentAuthoritySync();
      return service.setVisibility(driveId, path, isPublic);
    },
    setDriveVisibility(driveId, isPublic) {
      requireDrive(driveId, 'admin');
      assertCurrentAuthoritySync();
      return service.setDriveVisibility(driveId, isPublic);
    },
    grantPermission(driveId, params) {
      requireDrive(driveId, 'admin', params.objectPath ?? null);
      assertCurrentAuthoritySync();
      return service.grantPermission(driveId, params);
    },
    listPermissions(driveId, options) {
      requireDrive(driveId, 'admin', options?.objectPath ?? null);
      return service.listPermissions(driveId, options);
    },
    getPermission(permissionId) {
      const permission = service.getPermission(permissionId);
      if (!permission || !serviceDataScopeMatchesTenant(scope, permission.tenant_id)) return null;
      requireDrive(permission.drive_id, 'admin');
      return permission;
    },
    revokePermission(permissionId) {
      const permission = methods.getPermission(permissionId);
      if (!permission) return false;
      assertCurrentAuthoritySync();
      return service.revokePermission(permissionId);
    },
    checkAccess(driveId, path, _userId, _userRole, _properties, level) {
      return canAccess(driveId, level, path);
    },
  };

  const drives: StorageDriveApi = {
    create: methods.createDrive,
    get: methods.getDrive,
    update: methods.updateDrive,
    list: methods.listDrives,
    listForUser: methods.listDrivesForUser,
    delete: methods.deleteDrive,
    usage: methods.getDriveUsage,
    setVisibility: methods.setDriveVisibility,
  };
  const objects: StorageObjectApi = {
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
  };
  const permissions: StoragePermissionApi = {
    grant: methods.grantPermission,
    list: methods.listPermissions,
    get: methods.getPermission,
    revoke: methods.revokePermission,
    checkAccess: methods.checkAccess,
  };
  const uploads: StorageUploadGrantApi = { create: methods.createUploadGrant };

  return new Proxy(service, {
    get(target, property) {
      if (property === 'drives') return drives;
      if (property === 'objects') return objects;
      if (property === 'permissions') return permissions;
      if (property === 'uploads') return uploads;
      if (typeof property === 'string' && Object.hasOwn(methods, property)) {
        return Reflect.get(methods, property, methods);
      }
      if (typeof property === 'string') {
        throw new Error(
          `[server-services] Storage member "${property}" is not available through the request-scoped facade; use zero.unsafe.storage for deliberate privileged access.`,
        );
      }
      return Reflect.get(target, property, target);
    },
    has(_target, property) {
      return typeof property === 'string'
        && (Object.hasOwn(methods, property)
          || property === 'drives'
          || property === 'objects'
          || property === 'permissions'
          || property === 'uploads');
    },
    ownKeys() {
      return ['drives', 'objects', 'permissions', 'uploads', ...Object.keys(methods)];
    },
    getOwnPropertyDescriptor(_target, property) {
      if (typeof property !== 'string') return undefined;
      const visible = Object.hasOwn(methods, property)
        || property === 'drives'
        || property === 'objects'
        || property === 'permissions'
        || property === 'uploads';
      return visible ? { configurable: true, enumerable: true } : undefined;
    },
  });
}
