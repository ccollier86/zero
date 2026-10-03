// ─── Storage Module ──────────────────────────────────────────────────────

// Plugin (server-only)
export { createStoragePlugin, getStorageService } from './storage.plugin';

// Service
export { StorageService, StorageError, defineStorageTables } from './storage-service';
export type {
  CreateDriveRecordInput,
  StorageActorRoles,
  StorageDriveApi,
  StorageDriveUpdates,
  StorageObjectApi,
  StoragePermissionApi,
  StorageServiceOptions,
  StorageUploadGrantApi,
} from './storage-service';

// Adapter
export { LocalStorageAdapter } from './local-adapter';

// Presigned URLs
export { createPresignedToken, verifyPresignedToken } from './presigned';
export type { CreatePresignedOptions, VerifiedPresigned } from './presigned';

// Upload grants
export { createUploadGrantToken, verifyUploadGrantToken } from './upload-grant';
export type { CreateUploadGrantTokenOptions, VerifiedUploadGrant } from './upload-grant';

// MIME detection
export { detectMimeType } from './mime';

// Types
export type {
  StorageAdapter,
  StorageAdapterOperationOptions,
  StorageBlobWriteResult,
  StoragePendingBlobPublication,
  StoragePluginConfig,
  DriveRecord,
  ObjectRecord,
  BlobRecord,
  FileInfo,
  ObjectType,
  CreateDriveParams,
  UploadOptions,
  PresignedUrlOptions,
  CreateUploadGrantParams,
  StorageUploadGrant,
  StorageUploadGrantResource,
  ListOptions,
  ListResult,
  DriveUsage,
  GrantType,
  PermissionLevel,
  PermissionRecord,
  GrantPermissionParams,
} from './types';

export { STORAGE_TABLES } from './types';

// Storage Studio foundation
export {
  resolveAppStorageConfig,
  resolveStorageStudioConfig,
} from './storage-config';
export type {
  AppStorageConfig,
  ResolvedAppStorageConfig,
  ResolvedStorageStudioConfig,
  ResolvedStorageStudioLimits,
  ResolvedStorageStudioPublicAccess,
  StorageStudioConfig,
  StorageStudioDefaultGrantConfig,
  StorageStudioIsolation,
  StorageStudioLimitsConfig,
  StorageStudioPublicAccessConfig,
} from './storage-config';
export {
  STORAGE_CATALOG_READ_PERMISSION,
  STORAGE_DRIVES_DELETE_PERMISSION,
  STORAGE_DRIVES_MANAGE_PERMISSION,
  STORAGE_DRIVES_PROVISION_PERMISSION,
  STORAGE_PERSONAL_DRIVES_PROVISION_PERMISSION,
  STORAGE_STUDIO_ADMIN_ROLE_FRAGMENT,
  STORAGE_STUDIO_MANAGER_ROLE_FRAGMENT,
  STORAGE_STUDIO_PERMISSION_REGISTRY,
  STORAGE_STUDIO_PERSONAL_ROLE_FRAGMENT,
  STORAGE_STUDIO_PROVISIONER_ROLE_FRAGMENT,
  STORAGE_STUDIO_ROLE_FRAGMENTS,
  STORAGE_STUDIO_VIEWER_ROLE_FRAGMENT,
  hasStorageStudioPermission,
} from './storage-studio-access';
export {
  resolveStorageStudioOwnership,
} from './storage-studio-ownership';
export type {
  StorageStudioOwnerChoice,
  StorageStudioOwnerKind,
  StorageStudioOwnership,
  StorageStudioOwnershipInput,
  StorageStudioScopeKind,
} from './storage-studio-ownership';
export { storageStudioCapabilityPolicy } from './storage-studio-contracts';
export type {
  StorageStudioCapabilities,
  StorageStudioControlCapabilities,
  StorageStudioDrive,
  StorageStudioDriveListRequest,
  StorageStudioDrivePage,
  StorageStudioDriveProfileView,
  StorageStudioDriveUpdateRequest,
  StorageStudioJobPage,
  StorageStudioJobView,
  StorageStudioLifecycleRequest,
  StorageStudioMutationReceipt,
  StorageStudioProvisionRequest,
} from './storage-studio-contracts';
export { StorageStudioService } from './storage-studio-service';
export type {
  ScopedStorageStudioApi,
  ScopedStorageStudioDrive,
  ScopedStorageStudioDriveApi,
  ScopedStorageStudioObjectApi,
  ScopedStorageStudioPermissionApi,
} from './storage-studio-scoped-api';
export {
  STORAGE_DRIVE_PROFILES_TABLE,
  STORAGE_JOBS_TABLE,
  STORAGE_QUOTA_RESERVATIONS_TABLE,
  STORAGE_STUDIO_OPERATIONS_TABLE,
  defineStorageStudioTables,
} from './storage-studio-schema';
export type {
  StorageJobStatus,
  StorageQuotaReservationStatus,
  StorageStudioDriveLifecycle,
  StorageStudioDriveProfile,
  StorageStudioOperationKind,
  StorageStudioOperationStatus,
  StorageStudioSchemaDatabase,
} from './storage-studio-schema';
export {
  STORAGE_ERROR_CODES,
  StorageDomainError,
  isStorageDomainError,
  isStorageErrorCode,
  normalizeStorageError,
} from './storage-domain-error';
export type {
  StorageDomainErrorOptions,
  StorageErrorCode,
  StorageErrorDetails,
  StorageErrorDetailValue,
  StorageOperationOutcome,
} from './storage-domain-error';
export { toStorageHttpFailure } from './storage-http-error';
export type {
  StorageHttpFailure,
  StorageHttpOperation,
} from './storage-http-error';
