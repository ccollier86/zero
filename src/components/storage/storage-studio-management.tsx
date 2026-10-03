'use client';

/**
 * storage-studio-management.tsx
 *
 * Fully wired opt-in Storage Studio organism. The long-standing
 * StorageManagement component remains on its legacy adapter unless a native
 * controller is explicitly supplied.
 */

import { StorageStudioWorkspace } from './storage-studio-workspace';
import {
  useStorageStudioManagement,
  type UseStorageStudioManagementOptions,
} from './use-storage-studio-management';

export interface StorageStudioManagementProps extends UseStorageStudioManagementOptions {
  readonly className?: string;
}

/** Render the adaptive control plane over the native Studio browser SDK. */
export function StorageStudioManagement({
  className,
  ...options
}: StorageStudioManagementProps) {
  const studio = useStorageStudioManagement(options);
  return (
    <>
      <input
        {...studio.uploadInputProps}
        className="sr-only"
        aria-label="Choose files to upload"
      />
      <StorageStudioWorkspace
        controller={studio.controller}
        inspectorSlots={studio.inspectorSlots}
        className={className}
      />
    </>
  );
}
