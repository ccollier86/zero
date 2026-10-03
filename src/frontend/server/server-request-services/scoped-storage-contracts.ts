import type { ScopedStorageStudioApi } from '../../../storage/storage-studio-scoped-api';
import type { StorageDriveUpdates } from '../../../storage/storage-service';
import type {
  CreateDriveParams,
  CreateUploadGrantParams,
  DriveRecord,
  DriveUsage,
  FileInfo,
  GrantPermissionParams,
  ListOptions,
  ListPermissionsOptions,
  ListResult,
  PermissionLevel,
  PermissionRecord,
  StorageUploadGrant,
  UploadOptions,
} from '../../../storage/types';

export type ScopedStorageUploadData =
  | ReadableStream<Uint8Array>
  | Uint8Array
  | Blob;

/** Drive operations with owner and tenant authority sealed by the facade. */
export interface ScopedStorageDriveApi {
  create(params: CreateDriveParams): DriveRecord;
  get(driveId: string): DriveRecord | null;
  update(driveId: string, updates: StorageDriveUpdates): DriveRecord;
  list(): DriveRecord[];
  delete(driveId: string): boolean;
  usage(driveId: string): DriveUsage;
  setVisibility(driveId: string, isPublic: boolean): DriveRecord;
}

/** Object operations with actor, scope, and commit fences sealed by the facade. */
export interface ScopedStorageObjectApi {
  upload(
    driveId: string,
    path: string,
    data: ScopedStorageUploadData,
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
  get(driveId: string, path: string): FileInfo | null;
  list(driveId: string, parentPath?: string, options?: ListOptions): ListResult;
  move(driveId: string, fromPath: string, toPath: string): Promise<FileInfo>;
  copy(driveId: string, fromPath: string, toPath: string): Promise<FileInfo>;
  delete(driveId: string, path: string): Promise<boolean>;
  createFolder(driveId: string, path: string, isPublic?: boolean): FileInfo;
  setVisibility(driveId: string, path: string, isPublic: boolean): FileInfo;
  updateMetadata(
    driveId: string,
    path: string,
    metadata: Record<string, unknown>,
  ): FileInfo;
}

/** ACL operations with principal attributes derived from Guardian authority. */
export interface ScopedStoragePermissionApi {
  grant(driveId: string, params: GrantPermissionParams): PermissionRecord;
  list(driveId: string, options?: ListPermissionsOptions): PermissionRecord[];
  get(permissionId: string): PermissionRecord | null;
  revoke(permissionId: string): boolean;
  checkAccess(
    driveId: string,
    path: string | null,
    requiredLevel: PermissionLevel,
  ): boolean;
}

export interface ScopedStorageUploadGrantApi {
  create(
    driveId: string,
    params: CreateUploadGrantParams,
  ): Promise<StorageUploadGrant>;
}

/** Exact top-level Storage surface exposed to requests and durable work. */
export interface ScopedStorageMethods {
  createDrive(params: CreateDriveParams): DriveRecord;
  getDrive(driveId: string): DriveRecord | null;
  updateDrive(driveId: string, updates: StorageDriveUpdates): DriveRecord;
  listDrives(): DriveRecord[];
  deleteDrive(driveId: string): boolean;
  getDriveUsage(driveId: string): DriveUsage;
  upload(
    driveId: string,
    path: string,
    data: ScopedStorageUploadData,
    fileName: string,
    options?: UploadOptions,
  ): Promise<FileInfo>;
  createUploadGrant(
    driveId: string,
    params: CreateUploadGrantParams,
  ): Promise<StorageUploadGrant>;
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
  setDriveVisibility(driveId: string, isPublic: boolean): DriveRecord;
  grantPermission(driveId: string, params: GrantPermissionParams): PermissionRecord;
  listPermissions(driveId: string, options?: ListPermissionsOptions): PermissionRecord[];
  getPermission(permissionId: string): PermissionRecord | null;
  revokePermission(permissionId: string): boolean;
  checkAccess(
    driveId: string,
    path: string | null,
    requiredLevel: PermissionLevel,
  ): boolean;
}

export interface ScopedStorageService extends ScopedStorageMethods {
  readonly drives: ScopedStorageDriveApi;
  readonly objects: ScopedStorageObjectApi;
  readonly permissions: ScopedStoragePermissionApi;
  readonly uploads: ScopedStorageUploadGrantApi;
  readonly studio: ScopedStorageStudioApi | null;
}
