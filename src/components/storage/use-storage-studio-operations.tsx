'use client';

/**
 * use-storage-studio-operations.tsx
 *
 * Composes Studio lifecycle mutations with established storage object actions
 * for the adaptive controller. Catalog reads, upload input, jobs, and rendering
 * remain in focused peers.
 */

import * as React from 'react';
import { toast } from 'sonner';
import type {
  StorageStudioCapabilities,
  StorageStudioDrive,
  StorageStudioDriveUpdateRequest,
} from '../../storage/storage-studio-contracts';
import type { StorageStudioSdkSurface } from '../../frontend/client/storage-studio-client';
import type { AuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import { modals } from '../../modals';
import {
  usePresignedUrl,
  useStorageActions,
} from '../../storage/storage-hooks';
import type { FileInfo } from '../../storage/types';
import type { StorageStudioOperations } from './storage-management-controller';
import { reportStorageActionError } from './storage-observability';
import { openStorageStudioProvisionDialog } from './storage-studio-provision-dialog';
import { storageStudioLifecycleAction } from './storage-studio-controller-values';
import { assertStorageStudioScopeCurrent } from './storage-studio-scope-binding';
import { useLegacyStorageActions } from './use-legacy-storage-actions';

export interface UseStorageStudioOperationsInput {
  readonly surface: StorageStudioSdkSurface | null;
  readonly boundary: AuthorizationScopeBoundary;
  readonly capabilities: StorageStudioCapabilities | null;
  readonly selectedDriveId: string | null;
  readonly currentPath: string | null;
  readonly upsertDrive: (drive: StorageStudioDrive) => void;
  readonly refreshCatalog: () => void;
  readonly refreshFolder: () => void;
  readonly refreshSelectedAccess: () => void;
  readonly refreshJobs: () => void;
  readonly clearSelectedFile: () => void;
  readonly updateSelectedFile: (file: FileInfo) => void;
  readonly selectDrive: (driveId: string | null) => void;
  readonly showDriveCatalog: () => void;
}

/** Bind lifecycle-safe mutations to the transport-free controller contract. */
export function useStorageStudioOperations(input: UseStorageStudioOperationsInput) {
  const storageActions = useStorageActions();
  const presigned = usePresignedUrl();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);
  const boundaryKeyRef = React.useRef(input.boundary.key);
  const boundaryReadyRef = React.useRef(input.boundary.ready);
  boundaryKeyRef.current = input.boundary.key;
  boundaryReadyRef.current = input.boundary.ready;

  React.useEffect(() => {
    setBusy(false);
    setError(null);
  }, [input.boundary.key]);

  const runAction = React.useCallback(async (
    action: string,
    task: () => Promise<void>,
    metadata?: Record<string, unknown>,
  ) => {
    const capturedKey = input.boundary.key;
    const assertCurrent = () => assertStorageStudioScopeCurrent(
      capturedKey,
      boundaryKeyRef.current,
      boundaryReadyRef.current,
    );
    assertCurrent();
    setBusy(true);
    setError(null);
    try {
      // Modal-backed actions can resume after the organization changes. Fence
      // immediately before invoking transport, not only after it resolves.
      assertCurrent();
      await task();
      assertCurrent();
    } catch (cause) {
      if (!boundaryReadyRef.current || boundaryKeyRef.current !== capturedKey) throw cause;
      const normalized = reportStorageActionError(action, cause, metadata);
      setError(normalized);
      toast.error(normalized.message);
      throw normalized;
    } finally {
      if (boundaryReadyRef.current && boundaryKeyRef.current === capturedKey) setBusy(false);
    }
  }, [input.boundary.key]);

  const legacy = useLegacyStorageActions({
    actions: storageActions,
    presigned,
    selectedDriveId: input.selectedDriveId,
    currentPath: input.currentPath,
    runAction,
    refreshDrives: input.refreshCatalog,
    refreshFolder: input.refreshFolder,
    clearSelectedFile: input.clearSelectedFile,
    clearSelectedDrive: () => input.selectDrive(null),
    showDriveCatalog: input.showDriveCatalog,
  });

  const createDrive = React.useCallback(async () => {
    if (!input.surface || !input.capabilities) return;
    const request = await openStorageStudioProvisionDialog(input.capabilities);
    if (!request) return;
    await runAction('provisionDrive', async () => {
      const result = await input.surface!.provisionDrive(request);
      input.upsertDrive(result.value);
      input.selectDrive(result.value.drive.drive_id);
      input.refreshCatalog();
      input.refreshJobs();
      toast.success(result.replayed ? 'Drive already provisioned' : 'Drive created');
    }, { owner: request.owner });
  }, [input.capabilities, input.surface, input.upsertDrive, input.selectDrive, input.refreshCatalog, input.refreshJobs, runAction]);

  const updateDrive = React.useCallback(async (
    drive: StorageStudioDrive,
    updates: Omit<StorageStudioDriveUpdateRequest, 'operationId' | 'expectedRevision'>,
  ) => {
    if (!input.surface) return;
    await runAction('updateDrive', async () => {
      const result = await input.surface!.updateDrive(drive.drive.drive_id, {
        expectedRevision: drive.profile.revision,
        ...updates,
      });
      input.upsertDrive(result.value);
      input.refreshCatalog();
      toast.success('Drive settings saved');
    }, { driveId: drive.drive.drive_id });
  }, [input.surface, input.upsertDrive, input.refreshCatalog, runAction]);

  const changeLifecycle = React.useCallback(async (
    drive: StorageStudioDrive,
    action: 'suspend' | 'resume' | 'delete' | 'restore' | 'retry',
  ) => {
    if (!input.surface) return;
    await runAction(`drive.${action}`, async () => {
      const result = await input.surface!.changeDriveLifecycle(drive.drive.drive_id, {
        action,
        expectedRevision: drive.profile.revision,
      });
      input.upsertDrive(result.value);
      input.refreshCatalog();
      input.refreshJobs();
      if (action === 'delete') input.showDriveCatalog();
      toast.success(lifecycleSuccess(action));
    }, { driveId: drive.drive.drive_id });
  }, [input.surface, input.upsertDrive, input.refreshCatalog, input.refreshJobs, input.showDriveCatalog, runAction]);

  const deleteDrive = React.useCallback(async (drive: StorageStudioDrive) => {
    const confirmed = await modals.confirm({
      title: 'Delete drive?',
      description: `${drive.drive.name} files and folders will be permanently removed. A later restore recreates the drive settings as an empty drive.`,
      confirmLabel: 'Delete',
      variant: 'destructive',
      holdToConfirm: true,
    });
    if (confirmed) await changeLifecycle(drive, 'delete');
  }, [changeLifecycle]);

  const canProvision = input.capabilities?.canProvisionOrganization === true
    || input.capabilities?.canProvisionPersonal === true;
  const updateFileMetadata = React.useCallback(async (
    file: FileInfo,
    metadata: Readonly<Record<string, unknown>>,
  ) => {
    if (!input.selectedDriveId) return;
    await runAction('updateFileMetadata', async () => {
      const updated = await storageActions.updateFileMetadata(
        input.selectedDriveId!,
        file.path,
        { ...metadata },
      );
      input.updateSelectedFile(updated);
      input.refreshFolder();
      toast.success('File metadata saved');
    }, { driveId: input.selectedDriveId, objectType: file.type });
  }, [input.refreshFolder, input.selectedDriveId, input.updateSelectedFile, runAction, storageActions]);
  const setFileVisibility = React.useCallback(async (file: FileInfo, isPublic: boolean) => {
    if (!input.selectedDriveId) return;
    await runAction('setFileVisibility', async () => {
      await storageActions.setVisibility(input.selectedDriveId!, isPublic, file.path);
      input.updateSelectedFile({ ...file, isPublic });
      input.refreshFolder();
      input.refreshSelectedAccess();
      toast.success(isPublic ? 'Object is now public' : 'Object is now private');
    }, { driveId: input.selectedDriveId, objectType: file.type, public: isPublic });
  }, [
    input.refreshFolder,
    input.refreshSelectedAccess,
    input.selectedDriveId,
    input.updateSelectedFile,
    runAction,
    storageActions,
  ]);
  const operations = React.useMemo<StorageStudioOperations>(() => ({
    createDrive: canProvision ? createDrive : undefined,
    createFolder: legacy.createFolder,
    download: legacy.download,
    renameDrive: (drive, name) => updateDrive(drive, { name }),
    renameFile: legacy.renameFile,
    move: (file) => legacy.moveOrCopy('move', file),
    copy: (file) => legacy.moveOrCopy('copy', file),
    updateFileMetadata,
    share: legacy.share,
    setFileVisibility,
    suspend: (drive) => changeLifecycle(drive, 'suspend'),
    restore: (drive) => changeLifecycle(drive, storageStudioLifecycleAction(drive.profile.lifecycle)),
    deleteDrive,
    deleteFile: legacy.deleteFile,
  }), [
    canProvision,
    changeLifecycle,
    createDrive,
    deleteDrive,
    legacy,
    setFileVisibility,
    updateDrive,
    updateFileMetadata,
  ]);

  return {
    operations,
    updateDrive,
    busy,
    error,
    clearError: React.useCallback(() => setError(null), []),
  };
}

function lifecycleSuccess(action: string): string {
  if (action === 'suspend') return 'Drive suspended';
  if (action === 'resume') return 'Drive resumed';
  if (action === 'delete') return 'Drive deletion started';
  if (action === 'restore') return 'Drive restore started';
  return 'Drive recovery queued';
}
