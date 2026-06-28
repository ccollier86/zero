/**
 * storage-management-types.ts
 *
 * Shared UI contracts for Zero's storage management organism. This file owns
 * component-facing storage types only; SDK transport and backend storage
 * records stay in the storage package.
 */

import type { Row } from '../../sync/types';

/** Storage drive row shape consumed by master-detail UI components. */
export interface StorageDriveRow extends Row {
  id: string;
  name: string;
  max_size_bytes: number;
  max_file_size_bytes: number;
  allowed_mime_types: string;
  public: number | string;
  owner_id: string | null;
}

/** Top-level storage management view. */
export type StorageManagementView = 'drives' | 'files';

/** Props for the reusable storage management organism. */
export interface StorageManagementProps {
  /** Optional drive to open directly into the file browser. */
  initialDriveId?: string | null;
  /** Called whenever the selected drive changes. */
  onDriveChange?: (driveId: string | null) => void;
  className?: string;
}
