'use client';

/** The presentational, transport-free Storage Studio master/detail workspace. */

import * as React from 'react';
import { AlertTriangle, DatabaseZap } from 'lucide-react';
import { Button } from '../ui/button';
import { ListDetailLayout } from '../ui/list-detail-layout';
import { cn } from '../../lib/utils';
import { StorageStudioActionBar } from './storage-studio-action-bar';
import { StorageStudioInspector } from './storage-studio-inspector';
import { StorageStudioList } from './storage-studio-list';
import { StorageStudioToolbar } from './storage-studio-toolbar';
import type {
  StorageManagementController,
  StorageStudioInspectorSlots,
} from './storage-management-controller';

export interface StorageStudioWorkspaceProps {
  readonly controller: StorageManagementController;
  readonly inspectorSlots?: StorageStudioInspectorSlots;
  readonly className?: string;
}

/** Render the complete Storage Studio control plane from controller state. */
export function StorageStudioWorkspace({
  controller,
  inspectorSlots,
  className,
}: StorageStudioWorkspaceProps) {
  const selectedKey = controller.view === 'drives'
    ? controller.selectedDrive?.drive.drive_id
    : controller.selectedFile?.id;
  const hasSelection = Boolean(selectedKey);

  if (controller.status === 'disabled') {
    return (
      <StorageWorkspaceUnavailable
        title="Storage is not enabled"
        description="Enable the storage plugin to provision drives and manage application files."
        className={className}
      />
    );
  }

  return (
    <section
      data-slot="storage-studio-workspace"
      data-view={controller.view}
      className={cn(
        'flex h-full min-h-[36rem] min-w-0 flex-col overflow-hidden rounded-xl border border-border/85 bg-background shadow-sm',
        className,
      )}
    >
      <StorageStudioToolbar controller={controller} />

      {(controller.error || controller.status === 'error') && (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-2 border-b border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">
            {controller.error ?? 'Storage could not be loaded.'}
          </span>
          <Button type="button" size="sm" variant="outline" onClick={controller.refresh}>
            Retry
          </Button>
        </div>
      )}

      <ListDetailLayout
        list={<StorageStudioList controller={controller} />}
        detail={<StorageStudioInspector controller={controller} slots={inspectorSlots} />}
        bottomBar={<StorageStudioActionBar controller={controller} />}
        hasSelection={hasSelection}
        selectedKey={selectedKey}
        listWidth="minmax(0, 3fr)"
        detailWidth="minmax(19rem, 2fr)"
        mobileBackLabel={controller.view === 'drives' ? 'Back to drives' : 'Back to files'}
        onMobileBack={() => {
          if (controller.view === 'drives') controller.selectDrive(null);
          else controller.selectFile(null);
        }}
        className="min-h-0 flex-1"
      />
    </section>
  );
}

function StorageWorkspaceUnavailable({
  title,
  description,
  className,
}: {
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <section
      data-slot="storage-studio-workspace"
      data-state="disabled"
      className={cn(
        'flex min-h-80 items-center justify-center rounded-xl border border-dashed border-border bg-muted/15 p-8 text-center',
        className,
      )}
    >
      <div className="max-w-sm">
        <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl border border-border/80 bg-background text-muted-foreground shadow-sm">
          <DatabaseZap className="size-5" aria-hidden="true" />
        </span>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    </section>
  );
}
