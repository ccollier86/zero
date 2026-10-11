/** Storage hooks, capabilities and client-safe contracts. Curated client-safe re-exports only; implementation/context ownership stays with the existing modules. */

// ─── Storage: Hooks ─────────────────────────────────────────────────────
export {
  useUpload,
  useStorageFolder,
  useStorageDrives,
  useDriveCapabilities,
  useDriveUsage,
  useStoragePermissions,
  usePresignedUrl,
  useStorageActions,
} from '../../../storage/storage-hooks';
export type {
  UploadState,
  UseUploadReturn,
  UploadFileOptions,
  UseStorageFolderReturn,
  UseStorageDrivesReturn,
  UseDriveCapabilitiesReturn,
  UseDriveUsageReturn,
  UseStoragePermissionsReturn,
  UsePresignedUrlReturn,
  StorageActions,
} from '../../../storage/storage-hooks';
export { useUploadQueue } from '../../../storage/upload-queue-hooks';
export type {
  UploadQueueFilesOptions,
  UploadQueueItem,
  UploadQueueItemStatus,
  UseUploadQueueReturn,
} from '../../../storage/upload-queue-hooks';
export { useStorageFile } from '../../../storage/storage-file-hooks';
export type { UseStorageFileReturn } from '../../../storage/storage-file-hooks';
export { useUploadDropzone } from '../../../storage/upload-dropzone-hooks';
export type {
  UseUploadDropzoneOptions,
  UseUploadDropzoneReturn,
} from '../../../storage/upload-dropzone-hooks';
export {
  useDriveQuota,
  useStorageBrowser,
} from '../../../storage/storage-browser-hooks';
export type {
  StorageBrowserActions,
  UseDriveQuotaReturn,
  UseStorageBrowserReturn,
} from '../../../storage/storage-browser-hooks';

// ─── Storage: Types (client-safe) ───────────────────────────────────────
export { STORAGE_TABLES } from '../../../storage/types';
export type {
  FileInfo,
  DriveRecord,
  DriveRecordWithAccess,
  DriveUsage,
  ObjectType,
  CreateDriveParams,
  CreateUploadGrantParams,
  GrantPermissionParams,
  UploadOptions,
  StorageAccessCapabilities,
  StorageUploadGrant,
  PermissionRecord,
  ListOptions,
  ListPermissionsOptions,
  ListResult,
  GrantType,
  PermissionLevel,
} from '../../../storage/types';
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
} from '../../../storage/storage-studio-contracts';
