'use client';

/**
 * use-storage-studio-selected-drive.ts
 *
 * Resolves a selected managed drive that may not be present on the current
 * catalog page. It owns only the scoped detail read and stale-result cleanup.
 */

import * as React from 'react';
import type { StorageStudioDrive } from '../../storage/storage-studio-contracts';
import type { AuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import type { StorageStudioSdkSurface } from '../../frontend/client/storage-studio-client';

export function useSelectedStorageStudioDrive(input: {
  readonly catalogDrives: readonly StorageStudioDrive[];
  readonly selectedDriveId: string | null;
  readonly surface: StorageStudioSdkSurface | null;
  readonly boundary: AuthorizationScopeBoundary;
}): StorageStudioDrive | null {
  const catalogDrive = input.catalogDrives.find(
    (drive) => drive.drive.drive_id === input.selectedDriveId,
  ) ?? null;
  const requestKey = selectedDriveRequestKey(input.boundary.key, input.selectedDriveId);
  const [detail, setDetail] = React.useState<Readonly<{
    requestKey: string;
    drive: StorageStudioDrive;
  }> | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    if (catalogDrive || !input.selectedDriveId || !input.surface || !input.boundary.ready) {
      return () => controller.abort();
    }
    input.surface.setScope(input.boundary.key);
    input.surface.getDrive(input.selectedDriveId, { signal: controller.signal })
      .then((drive) => {
        if (!controller.signal.aborted) setDetail(Object.freeze({
          requestKey,
          drive,
        }));
      })
      .catch(() => {
        // Catalog-level loading/error state remains authoritative. A missing
        // selection is rendered as no selection rather than leaking details.
      });
    return () => controller.abort();
  }, [
    catalogDrive,
    input.boundary.key,
    input.boundary.ready,
    input.selectedDriveId,
    input.surface,
    requestKey,
  ]);

  return catalogDrive
    ?? (detail?.requestKey === requestKey && input.boundary.ready ? detail.drive : null);
}

function selectedDriveRequestKey(scopeKey: string, driveId: string | null): string {
  return `${scopeKey}\0${driveId ?? ''}`;
}
