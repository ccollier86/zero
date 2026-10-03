'use client';

/** Selection-aware drive and file inspector for the Storage Studio workspace. */

import { ShieldCheck } from 'lucide-react';
import { cn } from '../../lib/utils';
import type {
  StorageManagementController,
  StorageStudioInspectorSlots,
} from './storage-management-controller';
import { StorageStudioDriveInspector } from './storage-studio-drive-inspector';
import { StorageStudioFileInspector } from './storage-studio-file-inspector';

export interface StorageStudioInspectorProps {
  readonly controller: StorageManagementController;
  readonly slots?: StorageStudioInspectorSlots;
  readonly className?: string;
}

/** Render the inspector appropriate to the current drive or object selection. */
export function StorageStudioInspector({
  controller,
  slots,
  className,
}: StorageStudioInspectorProps) {
  const selection = controller.view === 'drives'
    ? controller.selectedDrive
    : controller.selectedFile;

  if (!selection) {
    return (
      <aside
        data-slot="storage-studio-inspector"
        data-empty="true"
        className={cn('flex h-full min-h-64 items-center justify-center bg-muted/15 p-6', className)}
      >
        <div className="max-w-xs text-center text-muted-foreground">
          <ShieldCheck className="mx-auto mb-3 size-7 opacity-55" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">Nothing selected</p>
          <p className="mt-1 text-xs">
            Select {controller.view === 'drives' ? 'a drive' : 'a file or folder'} to inspect access, settings, and activity.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside
      data-slot="storage-studio-inspector"
      data-kind={controller.view === 'drives' ? 'drive' : 'file'}
      className={cn('flex h-full min-h-0 flex-col overflow-hidden bg-background', className)}
    >
      {controller.view === 'drives' && controller.selectedDrive ? (
        <StorageStudioDriveInspector controller={controller} drive={controller.selectedDrive} slots={slots} />
      ) : controller.selectedFile ? (
        <StorageStudioFileInspector controller={controller} file={controller.selectedFile} slots={slots} />
      ) : null}
    </aside>
  );
}
