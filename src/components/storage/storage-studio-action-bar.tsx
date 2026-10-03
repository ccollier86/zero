'use client';

/** Capability-gated, selection-aware Storage Studio action bar. */

import * as React from 'react';
import {
  ArchiveRestore,
  Copy,
  FileDown,
  FolderOpen,
  FolderPlus,
  FolderUp,
  Move,
  Pencil,
  RefreshCw,
  Share2,
} from 'lucide-react';
import { Trash } from '../animate-ui/icons/trash';
import {
  RecordNavigationBar,
  type NavigationAction,
} from '../ui/record-navigation-bar';
import type { StorageManagementController } from './storage-management-controller';

export interface StorageStudioActionBarProps {
  readonly controller: StorageManagementController;
}

/** Render only actions authorized for the current mode and selection. */
export function StorageStudioActionBar({ controller }: StorageStudioActionBarProps) {
  const collection = controller.view === 'drives' ? controller.drives : controller.files;
  const selectedIndex = controller.view === 'drives'
    ? controller.drives.findIndex(
      (drive) => drive.drive.drive_id === controller.selectedDrive?.drive.drive_id,
    )
    : controller.files.findIndex((file) => file.id === controller.selectedFile?.id);
  const actions = controller.view === 'drives'
    ? driveActions(controller)
    : fileActions(controller);
  const canProvision = controller.capabilities?.canProvisionOrganization === true
    || controller.capabilities?.canProvisionPersonal === true;
  const pathAccess = controller.currentPathAccess === undefined
    ? controller.selectedDrive?.drive.access
    : controller.currentPathAccess;
  const canWriteFiles = controller.selectedDrive?.profile.lifecycle === 'ready'
    && pathAccess?.canWrite === true;
  const pending = controller.busy || controller.loading || controller.status === 'loading';

  return (
    <div data-slot="storage-studio-action-bar" className="bg-background px-2 py-2 sm:px-3">
      <RecordNavigationBar
        currentIndex={selectedIndex < 0 ? 0 : selectedIndex}
        totalCount={collection.length}
        onPrevious={() => selectIndex(controller, Math.max(0, selectedIndex - 1))}
        onNext={() => selectIndex(controller, Math.min(collection.length - 1, selectedIndex + 1))}
        actions={actions}
        secondaryPrimaryAction={controller.view === 'files'
          && canWriteFiles
          && controller.operations.createFolder
          ? {
              label: 'New Folder',
              disabled: pending,
              onClick: () => invokeStorageAction(controller.operations.createFolder),
            }
          : undefined}
        primaryAction={controller.view === 'drives'
          ? canProvision && controller.operations.createDrive
            ? {
                label: 'New Drive',
                shortcut: 'Cmd+N',
                ariaHasPopup: 'dialog',
                disabled: pending,
                onClick: () => invokeStorageAction(controller.operations.createDrive),
              }
            : undefined
          : canWriteFiles && controller.operations.upload
            ? {
                label: 'Upload',
                shortcut: 'Cmd+U',
                disabled: pending,
                onClick: () => invokeStorageAction(controller.operations.upload),
              }
            : undefined}
      />
    </div>
  );
}

function driveActions(controller: StorageManagementController): NavigationAction[] {
  const drive = controller.selectedDrive;
  if (!drive) return [];
  const actions: NavigationAction[] = [];
  const pending = controller.busy || controller.loading || controller.status === 'loading';
  const lifecycleBusy = ['provisioning', 'deleting', 'restoring'].includes(drive.profile.lifecycle);

  if (drive.drive.access.canRead) {
    actions.push({
      icon: <FolderOpen className="size-4" />,
      label: 'Open',
      variant: 'default',
      disabled: pending || drive.profile.lifecycle !== 'ready',
      onClick: () => controller.openDrive(drive.drive.drive_id),
    });
  }
  if (drive.control.canManage && controller.operations.renameDrive) {
    actions.push({
      icon: <Pencil className="size-4" />,
      label: 'Rename',
      disabled: pending || lifecycleBusy,
      onClick: () => focusInlineEditor(drive.drive.drive_id),
    });
  }
  if (drive.control.canSuspend && controller.operations.suspend) {
    actions.push({
      icon: <FolderUp className="size-4" />,
      label: 'Suspend',
      variant: 'warning',
      disabled: pending || lifecycleBusy,
      onClick: () => invokeStorageAction(() => controller.operations.suspend?.(drive)),
    });
  }
  const canRecover = drive.control.canRestore
    || (drive.control.canManage
      && (drive.profile.lifecycle === 'failed' || drive.profile.lifecycle === 'degraded'));
  if (canRecover && controller.operations.restore) {
    const restoreLabel = drive.profile.lifecycle === 'failed' || drive.profile.lifecycle === 'degraded'
      ? 'Retry'
      : drive.profile.lifecycle === 'suspended'
        ? 'Resume'
        : 'Restore';
    actions.push({
      icon: drive.profile.lifecycle === 'failed' || drive.profile.lifecycle === 'degraded'
        ? <RefreshCw className="size-4" />
        : <ArchiveRestore className="size-4" />,
      label: restoreLabel,
      variant: 'success',
      disabled: pending || lifecycleBusy,
      onClick: () => invokeStorageAction(() => controller.operations.restore?.(drive)),
    });
  }
  if (drive.control.canDelete && controller.operations.deleteDrive) {
    actions.push({
      icon: <Trash className="size-4" />,
      label: 'Delete',
      variant: 'destructive',
      disabled: pending || lifecycleBusy,
      onClick: () => invokeStorageAction(() => controller.operations.deleteDrive?.(drive)),
    });
  }
  return actions;
}

function fileActions(controller: StorageManagementController): NavigationAction[] {
  const file = controller.selectedFile;
  if (!file) return [];
  const access = controller.selectedFileAccess;
  const actions: NavigationAction[] = [];
  const pending = controller.busy || controller.loading || controller.status === 'loading';

  if (file.type === 'folder' && access?.canRead) {
    actions.push({
      icon: <FolderOpen className="size-4" />,
      label: 'Open',
      disabled: pending,
      onClick: () => controller.openFolder(file.path),
    });
  }
  if (file.type === 'file' && access?.canRead && controller.operations.download) {
    actions.push({
      icon: <FileDown className="size-4" />,
      label: 'Download',
      disabled: pending,
      onClick: () => invokeStorageAction(() => controller.operations.download?.(file)),
    });
  }
  if (access?.canWrite && controller.operations.renameFile) {
    actions.push({
      icon: <Pencil className="size-4" />,
      label: 'Rename',
      disabled: pending,
      onClick: () => focusInlineEditor(file.id),
    });
  }
  if (access?.canWrite && controller.operations.move) {
    actions.push({
      icon: <Move className="size-4" />,
      label: 'Move',
      disabled: pending,
      onClick: () => invokeStorageAction(() => controller.operations.move?.(file)),
    });
  }
  if (file.type === 'file' && access?.canWrite && controller.operations.copy) {
    actions.push({
      icon: <Copy className="size-4" />,
      label: 'Copy',
      disabled: pending,
      onClick: () => invokeStorageAction(() => controller.operations.copy?.(file)),
    });
  }
  if (file.type === 'file' && access?.canRead && controller.operations.share) {
    actions.push({
      icon: <Share2 className="size-4" />,
      label: 'Share',
      disabled: pending,
      onClick: () => invokeStorageAction(() => controller.operations.share?.(file)),
    });
  }
  if (access?.canWrite && controller.operations.deleteFile) {
    actions.push({
      icon: <Trash className="size-4" />,
      label: 'Delete',
      variant: 'destructive',
      disabled: pending,
      onClick: () => invokeStorageAction(() => controller.operations.deleteFile?.(file)),
    });
  }
  return actions;
}

function selectIndex(controller: StorageManagementController, index: number) {
  if (index < 0) return;
  if (controller.view === 'drives') {
    const drive = controller.drives[index];
    if (drive) controller.selectDrive(drive.drive.drive_id);
    return;
  }
  const file = controller.files[index];
  if (file) controller.selectFile(file);
}

function focusInlineEditor(id: string) {
  const row = Array.from(document.querySelectorAll<HTMLElement>('[data-storage-item-id]'))
    .find((candidate) => candidate.dataset.storageItemId === id);
  row?.querySelector<HTMLButtonElement>('[data-slot="inline-edit-text"] > button')?.click();
}

function invokeStorageAction(action: (() => void | Promise<void>) | undefined) {
  if (!action) return;
  try {
    void Promise.resolve(action()).catch(() => {
      // Controllers own user-facing error state. Prevent a handled mutation
      // rejection from becoming an unhandled browser promise.
    });
  } catch {
    // Synchronous controller failures are likewise surfaced by its error state.
  }
}
