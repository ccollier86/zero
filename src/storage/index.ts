// ─── Storage Module ──────────────────────────────────────────────────────

// Plugin (server-only)
export { createStoragePlugin, getStorageService } from './storage.plugin';

// Service
export { StorageService, StorageError, defineStorageTables } from './storage-service';
export type {
  StorageDriveApi,
  StorageDriveUpdates,
  StorageObjectApi,
  StoragePermissionApi,
} from './storage-service';

// Adapter
export { LocalStorageAdapter } from './local-adapter';

// Presigned URLs
export { createPresignedToken, verifyPresignedToken } from './presigned';
export type { CreatePresignedOptions, VerifiedPresigned } from './presigned';

// MIME detection
export { detectMimeType } from './mime';

// Types
export type {
  StorageAdapter,
  StoragePluginConfig,
  DriveRecord,
  ObjectRecord,
  BlobRecord,
  FileInfo,
  ObjectType,
  CreateDriveParams,
  UploadOptions,
  PresignedUrlOptions,
  ListOptions,
  ListResult,
  DriveUsage,
  GrantType,
  PermissionLevel,
  PermissionRecord,
  GrantPermissionParams,
} from './types';

export { STORAGE_TABLES } from './types';
