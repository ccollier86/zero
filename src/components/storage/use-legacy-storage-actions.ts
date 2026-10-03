'use client';

/**
 * Owns legacy StorageManagement mutation workflows and confirmation dialogs.
 * Transport remains in the existing storage hooks passed by the adapter.
 */

import * as React from 'react';
import { toast } from 'sonner';
import { modals } from '../../modals';
import type {
  StorageActions,
  UsePresignedUrlReturn,
} from '../../storage/storage-hooks';
import type { StorageStudioDrive } from '../../storage/storage-studio-contracts';
import type { FileInfo } from '../../storage/types';
import { joinStoragePath, renameStoragePath } from './storage-format';
import { openStorageNameDialog } from './storage-name-dialog';

export type LegacyStorageActionRunner = (
  action: string,
  task: () => Promise<void>,
  metadata?: Record<string, unknown>,
) => Promise<void>;

interface UseLegacyStorageActionsOptions {
  readonly actions: StorageActions;
  readonly presigned: UsePresignedUrlReturn;
  readonly selectedDriveId: string | null;
  readonly currentPath: string | null;
  readonly runAction: LegacyStorageActionRunner;
  readonly refreshDrives: () => void;
  readonly refreshFolder: () => void;
  readonly clearSelectedFile: () => void;
  readonly clearSelectedDrive: () => void;
  readonly showDriveCatalog: () => void;
}
/** Compose legacy mutation helpers for the transport-free Studio controller. */
export function useLegacyStorageActions({
  actions,
  presigned,
  selectedDriveId,
  currentPath,
  runAction,
  refreshDrives,
  refreshFolder,
  clearSelectedFile,
  clearSelectedDrive,
  showDriveCatalog,
}: UseLegacyStorageActionsOptions) {
  const createDrive = React.useCallback(async () => {
    const name = await openStorageNameDialog({
      title: 'New drive',
      label: 'Drive name',
      placeholder: 'Project files',
      submitLabel: 'Create drive',
    });
    if (!name) return;
    await runAction('createDrive', async () => {
      await actions.createDrive(name);
      refreshDrives();
      toast.success('Drive created');
    });
  }, [actions, refreshDrives, runAction]);

  const renameDrive = React.useCallback(async (drive: StorageStudioDrive, name: string) => {
    await runAction('updateDrive', async () => {
      await actions.updateDrive(drive.drive.drive_id, { name });
      refreshDrives();
      toast.success('Drive renamed');
    }, { driveId: drive.drive.drive_id });
  }, [actions, refreshDrives, runAction]);

  const deleteDrive = React.useCallback(async (drive: StorageStudioDrive) => {
    const confirmed = await modals.confirm({
      title: 'Delete drive?',
      description: `${drive.drive.name} and all files inside it will be permanently deleted.`,
      confirmLabel: 'Delete',
      variant: 'destructive',
      holdToConfirm: true,
    });
    if (!confirmed) return;
    await runAction('deleteDrive', async () => {
      await actions.deleteDrive(drive.drive.drive_id);
      if (selectedDriveId === drive.drive.drive_id) {
        clearSelectedDrive();
        showDriveCatalog();
      }
      refreshDrives();
      toast.success('Drive deleted');
    }, { driveId: drive.drive.drive_id });
  }, [
    actions,
    clearSelectedDrive,
    refreshDrives,
    runAction,
    selectedDriveId,
    showDriveCatalog,
  ]);

  const createFolder = React.useCallback(async () => {
    if (!selectedDriveId) return;
    const name = await openStorageNameDialog({
      title: 'New folder',
      label: 'Folder name',
      placeholder: 'Invoices',
      submitLabel: 'Create folder',
    });
    if (!name) return;
    await runAction('createFolder', async () => {
      await actions.createFolder(selectedDriveId, joinStoragePath(currentPath ?? undefined, name));
      refreshFolder();
      toast.success('Folder created');
    }, { driveId: selectedDriveId, currentPath });
  }, [actions, currentPath, refreshFolder, runAction, selectedDriveId]);

  const renameFile = React.useCallback(async (file: FileInfo, name: string) => {
    if (!selectedDriveId) return;
    await runAction('renameFile', async () => {
      await actions.moveFile(selectedDriveId, file.path, renameStoragePath(file.path, name));
      clearSelectedFile();
      refreshFolder();
      toast.success('Renamed');
    }, { driveId: selectedDriveId, path: file.path });
  }, [actions, clearSelectedFile, refreshFolder, runAction, selectedDriveId]);

  const moveOrCopy = React.useCallback(async (kind: 'move' | 'copy', file: FileInfo) => {
    if (!selectedDriveId) return;
    const destination = await openStorageNameDialog({
      title: kind === 'move' ? 'Move item' : 'Copy item',
      label: 'Destination path',
      initialValue: file.path,
      description: 'Enter the full destination path inside this drive.',
      submitLabel: kind === 'move' ? 'Move' : 'Copy',
    });
    if (!destination || destination === file.path) return;
    await runAction(kind === 'move' ? 'moveFile' : 'copyFile', async () => {
      if (kind === 'move') await actions.moveFile(selectedDriveId, file.path, destination);
      else await actions.copyFile(selectedDriveId, file.path, destination);
      clearSelectedFile();
      refreshFolder();
      toast.success(kind === 'move' ? 'Item moved' : 'Item copied');
    }, { driveId: selectedDriveId, path: file.path, destination });
  }, [actions, clearSelectedFile, refreshFolder, runAction, selectedDriveId]);

  const deleteFile = React.useCallback(async (file: FileInfo) => {
    if (!selectedDriveId) return;
    const confirmed = await modals.confirm({
      title: file.type === 'folder' ? 'Delete folder?' : 'Delete file?',
      description: `${file.name} will be permanently deleted.`,
      confirmLabel: 'Delete',
      variant: 'destructive',
      holdToConfirm: true,
    });
    if (!confirmed) return;
    await runAction('deleteFile', async () => {
      await actions.deleteFile(selectedDriveId, file.path);
      clearSelectedFile();
      refreshFolder();
      toast.success(file.type === 'folder' ? 'Folder deleted' : 'File deleted');
    }, { driveId: selectedDriveId, path: file.path });
  }, [actions, clearSelectedFile, refreshFolder, runAction, selectedDriveId]);

  const download = React.useCallback(async (file: FileInfo) => {
    if (!selectedDriveId) return;
    await runAction('downloadFile', async () => {
      const url = await presigned.getUrl(selectedDriveId, file.path, 'download');
      window.open(url, '_blank', 'noopener,noreferrer');
    }, { driveId: selectedDriveId, path: file.path });
  }, [presigned, runAction, selectedDriveId]);

  const share = React.useCallback(async (file: FileInfo) => {
    if (!selectedDriveId) return;
    await runAction('copyPresignedLink', async () => {
      const url = await presigned.getUrl(selectedDriveId, file.path, 'download');
      if (!navigator.clipboard) throw new Error('Clipboard API is not available');
      await navigator.clipboard.writeText(url);
      toast.success('Temporary link copied');
    }, { driveId: selectedDriveId, path: file.path });
  }, [presigned, runAction, selectedDriveId]);

  return React.useMemo(() => ({
    createDrive,
    renameDrive,
    deleteDrive,
    createFolder,
    renameFile,
    moveOrCopy,
    deleteFile,
    download,
    share,
  }), [
    createDrive,
    createFolder,
    deleteDrive,
    deleteFile,
    download,
    moveOrCopy,
    renameDrive,
    renameFile,
    share,
  ]);
}
