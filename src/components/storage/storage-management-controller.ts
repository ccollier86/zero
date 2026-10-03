/**
 * storage-management-controller.ts
 *
 * Transport-free contracts for the adaptive Storage Studio control plane.
 * Applications can provide these values from Zero hooks, server state, or a
 * test fixture without coupling the presentation layer to HTTP.
 */

import type {
  StorageStudioCapabilities,
  StorageStudioDrive,
} from '../../storage/storage-studio-contracts';
import type {
  DriveUsage,
  FileInfo,
  ListOptions,
  StorageAccessCapabilities,
} from '../../storage/types';
import type { ReactNode } from 'react';

export type StorageManagementView = 'drives' | 'files';
export type StorageStudioOwnerFilter = 'all' | 'organization' | 'personal';
export type StorageStudioLifecycleFilter =
  | 'all'
  | StorageStudioDrive['profile']['lifecycle'];

export interface StorageStudioBreadcrumb {
  readonly label: string;
  /** `null` identifies the drive root. */
  readonly path: string | null;
}

export interface StorageStudioJobView {
  readonly id: string;
  readonly label: string;
  readonly status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  readonly progress?: number;
  readonly detail?: string | null;
  readonly createdAt?: number;
  readonly updatedAt?: number;
}

export interface StorageStudioFilters {
  readonly search: string;
  readonly owner: StorageStudioOwnerFilter;
  readonly lifecycle: StorageStudioLifecycleFilter;
  readonly objectType: NonNullable<ListOptions['type']>;
  readonly sortBy: NonNullable<ListOptions['sortBy']>;
  readonly sortDir: NonNullable<ListOptions['sortDir']>;
}

/** Cursor-page navigation projected without exposing opaque server cursors. */
export interface StorageStudioPagination {
  readonly page: number;
  readonly count: number;
  readonly total?: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
}

/**
 * Optional mutations exposed by the controller. The workspace never performs
 * network requests directly; absent operations are omitted from its actions.
 */
export interface StorageStudioOperations {
  readonly createDrive?: () => void | Promise<void>;
  readonly upload?: () => void | Promise<void>;
  readonly createFolder?: () => void | Promise<void>;
  readonly download?: (file: FileInfo) => void | Promise<void>;
  readonly renameDrive?: (
    drive: StorageStudioDrive,
    name: string,
  ) => void | Promise<void>;
  readonly renameFile?: (file: FileInfo, name: string) => void | Promise<void>;
  readonly updateFileMetadata?: (
    file: FileInfo,
    metadata: Readonly<Record<string, unknown>>,
  ) => void | Promise<void>;
  readonly move?: (file: FileInfo) => void | Promise<void>;
  readonly copy?: (file: FileInfo) => void | Promise<void>;
  readonly share?: (file: FileInfo) => void | Promise<void>;
  readonly setFileVisibility?: (
    file: FileInfo,
    isPublic: boolean,
  ) => void | Promise<void>;
  readonly suspend?: (drive: StorageStudioDrive) => void | Promise<void>;
  readonly restore?: (drive: StorageStudioDrive) => void | Promise<void>;
  readonly deleteDrive?: (drive: StorageStudioDrive) => void | Promise<void>;
  readonly deleteFile?: (file: FileInfo) => void | Promise<void>;
}

export interface StorageManagementController {
  readonly status: 'loading' | 'ready' | 'disabled' | 'error';
  readonly capabilities: StorageStudioCapabilities | null;
  readonly view: StorageManagementView;
  readonly drives: readonly StorageStudioDrive[];
  readonly files: readonly FileInfo[];
  readonly selectedDrive: StorageStudioDrive | null;
  readonly selectedFile: FileInfo | null;
  /** Effective access for the open folder; omitted by legacy controllers. */
  readonly currentPathAccess?: StorageAccessCapabilities | null;
  readonly selectedFileAccess: StorageAccessCapabilities | null;
  readonly currentPath: string | null;
  readonly breadcrumbs: readonly StorageStudioBreadcrumb[];
  readonly usage: DriveUsage | null;
  readonly jobs: readonly StorageStudioJobView[];
  readonly filters: StorageStudioFilters;
  /** Current drive-catalog page. Omitted by legacy/custom controllers. */
  readonly drivePagination?: StorageStudioPagination;
  /** Current folder page. Omitted by legacy/custom controllers. */
  readonly filePagination?: StorageStudioPagination;
  readonly busy?: boolean;
  readonly loading?: boolean;
  readonly error?: string | null;

  readonly setSearch: (value: string) => void;
  readonly setOwnerFilter: (value: StorageStudioOwnerFilter) => void;
  readonly setLifecycleFilter: (value: StorageStudioLifecycleFilter) => void;
  readonly setObjectTypeFilter: (value: NonNullable<ListOptions['type']>) => void;
  readonly setSortBy: (value: NonNullable<ListOptions['sortBy']>) => void;
  readonly setSortDir: (value: NonNullable<ListOptions['sortDir']>) => void;
  readonly selectDrive: (driveId: string | null) => void;
  readonly openDrive: (driveId: string) => void;
  readonly selectFile: (file: FileInfo | null) => void;
  readonly openFolder: (path: string) => void;
  readonly openBreadcrumb: (path: string | null) => void;
  readonly showDriveCatalog: () => void;
  readonly refresh: () => void;
  readonly previousDrivePage?: () => void;
  readonly nextDrivePage?: () => void;
  readonly previousFilePage?: () => void;
  readonly nextFilePage?: () => void;
  readonly operations: StorageStudioOperations;
}

/** Optional inspector extensions supplied by an integration controller. */
export interface StorageStudioInspectorSlots {
  readonly driveAccess?: (drive: StorageStudioDrive) => ReactNode;
  readonly driveSettings?: (drive: StorageStudioDrive) => ReactNode;
  readonly driveUsage?: (
    drive: StorageStudioDrive,
    usage: DriveUsage | null,
  ) => ReactNode;
  readonly driveJobs?: (
    drive: StorageStudioDrive,
    jobs: readonly StorageStudioJobView[],
  ) => ReactNode;
  readonly filePreview?: (file: FileInfo) => ReactNode;
  readonly fileAccess?: (file: FileInfo) => ReactNode;
  readonly fileSharing?: (file: FileInfo) => ReactNode;
}
