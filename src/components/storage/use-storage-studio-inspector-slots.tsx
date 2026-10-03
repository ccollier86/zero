'use client';

/**
 * use-storage-studio-inspector-slots.tsx
 *
 * Adapts established settings and permission organisms to native managed-drive
 * mutations. It owns inspector composition only, not transport or policy.
 */

import * as React from 'react';
import type {
  StorageStudioDrive,
  StorageStudioDriveUpdateRequest,
} from '../../storage/storage-studio-contracts';
import { StorageDrivePermissionsPanel } from './storage-drive-permissions-panel';
import { StorageDriveSettingsPanel } from './storage-drive-settings-panel';
import { StorageObjectPermissionsPanel } from './storage-object-permissions-panel';
import {
  parseAllowedMimeTypes,
  parseStorageLimit,
} from './storage-format';
import { toLegacyStorageDriveRow } from './storage-management-legacy-values';
import type {
  StorageManagementController,
  StorageStudioInspectorSlots,
} from './storage-management-controller';

export function useStorageStudioInspectorSlots(
  controller: StorageManagementController,
  updateDrive: (
    drive: StorageStudioDrive,
    changes: Omit<StorageStudioDriveUpdateRequest, 'operationId' | 'expectedRevision'>,
  ) => Promise<void>,
): StorageStudioInspectorSlots {
  return React.useMemo(() => ({
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
        busy={controller.busy}
        disabled={!drive.control.canManage}
        allowPublicVisibility={controller.capabilities?.policy.allowPublicDrives === true}
        onSave={(changes) => updateDrive(drive, {
          ...(typeof changes.name === 'string' ? { name: changes.name } : {}),
          ...(Object.hasOwn(changes, 'max_size_bytes')
            ? { maxSize: parseStorageLimit(changes.max_size_bytes) }
            : {}),
          ...(Object.hasOwn(changes, 'max_file_size_bytes')
            ? { maxFileSize: parseStorageLimit(changes.max_file_size_bytes) }
            : {}),
          ...(Object.hasOwn(changes, 'allowed_mime_types')
            ? { allowedMimeTypes: parseAllowedMimeTypes(changes.allowed_mime_types) }
            : {}),
          ...(Object.hasOwn(changes, 'public')
            ? { public: changes.public === 1 || changes.public === '1' || changes.public === 'true' }
            : {}),
        })}
      />
    ),
    fileAccess: (file) => controller.selectedDrive ? (
      <StorageObjectPermissionsPanel
        driveId={controller.selectedDrive.drive.drive_id}
        file={file}
        access={controller.selectedFileAccess}
        onChanged={controller.refresh}
      />
    ) : null,
  }), [
    controller.busy,
    controller.capabilities,
    controller.refresh,
    controller.selectedDrive,
    controller.selectedFileAccess,
    updateDrive,
  ]);
}
