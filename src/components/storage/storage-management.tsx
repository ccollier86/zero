'use client';

/**
 * storage-management.tsx
 *
 * Composes Zero's reusable storage management organism. This file owns the
 * high-level drive/file view switch only; drive and file actions live in their
 * dedicated child components.
 */

import * as React from 'react';
import { StorageDriveList } from './storage-drive-list';
import { StorageFileBrowser } from './storage-file-browser';
import type { StorageManagementProps, StorageManagementView } from './storage-management-types';

/** Fully wired storage management organism for dashboard embedding. */
export function StorageManagement({
  initialDriveId = null,
  onDriveChange,
  className,
}: StorageManagementProps) {
  const [selectedDriveId, setSelectedDriveId] = React.useState<string | null>(initialDriveId);
  const [view, setView] = React.useState<StorageManagementView>(
    initialDriveId ? 'files' : 'drives',
  );

  const browseDrive = React.useCallback(
    (driveId: string) => {
      setSelectedDriveId(driveId);
      setView('files');
      onDriveChange?.(driveId);
    },
    [onDriveChange],
  );

  const backToDrives = React.useCallback(() => {
    setSelectedDriveId(null);
    setView('drives');
    onDriveChange?.(null);
  }, [onDriveChange]);

  if (view === 'files' && selectedDriveId) {
    return (
      <StorageFileBrowser
        driveId={selectedDriveId}
        onBack={backToDrives}
        className={className}
      />
    );
  }

  return <StorageDriveList className={className} onBrowse={browseDrive} />;
}
