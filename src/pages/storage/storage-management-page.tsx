'use client';

/**
 * storage-management-page.tsx
 *
 * Compatibility wrapper for the former page-shaped storage export. The actual
 * reusable organism now lives in src/components/storage.
 */

export { StorageManagement as StorageManagementPage } from '../../components/storage';
export type {
  StorageManagementProps as StorageManagementPageProps,
  StorageDriveRow as DriveRow,
} from '../../components/storage';
