'use client';

/** Compact navigation, search, and filters for the Storage Studio workspace. */

import * as React from 'react';
import { ArrowLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { DataTableSearch } from '../data-table/data-table-search';
import { Button } from '../ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { cn } from '../../lib/utils';
import type {
  StorageManagementController,
  StorageStudioLifecycleFilter,
  StorageStudioOwnerFilter,
} from './storage-management-controller';

export interface StorageStudioToolbarProps {
  readonly controller: StorageManagementController;
  readonly className?: string;
}

/** Render mode-aware navigation, search, owner, lifecycle, and sort controls. */
export function StorageStudioToolbar({
  controller,
  className,
}: StorageStudioToolbarProps) {
  const filesView = controller.view === 'files';
  const pending = controller.loading || controller.status === 'loading' || controller.busy;

  return (
    <header
      data-slot="storage-studio-toolbar"
      className={cn(
        'flex shrink-0 flex-col gap-2 border-b border-border/85 bg-background px-3 py-2.5 sm:px-4',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {filesView && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={controller.showDriveCatalog}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Drives</span>
          </Button>
        )}

        <StorageStudioBreadcrumbs controller={controller} />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto size-8 shrink-0"
          disabled={pending}
          aria-label="Refresh storage"
          onClick={controller.refresh}
        >
          <RefreshCw
            className={cn('size-4', (controller.loading || controller.status === 'loading') && 'animate-spin')}
            aria-hidden="true"
          />
        </Button>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <DataTableSearch
          value={controller.filters.search}
          onValueChange={controller.setSearch}
          label={filesView ? 'Search files and folders' : 'Search drives'}
          placeholder={filesView ? 'Search files…' : 'Search drives…'}
          maxLength={filesView ? 200 : 120}
          collapsedWidth={112}
          expandedWidth={216}
          className="max-w-full"
        />

        {filesView ? (
          <FileFilters controller={controller} />
        ) : (
          <DriveFilters controller={controller} />
        )}
      </div>
    </header>
  );
}

function StorageStudioBreadcrumbs({
  controller,
}: {
  controller: StorageManagementController;
}) {
  if (controller.view === 'drives') {
    return (
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold">Storage</h2>
        <p className="truncate text-xs text-muted-foreground">Drives and files</p>
      </div>
    );
  }

  return (
    <nav
      aria-label="Storage path"
      className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-sm"
    >
      <button
        type="button"
        className="max-w-44 shrink-0 truncate rounded px-1.5 py-1 font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => controller.openBreadcrumb(null)}
      >
        {controller.selectedDrive?.drive.name ?? 'Drive'}
      </button>
      {controller.breadcrumbs
        .filter((crumb) => crumb.path !== null)
        .map((crumb, index, crumbs) => (
          <React.Fragment key={crumb.path}>
            <ChevronRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            <button
              type="button"
              className={cn(
                'min-w-0 truncate rounded px-1.5 py-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                index === crumbs.length - 1 ? 'font-medium' : 'text-muted-foreground',
              )}
              onClick={() => controller.openBreadcrumb(crumb.path)}
            >
              {crumb.label}
            </button>
          </React.Fragment>
        ))}
    </nav>
  );
}

function DriveFilters({ controller }: { controller: StorageManagementController }) {
  const showOwnerFilter = controller.capabilities?.ownerChoices.length !== 1;
  return (
    <>
      {showOwnerFilter && (
        <Select
          value={controller.filters.owner}
          onValueChange={(value) => controller.setOwnerFilter(value as StorageStudioOwnerFilter)}
        >
          <SelectTrigger className="h-8 w-[8.75rem]" aria-label="Filter drives by owner">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All owners</SelectItem>
            <SelectItem value="organization">Organization</SelectItem>
            <SelectItem value="personal">Personal</SelectItem>
          </SelectContent>
        </Select>
      )}

      <Select
        value={controller.filters.lifecycle}
        onValueChange={(value) => controller.setLifecycleFilter(value as StorageStudioLifecycleFilter)}
      >
        <SelectTrigger className="h-8 w-[8.75rem]" aria-label="Filter drives by status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="ready">Ready</SelectItem>
          <SelectItem value="provisioning">Provisioning</SelectItem>
          <SelectItem value="degraded">Degraded</SelectItem>
          <SelectItem value="suspended">Suspended</SelectItem>
          <SelectItem value="restoring">Restoring</SelectItem>
          <SelectItem value="failed">Failed</SelectItem>
          <SelectItem value="deleting">Deleting</SelectItem>
          <SelectItem value="deleted">Deleted</SelectItem>
        </SelectContent>
      </Select>
    </>
  );
}

function FileFilters({ controller }: { controller: StorageManagementController }) {
  return (
    <>
      <Select
        value={controller.filters.objectType}
        onValueChange={(value) => controller.setObjectTypeFilter(
          value as StorageManagementController['filters']['objectType'],
        )}
      >
        <SelectTrigger className="h-8 w-[8.25rem]" aria-label="Filter storage objects by type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All items</SelectItem>
          <SelectItem value="folder">Folders</SelectItem>
          <SelectItem value="file">Files</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={controller.filters.sortBy}
        onValueChange={(value) => controller.setSortBy(
          value as StorageManagementController['filters']['sortBy'],
        )}
      >
        <SelectTrigger className="h-8 w-[8.25rem]" aria-label="Sort storage objects">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="name">Name</SelectItem>
          <SelectItem value="updated_at">Updated</SelectItem>
          <SelectItem value="created_at">Created</SelectItem>
          <SelectItem value="size">Size</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={controller.filters.sortDir}
        onValueChange={(value) => controller.setSortDir(
          value as StorageManagementController['filters']['sortDir'],
        )}
      >
        <SelectTrigger className="h-8 w-[7.75rem]" aria-label="Sort direction">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="asc">Ascending</SelectItem>
          <SelectItem value="desc">Descending</SelectItem>
        </SelectContent>
      </Select>
    </>
  );
}
