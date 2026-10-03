/**
 * storage-studio-scoped-api.ts
 *
 * Projects Storage Studio and object operations into one live Guardian scope
 * for server routes, verified machine principals, and Torrent activities.
 */

import type { RequestAuthorizationAccess } from '../auth/authorization-access';
import type { ServiceDataScope } from '../auth/service-data-scope';
import type { StorageStudioAuthority } from './storage-studio-authority';
import type {
  StorageStudioCapabilities,
  StorageStudioDrive,
  StorageStudioDriveListRequest,
  StorageStudioDrivePage,
  StorageStudioDriveUpdateRequest,
  StorageStudioJobPage,
  StorageStudioLifecycleRequest,
  StorageStudioMutationReceipt,
  StorageStudioProvisionRequest,
} from './storage-studio-contracts';
import type { StorageStudioOwnerChoice } from './storage-studio-ownership';
import type { StorageStudioService } from './storage-studio-service';
import type {
  CreateUploadGrantParams,
  DriveUsage,
  FileInfo,
  GrantPermissionParams,
  ListOptions,
  ListPermissionsOptions,
  ListResult,
  PermissionRecord,
  StorageUploadGrant,
  UploadOptions,
} from './types';

export interface ScopedStorageStudioApi {
  capabilities(): StorageStudioCapabilities;
  readonly drives: ScopedStorageStudioDriveApi;
}

export interface ScopedStorageStudioDriveApi {
  list(request?: StorageStudioDriveListRequest): StorageStudioDrivePage;
  get(driveId: string): ScopedStorageStudioDrive;
  open(key: string, owner?: StorageStudioOwnerChoice): ScopedStorageStudioDrive;
  provision(
    request: StorageStudioProvisionRequest,
  ): StorageStudioMutationReceipt<StorageStudioDrive>;
  update(
    driveId: string,
    request: StorageStudioDriveUpdateRequest,
  ): StorageStudioMutationReceipt<StorageStudioDrive>;
  lifecycle(
    driveId: string,
    request: StorageStudioLifecycleRequest,
  ): Promise<StorageStudioMutationReceipt<StorageStudioDrive>>;
  jobs(
    driveId: string,
    input?: { readonly cursor?: string; readonly limit?: number },
  ): StorageStudioJobPage;
}

export interface ScopedStorageStudioDrive {
  readonly catalog: StorageStudioDrive;
  usage(): DriveUsage;
  readonly objects: ScopedStorageStudioObjectApi;
  readonly permissions: ScopedStorageStudioPermissionApi;
  createUploadGrant(params: CreateUploadGrantParams): Promise<StorageUploadGrant>;
}

export interface ScopedStorageStudioObjectApi {
  upload(
    path: string,
    data: ReadableStream<Uint8Array> | Uint8Array | Blob,
    options?: UploadOptions & { readonly fileName?: string },
  ): Promise<FileInfo>;
  download(
    path: string,
  ): Promise<{ stream: ReadableStream<Uint8Array>; info: FileInfo } | null>;
  downloadRange(
    path: string,
    start: number,
    end: number,
  ): Promise<{ stream: ReadableStream<Uint8Array>; info: FileInfo } | null>;
  get(path: string): FileInfo | null;
  list(parentPath?: string, options?: ListOptions): ListResult;
  move(fromPath: string, toPath: string): Promise<FileInfo>;
  copy(fromPath: string, toPath: string): Promise<FileInfo>;
  delete(path: string): Promise<boolean>;
  createFolder(path: string, isPublic?: boolean): FileInfo;
  setVisibility(path: string, isPublic: boolean): FileInfo;
  updateMetadata(path: string, metadata: Record<string, unknown>): FileInfo;
}

export interface ScopedStorageStudioPermissionApi {
  grant(params: GrantPermissionParams): PermissionRecord;
  list(options?: ListPermissionsOptions): PermissionRecord[];
  revoke(permissionId: string): boolean;
}

export interface CreateScopedStorageStudioApiOptions {
  readonly studio: StorageStudioService;
  readonly access: RequestAuthorizationAccess;
  readonly scope: ServiceDataScope;
  readonly getUserProperties: () => Record<string, string>;
  readonly getStorage: () => StorageStudioScopedStorage;
  readonly assertCurrentAuthority: () => Promise<void>;
  readonly assertCurrentAuthoritySync: () => void;
}

/** Narrow, already scope/actor-sealed storage port consumed by Studio views. */
export interface StorageStudioScopedStorage {
  upload(
    driveId: string,
    path: string,
    data: ReadableStream<Uint8Array> | Uint8Array | Blob,
    fileName: string,
    options?: UploadOptions,
  ): Promise<FileInfo>;
  download(
    driveId: string,
    path: string,
  ): Promise<{ stream: ReadableStream<Uint8Array>; info: FileInfo } | null>;
  downloadRange(
    driveId: string,
    path: string,
    start: number,
    end: number,
  ): Promise<{ stream: ReadableStream<Uint8Array>; info: FileInfo } | null>;
  getFileInfo(driveId: string, path: string): FileInfo | null;
  listFolder(driveId: string, parentPath?: string, options?: ListOptions): ListResult;
  moveObject(driveId: string, fromPath: string, toPath: string): Promise<FileInfo>;
  copyObject(driveId: string, fromPath: string, toPath: string): Promise<FileInfo>;
  deleteObject(driveId: string, path: string): Promise<boolean>;
  createFolder(driveId: string, path: string, isPublic?: boolean): FileInfo;
  setVisibility(driveId: string, path: string, isPublic: boolean): FileInfo;
  updateObjectMetadata(
    driveId: string,
    path: string,
    metadata: Record<string, unknown>,
  ): FileInfo;
  grantPermission(driveId: string, params: GrantPermissionParams): PermissionRecord;
  listPermissions(driveId: string, options?: ListPermissionsOptions): PermissionRecord[];
  getPermission(permissionId: string): PermissionRecord | null;
  revokePermission(permissionId: string): boolean;
  getDriveUsage(driveId: string): DriveUsage;
  createUploadGrant(
    driveId: string,
    params: CreateUploadGrantParams,
  ): Promise<StorageUploadGrant>;
}

/** Create one fail-closed Studio surface with no caller-supplied scope IDs. */
export function createScopedStorageStudioApi(
  options: CreateScopedStorageStudioApiOptions,
): ScopedStorageStudioApi {
  const authority = (): StorageStudioAuthority => {
    options.assertCurrentAuthoritySync();
    options.access.authorize({
      user: 'required',
      credentials: ['session', 'api-key'],
    });
    return options.studio.resolveAuthority(options.access, options.scope);
  };
  const properties = () => ({ ...options.getUserProperties() });
  const bind = (drive: StorageStudioDrive): ScopedStorageStudioDrive => (
    bindScopedDrive(drive, options, authority)
  );

  const drivesImplementation: ScopedStorageStudioDriveApi = {
    list(request = {}) {
      return options.studio.listDrives(authority(), properties(), request);
    },
    get(driveId) {
      return bind(options.studio.getDrive(authority(), properties(), driveId));
    },
    open(key, owner = 'organization') {
      return bind(options.studio.getDriveByKey(authority(), properties(), key, owner));
    },
    provision(request) {
      return options.studio.provisionDrive(
        authority(), properties(), request, options.assertCurrentAuthoritySync,
      );
    },
    update(driveId, request) {
      return options.studio.updateDrive(
        authority(), properties(), driveId, request, options.assertCurrentAuthoritySync,
      );
    },
    async lifecycle(driveId, request) {
      await options.assertCurrentAuthority();
      const result = await options.studio.changeDriveLifecycle(
        authority(),
        properties(),
        driveId,
        request,
        options.assertCurrentAuthoritySync,
      );
      return result;
    },
    jobs(driveId, input = {}) {
      return options.studio.listDriveJobs(authority(), properties(), driveId, input);
    },
  };
  const drives = Object.freeze(drivesImplementation);

  return Object.freeze({
    capabilities: () => options.studio.capabilities(authority()),
    drives,
  });
}

function bindScopedDrive(
  catalog: StorageStudioDrive,
  options: CreateScopedStorageStudioApiOptions,
  authority: () => StorageStudioAuthority,
): ScopedStorageStudioDrive {
  const driveId = catalog.drive.drive_id;
  const storage = () => options.getStorage();
  const objectsImplementation: ScopedStorageStudioObjectApi = {
    async upload(path, data, uploadOptions = {}) {
      authority();
      await options.assertCurrentAuthority();
      const { fileName = fileNameFromPath(path), ...objectOptions } = uploadOptions;
      return storage().upload(
        driveId,
        path,
        data,
        fileName,
        objectOptions,
      );
    },
    async download(path) {
      authority();
      await options.assertCurrentAuthority();
      const result = await storage().download(driveId, path);
      await options.assertCurrentAuthority();
      return result;
    },
    async downloadRange(path, start, end) {
      authority();
      await options.assertCurrentAuthority();
      const result = await storage().downloadRange(driveId, path, start, end);
      await options.assertCurrentAuthority();
      return result;
    },
    get(path) {
      authority();
      return storage().getFileInfo(driveId, path);
    },
    list(parentPath, listOptions) {
      authority();
      return storage().listFolder(driveId, parentPath, listOptions);
    },
    async move(fromPath, toPath) {
      authority();
      await options.assertCurrentAuthority();
      return storage().moveObject(
        driveId,
        fromPath,
        toPath,
      );
    },
    async copy(fromPath, toPath) {
      authority();
      await options.assertCurrentAuthority();
      return storage().copyObject(
        driveId,
        fromPath,
        toPath,
      );
    },
    async delete(path) {
      authority();
      await options.assertCurrentAuthority();
      return storage().deleteObject(
        driveId,
        path,
      );
    },
    createFolder(path, isPublic = false) {
      authority();
      return storage().createFolder(driveId, path, isPublic);
    },
    setVisibility(path, isPublic) {
      authority();
      return storage().setVisibility(driveId, path, isPublic);
    },
    updateMetadata(path, metadata) {
      authority();
      return storage().updateObjectMetadata(driveId, path, metadata);
    },
  };
  const objects = Object.freeze(objectsImplementation);
  const permissionsImplementation: ScopedStorageStudioPermissionApi = {
    grant(params) {
      authority();
      return storage().grantPermission(driveId, params);
    },
    list(listOptions) {
      authority();
      return storage().listPermissions(driveId, listOptions);
    },
    revoke(permissionId) {
      authority();
      const permission = storage().getPermission(permissionId);
      if (!permission || permission.drive_id !== driveId) return false;
      return storage().revokePermission(permissionId);
    },
  };
  const permissions = Object.freeze(permissionsImplementation);
  const boundDrive: ScopedStorageStudioDrive = {
    catalog,
    usage() {
      authority();
      return storage().getDriveUsage(driveId);
    },
    objects,
    permissions,
    async createUploadGrant(params) {
      authority();
      await options.assertCurrentAuthority();
      const result = await storage().createUploadGrant(driveId, params);
      await options.assertCurrentAuthority();
      return result;
    },
  };
  return Object.freeze(boundDrive);
}

function fileNameFromPath(path: string): string {
  const name = path.split('/').filter(Boolean).at(-1);
  return name || 'upload';
}
