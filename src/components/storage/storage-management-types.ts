/**
 * storage-management-types.ts
 *
 * Shared UI contracts for Zero's storage management organism. This file owns
 * component-facing storage types only; SDK transport and backend storage
 * records stay in the storage package.
 */

import type { Row } from '../../sync/types';
import type { StorageAccessCapabilities } from '../../storage/types';
import type {
  StorageManagementController,
  StorageStudioInspectorSlots,
} from './storage-management-controller';

/** Storage drive row shape consumed by master-detail UI components. */
export interface StorageDriveRow extends Row {
  id: string;
  name: string;
  max_size_bytes: number;
  max_file_size_bytes: number;
  allowed_mime_types: string;
  public: number | string;
  owner_id: string | null;
  access?: StorageAccessCapabilities;
}

/** Top-level storage management view. */
export type { StorageManagementView } from './storage-management-controller';

/** Props for the reusable storage management organism. */
export interface StorageManagementProps {
  /** Optional drive to open directly into the file browser. */
  initialDriveId?: string | null;
  /** Called whenever the selected drive changes. */
  onDriveChange?: (driveId: string | null) => void;
  /**
   * Optional transport-free Studio controller. Omit it to retain the existing
   * hook-backed storage behavior.
   */
  controller?: StorageManagementController;
  /** Optional inspector content for app-specific access, sharing, and jobs. */
  inspectorSlots?: StorageStudioInspectorSlots;
  className?: string;
}
