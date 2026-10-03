'use client';

/**
 * Adapts Zero's existing storage hooks to the Storage Studio presentation
 * contract. This keeps the long-standing StorageManagement props functional
 * while newer integrations can supply a native Studio controller directly.
 */

import * as React from 'react';
import { toast } from 'sonner';
import { useAuth } from '../../frontend/client/auth-hooks';
import {
  useDriveCapabilities,
  useDriveUsage,
  usePresignedUrl,
  useStorageActions,
  useStorageDrives,
  useStorageFolder,
} from '../../storage/storage-hooks';
import { useUploadDropzone } from '../../storage/upload-dropzone-hooks';
import type { FileInfo, ListOptions } from '../../storage/types';
import {
  parseAllowedMimeTypes,
  parseStorageLimit,
} from './storage-format';
import { StorageDrivePermissionsPanel } from './storage-drive-permissions-panel';
import { StorageDriveSettingsPanel } from './storage-drive-settings-panel';
import type {
  StorageManagementController,
  StorageManagementView,
  StorageStudioLifecycleFilter,
  StorageStudioOwnerFilter,
} from './storage-management-controller';
import {
  legacyStorageBreadcrumbs,
  legacyStorageCapabilities,
  toLegacyStorageDriveRow,
  toLegacyStudioDrive,
} from './storage-management-legacy-values';
import { reportStorageActionError } from './storage-observability';
import { StorageStudioWorkspace } from './storage-studio-workspace';
import { useLegacyStorageActions } from './use-legacy-storage-actions';

export interface LegacyStorageManagementAdapterProps {
  readonly initialDriveId?: string | null;
  readonly onDriveChange?: (driveId: string | null) => void;
  readonly className?: string;
}

export function LegacyStorageManagementAdapter({
  initialDriveId = null,
  onDriveChange,
  className,
}: LegacyStorageManagementAdapterProps) {
  const auth = useAuth();
  const storageActions = useStorageActions();
  const presigned = usePresignedUrl();
  const driveResult = useStorageDrives();
  const [view, setView] = React.useState<StorageManagementView>(initialDriveId ? 'files' : 'drives');
  const [selectedDriveId, setSelectedDriveId] = React.useState<string | null>(initialDriveId);
  const [selectedFile, setSelectedFile] = React.useState<FileInfo | null>(null);
  const [currentPath, setCurrentPath] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [owner, setOwner] = React.useState<StorageStudioOwnerFilter>('all');
  const [lifecycle, setLifecycle] = React.useState<StorageStudioLifecycleFilter>('all');
  const [objectType, setObjectType] = React.useState<NonNullable<ListOptions['type']>>('all');
  const [sortBy, setSortBy] = React.useState<NonNullable<ListOptions['sortBy']>>('name');
  const [sortDir, setSortDir] = React.useState<NonNullable<ListOptions['sortDir']>>('asc');
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const studioDrives = React.useMemo(
    () => driveResult.drives.map(toLegacyStudioDrive),
    [driveResult.drives],
  );
  const selectedDrive = React.useMemo(
    () => studioDrives.find((item) => item.drive.drive_id === selectedDriveId) ?? null,
    [selectedDriveId, studioDrives],
  );
  const folder = useStorageFolder(selectedDriveId, currentPath ?? undefined, {
    type: objectType,
    sortBy,
    sortDir,
  });
  const driveUsage = useDriveUsage(selectedDriveId);
  const selectedCapabilities = useDriveCapabilities(selectedDriveId, selectedFile?.path);
  const upload = useUploadDropzone({
    driveId: selectedDriveId,
    path: currentPath,
    overwrite: true,
    disabled: selectedDrive?.drive.access.canWrite !== true,
    onUploaded: (files) => {
      folder.refresh();
      toast.success(files.length === 1 ? 'File uploaded' : `${files.length} files uploaded`);
    },
    onError: (cause) => toast.error(cause.message),
  });

  React.useEffect(() => {
    if (selectedFile && !folder.items.some((item) => item.id === selectedFile.id)) {
      setSelectedFile(null);
    }
  }, [folder.items, selectedFile]);

  const runAction = React.useCallback(async (
    action: string,
    task: () => Promise<void>,
    metadata?: Record<string, unknown>,
  ) => {
    setBusy(true);
    setActionError(null);
    try {
      await task();
    } catch (cause) {
      const normalized = reportStorageActionError(action, cause, metadata);
      setActionError(normalized.message);
      toast.error(normalized.message);
      throw normalized;
    } finally {
      setBusy(false);
    }
  }, []);

  const openDrive = React.useCallback((driveId: string) => {
    setSelectedDriveId(driveId);
    setSelectedFile(null);
    setCurrentPath(null);
    setSearch('');
    setView('files');
    onDriveChange?.(driveId);
  }, [onDriveChange]);

  const showDriveCatalog = React.useCallback(() => {
    setView('drives');
    setSelectedDriveId(null);
    setSelectedFile(null);
    setCurrentPath(null);
    setSearch('');
    onDriveChange?.(null);
  }, [onDriveChange]);

  const workflows = useLegacyStorageActions({
    actions: storageActions,
    presigned,
    selectedDriveId,
    currentPath,
    runAction,
    refreshDrives: driveResult.refresh,
    refreshFolder: folder.refresh,
    clearSelectedFile: () => setSelectedFile(null),
    clearSelectedDrive: () => setSelectedDriveId(null),
    showDriveCatalog,
  });

  const filteredDrives = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return studioDrives.filter((item) => {
      if (owner !== 'all') {
        const matchesOwner = owner === 'personal'
          ? item.profile.ownerKind === 'user'
          : item.profile.ownerKind !== 'user';
        if (!matchesOwner) return false;
      }
      if (lifecycle !== 'all' && item.profile.lifecycle !== lifecycle) return false;
      return !needle
        || item.drive.name.toLowerCase().includes(needle)
        || item.profile.key.toLowerCase().includes(needle);
    });
  }, [lifecycle, owner, search, studioDrives]);

  const filteredFiles = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return folder.items;
    return folder.items.filter((file) => file.name.toLowerCase().includes(needle)
      || file.path.toLowerCase().includes(needle)
      || file.mimeType?.toLowerCase().includes(needle));
  }, [folder.items, search]);

  const controller = React.useMemo<StorageManagementController>(() => ({
    status: actionError || driveResult.error || folder.error ? 'error' : 'ready',
    capabilities: legacyStorageCapabilities(auth.isAuthenticated, Boolean(auth.activeTenant)),
    view,
    drives: filteredDrives,
    files: filteredFiles,
    selectedDrive,
    selectedFile,
    selectedFileAccess: selectedCapabilities.capabilities ?? selectedDrive?.drive.access ?? null,
    currentPath,
    breadcrumbs: legacyStorageBreadcrumbs(currentPath),
    usage: driveUsage.usage,
    jobs: [],
    filters: { search, owner, lifecycle, objectType, sortBy, sortDir },
    busy: busy || upload.queue.uploading,
    loading: driveResult.loading || (view === 'files' && folder.loading),
    error: actionError ?? driveResult.error ?? folder.error ?? driveUsage.error ?? selectedCapabilities.error,
    setSearch,
    setOwnerFilter: setOwner,
    setLifecycleFilter: setLifecycle,
    setObjectTypeFilter: setObjectType,
    setSortBy,
    setSortDir,
    selectDrive: setSelectedDriveId,
    openDrive,
    selectFile: setSelectedFile,
    openFolder: (path) => {
      setCurrentPath(path);
      setSelectedFile(null);
      setSearch('');
    },
    openBreadcrumb: (path) => {
      setCurrentPath(path);
      setSelectedFile(null);
      setSearch('');
    },
    showDriveCatalog,
    refresh: () => {
      setActionError(null);
      driveResult.refresh();
      if (selectedDriveId) {
        folder.refresh();
        driveUsage.refresh();
        selectedCapabilities.refresh();
      }
    },
    operations: {
      createDrive: auth.isAuthenticated ? workflows.createDrive : undefined,
      upload: selectedDrive?.drive.access.canWrite ? upload.dropzone.open : undefined,
      createFolder: selectedDrive?.drive.access.canWrite ? workflows.createFolder : undefined,
      download: workflows.download,
      renameDrive: workflows.renameDrive,
      renameFile: workflows.renameFile,
      move: (file) => workflows.moveOrCopy('move', file),
      copy: (file) => workflows.moveOrCopy('copy', file),
      share: workflows.share,
      deleteDrive: workflows.deleteDrive,
      deleteFile: workflows.deleteFile,
    },
  }), [
    actionError,
    auth.activeTenant,
    auth.isAuthenticated,
    busy,
    driveResult,
    driveUsage,
    filteredDrives,
    filteredFiles,
    folder,
    lifecycle,
    objectType,
    openDrive,
    owner,
    search,
    selectedCapabilities,
    selectedDrive,
    selectedDriveId,
    selectedFile,
    showDriveCatalog,
    sortBy,
    sortDir,
    upload.dropzone.open,
    upload.queue.uploading,
    view,
    workflows,
  ]);

  const selectedRow = selectedDrive ? toLegacyStorageDriveRow(selectedDrive) : null;

  return (
    <>
      <input {...upload.dropzone.getInputProps()} className="sr-only" aria-label="Choose files to upload" />
      <StorageStudioWorkspace
        controller={controller}
        className={className}
        inspectorSlots={selectedRow ? {
          driveAccess: (drive) => (
            <StorageDrivePermissionsPanel
              driveId={drive.drive.drive_id}
              canAdmin={drive.drive.access.canAdmin}
              onChanged={controller.refresh}
            />
          ),
          driveSettings: (drive) => (
            <StorageDriveSettingsPanel
              drive={toLegacyStorageDriveRow(drive)}
              busy={busy}
              disabled={!drive.drive.access.canAdmin}
              onSave={async (changes) => {
                try {
                  await runAction('updateDrive', async () => {
                    const updateParams = {
                      ...(typeof changes.name === 'string' ? { name: changes.name } : {}),
                      ...(Object.prototype.hasOwnProperty.call(changes, 'max_size_bytes')
                        ? { maxSize: parseStorageLimit(changes.max_size_bytes) }
                        : {}),
                      ...(Object.prototype.hasOwnProperty.call(changes, 'max_file_size_bytes')
                        ? { maxFileSize: parseStorageLimit(changes.max_file_size_bytes) }
                        : {}),
                      ...(Object.prototype.hasOwnProperty.call(changes, 'allowed_mime_types')
                        ? { allowedMimeTypes: parseAllowedMimeTypes(changes.allowed_mime_types) }
                        : {}),
                    };
                    await storageActions.updateDrive(drive.drive.drive_id, updateParams);
                    if (Object.prototype.hasOwnProperty.call(changes, 'public')) {
                      await storageActions.setVisibility(
                        drive.drive.drive_id,
                        changes.public === 1 || changes.public === '1' || changes.public === 'true',
                      );
                    }
                    driveResult.refresh();
                    toast.success('Drive settings saved');
                  }, { driveId: drive.drive.drive_id });
                } catch {
                  // The adapter already reports and renders the normalized error.
                }
              }}
            />
          ),
        } : undefined}
      />
    </>
  );
}
