'use client';

/** Cursor-safe page controls for the Storage Studio catalog and file list. */

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../ui/button';
import type { StorageManagementController } from './storage-management-controller';

export function StorageStudioPaginationControls({
  controller,
}: {
  readonly controller: StorageManagementController;
}) {
  const drives = controller.view === 'drives';
  const page = drives ? controller.drivePagination : controller.filePagination;
  const previous = drives ? controller.previousDrivePage : controller.previousFilePage;
  const next = drives ? controller.nextDrivePage : controller.nextFilePage;
  if (!page || (!page.hasPrevious && !page.hasNext)) return null;
  const pending = controller.busy || controller.loading || controller.status === 'loading';
  const itemLabel = page.count === 1 ? 'item' : 'items';

  return (
    <nav
      data-slot="storage-studio-pagination"
      aria-label={drives ? 'Drive catalog pages' : 'Folder pages'}
      className="flex shrink-0 items-center justify-between gap-3 border-t border-border/80 bg-muted/15 px-3 py-2"
    >
      <p className="text-xs text-muted-foreground" aria-live="polite">
        Page <span className="font-medium text-foreground">{page.page}</span>
        <span aria-hidden="true"> · </span>
        {page.count} {itemLabel}
        {page.total !== undefined && <> of {page.total}</>}
      </p>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || !page.hasPrevious || !previous}
          aria-label="Previous page"
          onClick={previous}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Previous</span>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || !page.hasNext || !next}
          aria-label="Next page"
          onClick={next}
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
