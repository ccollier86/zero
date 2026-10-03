'use client';

/**
 * storage-management.tsx
 *
 * Composes Zero's reusable Storage Studio organism. Native Studio consumers
 * provide a transport-free controller; existing apps transparently use the
 * legacy hook adapter.
 */

import { LegacyStorageManagementAdapter } from './storage-management-legacy-adapter';
import type { StorageManagementProps } from './storage-management-types';
import { StorageStudioWorkspace } from './storage-studio-workspace';

/** Fully wired storage management organism for dashboard embedding. */
export function StorageManagement({
  initialDriveId = null,
  onDriveChange,
  controller,
  inspectorSlots,
  className,
}: StorageManagementProps) {
  if (controller) {
    return (
      <StorageStudioWorkspace
        controller={controller}
        inspectorSlots={inspectorSlots}
        className={className}
      />
    );
  }
  return (
    <LegacyStorageManagementAdapter
      initialDriveId={initialDriveId}
      onDriveChange={onDriveChange}
      className={className}
    />
  );
}
