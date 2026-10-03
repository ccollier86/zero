'use client';

/**
 * use-storage-studio-management.tsx
 *
 * Composes focused Studio catalog, object, lifecycle, job, and upload hooks
 * into the transport-free StorageManagementController consumed by the UI.
 * HTTP contracts and presentation remain in their dedicated modules.
 */

import * as React from 'react';
import { toast } from 'sonner';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import { shouldUseSsrFallback, useClientMaybe } from '../../frontend/client/client-context';
import {
  useDriveCapabilities,
  useDriveUsage,
  useStorageFolder,
} from '../../storage/storage-hooks';
import { useUploadDropzone } from '../../storage/upload-dropzone-hooks';
import type { FileInfo, ListOptions } from '../../storage/types';
import type {
  StorageManagementController,
  StorageManagementView,
  StorageStudioInspectorSlots,
  StorageStudioLifecycleFilter,
  StorageStudioOwnerFilter,
} from './storage-management-controller';
import {
  storageStudioBreadcrumbs,
  storageStudioCatalogFilter,
} from './storage-studio-controller-values';
import { bindStorageStudioScope } from './storage-studio-scope-binding';
import {
  bindStorageStudioValue,
  readStorageStudioValue,
  type StorageStudioScopedValue,
} from './storage-studio-scoped-value';
import { useStorageStudioCatalog } from './use-storage-studio-catalog';
import { useStorageStudioInspectorSlots } from './use-storage-studio-inspector-slots';
import { useStorageStudioJobs } from './use-storage-studio-jobs';
import { useStorageStudioOperations } from './use-storage-studio-operations';
import { useSelectedStorageStudioDrive } from './use-storage-studio-selected-drive';

export interface UseStorageStudioManagementOptions {
  readonly enabled?: boolean;
  readonly initialDriveId?: string | null;
  readonly drivePageSize?: number;
  readonly filePageSize?: number;
  readonly onDriveChange?: (driveId: string | null) => void;
}

export interface UseStorageStudioManagementResult {
  readonly controller: StorageManagementController;
  readonly inspectorSlots: StorageStudioInspectorSlots;
  readonly uploadInputProps: ReturnType<ReturnType<typeof useUploadDropzone>['dropzone']['getInputProps']>;
}

/** Build a fully authenticated adaptive Storage Studio controller. */
export function useStorageStudioManagement(
  options: UseStorageStudioManagementOptions = {},
): UseStorageStudioManagementResult {
  const client = useClientMaybe();
  const boundary = useAuthorizationScopeBoundary(client);
  const enabled = options.enabled !== false;
  const authenticated = client?.isAuthenticated === true;
  React.useEffect(() => {
    bindStorageStudioScope(
      client?.storageStudio ?? null,
      boundary.key,
      enabled && authenticated && boundary.ready,
    );
  }, [authenticated, boundary.key, boundary.ready, client, enabled]);
  const [view, setView] = React.useState<StorageManagementView>(
    options.initialDriveId ? 'files' : 'drives',
  );
  const [selectedDriveState, setSelectedDriveState] = React.useState(
    bindStorageStudioValue<string | null>(boundary.key, options.initialDriveId ?? null),
  );
  const selectedDriveId = readStorageStudioValue(
    selectedDriveState,
    boundary.key,
    boundary.ready,
  );
  const setSelectedDriveId = React.useCallback((driveId: string | null) => {
    setSelectedDriveState(bindStorageStudioValue(boundary.key, driveId));
  }, [boundary.key]);
  const [selectedFileState, setSelectedFileState] = React.useState<
    StorageStudioScopedValue<FileInfo> | null
  >(null);
  const selectedFile = readStorageStudioValue(
    selectedFileState,
    boundary.key,
    boundary.ready,
  );
  const [currentPathState, setCurrentPathState] = React.useState(
    bindStorageStudioValue<string | null>(boundary.key, null),
  );
  const currentPath = readStorageStudioValue(
    currentPathState,
    boundary.key,
    boundary.ready,
  );
  const setCurrentPath = React.useCallback((path: string | null) => {
    setCurrentPathState(bindStorageStudioValue(boundary.key, path));
  }, [boundary.key]);
  const [search, setSearchState] = React.useState('');
  const [owner, setOwnerState] = React.useState<StorageStudioOwnerFilter>('all');
  const [lifecycle, setLifecycleState] = React.useState<StorageStudioLifecycleFilter>('all');
  const [objectType, setObjectTypeState] = React.useState<NonNullable<ListOptions['type']>>('all');
  const [sortBy, setSortByState] = React.useState<NonNullable<ListOptions['sortBy']>>('name');
  const [sortDir, setSortDirState] = React.useState<NonNullable<ListOptions['sortDir']>>('asc');
  const debouncedSearch = useDebouncedValue(search, 200);
  const fileNavigationKey = JSON.stringify([
    boundary.key,
    selectedDriveId,
    currentPath,
    debouncedSearch.trim(),
    objectType,
    sortBy,
    sortDir,
  ]);
  const [fileNavigation, setFileNavigation] = React.useState(
    () => emptyFileNavigation(fileNavigationKey),
  );
  const fileCursor = fileNavigation.key === fileNavigationKey
    ? fileNavigation.cursor
    : null;
  const fileCursorHistory = fileNavigation.key === fileNavigationKey
    ? fileNavigation.history
    : Object.freeze([] as (string | null)[]);
  const catalogRequest = React.useMemo(
    () => storageStudioCatalogFilter({ owner, lifecycle, search: debouncedSearch }),
    [debouncedSearch, lifecycle, owner],
  );
  const catalog = useStorageStudioCatalog({
    surface: client?.storageStudio ?? null,
    boundary,
    enabled,
    authenticated,
    request: catalogRequest,
    pageSize: boundedPageSize(options.drivePageSize, 50),
  });
  const selectedDrive = useSelectedStorageStudioDrive({
    catalogDrives: catalog.drives,
    selectedDriveId,
    surface: client?.storageStudio ?? null,
    boundary,
  });
  const folder = useStorageFolder(selectedDriveId, currentPath ?? undefined, {
    cursor: fileCursor ?? undefined,
    limit: boundedPageSize(options.filePageSize, 100),
    search: debouncedSearch.trim() || undefined,
    type: objectType,
    sortBy,
    sortDir,
  });
  const usage = useDriveUsage(selectedDriveId);
  const currentPathAccess = useDriveCapabilities(selectedDriveId, currentPath ?? undefined);
  const selectedAccess = useDriveCapabilities(
    selectedFile ? selectedDriveId : null,
    selectedFile?.path,
  );
  const jobs = useStorageStudioJobs({
    surface: client?.storageStudio ?? null,
    boundary,
    driveId: selectedDriveId,
    enabled: enabled && Boolean(selectedDrive?.control.canManage),
  });

  React.useEffect(() => {
    setFileNavigation(emptyFileNavigation(fileNavigationKey));
  }, [fileNavigationKey]);
  React.useEffect(() => {
    setSelectedDriveState(bindStorageStudioValue(boundary.key, options.initialDriveId ?? null));
    setView(options.initialDriveId ? 'files' : 'drives');
    setSelectedFileState(null);
    setCurrentPathState(bindStorageStudioValue(boundary.key, null));
  }, [boundary.key, options.initialDriveId]);
  React.useEffect(() => {
    if (selectedFile && !folder.items.some((item) => item.id === selectedFile.id)) {
      setSelectedFileState(null);
    }
  }, [folder.items, selectedFile]);

  const setSelectedFile = React.useCallback((file: FileInfo | null) => {
    setSelectedFileState(file ? bindStorageStudioValue(boundary.key, file) : null);
  }, [boundary.key]);

  const selectDrive = React.useCallback((driveId: string | null) => {
    setSelectedDriveId(driveId);
    setSelectedFile(null);
    options.onDriveChange?.(driveId);
  }, [options.onDriveChange, setSelectedDriveId, setSelectedFile]);
  const openDrive = React.useCallback((driveId: string) => {
    selectDrive(driveId);
    setCurrentPath(null);
    setSearchState('');
    setView('files');
  }, [selectDrive, setCurrentPath]);
  const showDriveCatalog = React.useCallback(() => {
    selectDrive(null);
    setCurrentPath(null);
    setSearchState('');
    setView('drives');
  }, [selectDrive, setCurrentPath]);
  const openPath = React.useCallback((path: string | null) => {
    setCurrentPath(path);
    setSelectedFile(null);
    setSearchState('');
  }, [setCurrentPath, setSelectedFile]);

  const operationState = useStorageStudioOperations({
    surface: client?.storageStudio ?? null,
    boundary,
    capabilities: catalog.capabilities,
    selectedDriveId,
    currentPath,
    upsertDrive: catalog.upsertDrive,
    refreshCatalog: catalog.refresh,
    refreshFolder: folder.refresh,
    refreshSelectedAccess: selectedAccess.refresh,
    refreshJobs: jobs.refresh,
    clearSelectedFile: () => setSelectedFile(null),
    updateSelectedFile: setSelectedFile,
    selectDrive,
    showDriveCatalog,
  });
  const upload = useUploadDropzone({
    driveId: selectedDriveId,
    path: currentPath,
    overwrite: true,
    maxSize: selectedDrive?.drive.max_file_size_bytes || undefined,
    disabled: selectedDrive?.profile.lifecycle !== 'ready'
      || currentPathAccess.capabilities?.canWrite !== true,
    onUploaded: (files) => {
      folder.refresh();
      toast.success(files.length === 1 ? 'File uploaded' : `${files.length} files uploaded`);
    },
    onError: (cause) => toast.error(cause.message),
  });
  const operations = React.useMemo(() => ({
    ...operationState.operations,
    upload: selectedDrive?.profile.lifecycle === 'ready'
      && currentPathAccess.capabilities?.canWrite === true
      ? upload.dropzone.open
      : undefined,
  }), [
    currentPathAccess.capabilities?.canWrite,
    operationState.operations,
    selectedDrive?.profile.lifecycle,
    upload.dropzone.open,
  ]);

  const loading = catalog.loading
    || (view === 'files' && (folder.loading || jobs.loading));
  const error = operationState.error
    ?? catalog.error
    ?? optionalError(folder.error)
    ?? optionalError(usage.error)
    ?? optionalError(currentPathAccess.error)
    ?? optionalError(selectedAccess.error)
    ?? jobs.error;
  const controller = React.useMemo<StorageManagementController>(() => ({
    status: !enabled || catalog.disabled || !authenticated
      ? 'disabled'
      : error
        ? 'error'
        : loading || !catalog.capabilities
          ? 'loading'
          : 'ready',
    capabilities: catalog.capabilities,
    view,
    drives: catalog.drives,
    files: folder.items,
    selectedDrive,
    selectedFile,
    currentPathAccess: currentPathAccess.capabilities,
    selectedFileAccess: selectedFile
      ? selectedAccess.capabilities
      : currentPathAccess.capabilities,
    currentPath,
    breadcrumbs: storageStudioBreadcrumbs(currentPath),
    usage: usage.usage,
    jobs: jobs.jobs,
    filters: { search, owner, lifecycle, objectType, sortBy, sortDir },
    drivePagination: catalog.pagination,
    filePagination: {
      page: fileCursorHistory.length + 1,
      count: folder.items.length,
      total: folder.total,
      hasPrevious: fileCursorHistory.length > 0,
      hasNext: folder.cursor !== null,
    },
    busy: operationState.busy || upload.queue.uploading,
    loading,
    error: error?.message ?? null,
    setSearch: (value) => {
      setSearchState(value.slice(0, view === 'files' ? 200 : 120));
    },
    setOwnerFilter: (value) => { setOwnerState(value); },
    setLifecycleFilter: (value) => { setLifecycleState(value); },
    setObjectTypeFilter: (value) => setObjectTypeState(value),
    setSortBy: (value) => setSortByState(value),
    setSortDir: (value) => setSortDirState(value),
    selectDrive,
    openDrive,
    selectFile: setSelectedFile,
    openFolder: (path) => openPath(path),
    openBreadcrumb: openPath,
    showDriveCatalog,
    refresh: () => {
      operationState.clearError();
      catalog.refresh();
      folder.refresh();
      usage.refresh();
      currentPathAccess.refresh();
      selectedAccess.refresh();
      jobs.refresh();
    },
    previousDrivePage: catalog.previousPage,
    nextDrivePage: catalog.nextPage,
    previousFilePage: () => {
      const previous = fileCursorHistory.at(-1);
      if (previous === undefined) return;
      setFileNavigation((current) => current.key !== fileNavigationKey
        ? emptyFileNavigation(fileNavigationKey)
        : Object.freeze({
            key: fileNavigationKey,
            cursor: previous,
            history: Object.freeze(current.history.slice(0, -1)),
          }));
    },
    nextFilePage: () => {
      if (!folder.cursor) return;
      setFileNavigation((current) => current.key !== fileNavigationKey
        ? emptyFileNavigation(fileNavigationKey)
        : Object.freeze({
            key: fileNavigationKey,
            cursor: folder.cursor,
            history: Object.freeze([...current.history, current.cursor]),
          }));
    },
    operations,
  }), [
    authenticated, catalog, currentPath, enabled, error, fileCursor, fileCursorHistory,
    fileNavigationKey,
    folder, jobs, lifecycle, loading, objectType, openDrive, openPath, operationState,
    operations, owner, search, selectDrive, selectedAccess, selectedDrive, selectedFile,
    currentPathAccess, showDriveCatalog, sortBy, sortDir, upload.queue.uploading, usage, view,
  ]);
  const inspectorSlots = useStorageStudioInspectorSlots(controller, operationState.updateDrive);

  shouldUseSsrFallback(client, 'useStorageStudioManagement');
  return {
    controller,
    inspectorSlots,
    uploadInputProps: upload.dropzone.getInputProps(),
  };
}

function emptyFileNavigation(key: string): Readonly<{
  key: string;
  cursor: string | null;
  history: readonly (string | null)[];
}> {
  return Object.freeze({ key, cursor: null, history: Object.freeze([]) });
}

function boundedPageSize(value: number | undefined, fallback: number): number {
  return Number.isFinite(value)
    ? Math.min(100, Math.max(1, Math.floor(value!)))
    : fallback;
}

function optionalError(value: string | null): Error | null {
  return value ? new Error(value) : null;
}
