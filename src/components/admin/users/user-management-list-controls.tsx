'use client';

/**
 * user-management-list-controls.tsx
 *
 * Renders search, filter, refresh, and backend-page controls for the admin
 * user-management organism. This file owns list control UI only; user loading
 * and mutation stay in use-admin-users.
 */

import * as React from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { DataTableSearch } from '../../data-table/data-table-search';
import { DataTableControls } from '../../data-table/data-table-controls';
import { Button } from '../../ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';
import { cn } from '../../../lib/utils';
import type { AuthAdminUserPage } from '../../../frontend/client/auth-client';
import {
  getAdminUserPageWindow,
  type UserManagementFilters,
  type UserManagementStatusFilter,
} from './user-management-pagination';
import type { UserRoleOption } from './user-management-types';

export interface UserManagementListControlsProps {
  filters: UserManagementFilters;
  page: AuthAdminUserPage | null;
  roleOptions: readonly UserRoleOption[];
  roleFieldLabel?: string;
  isLoading?: boolean;
  onSearchChange: (search: string) => void;
  onRoleChange: (role: string) => void;
  onStatusChange: (status: UserManagementStatusFilter) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onRefresh: () => void;
  className?: string;
}

/** Render server-backed admin user list controls. */
export function UserManagementListControls({
  filters,
  page,
  roleOptions,
  roleFieldLabel = 'Role',
  isLoading = false,
  onSearchChange,
  onRoleChange,
  onStatusChange,
  onPreviousPage,
  onNextPage,
  onRefresh,
  className,
}: UserManagementListControlsProps) {
  const pageWindow = getAdminUserPageWindow(page);
  const [search, setSearch] = React.useState(filters.search);

  React.useEffect(() => {
    setSearch(filters.search);
  }, [filters.search]);

  React.useEffect(() => {
    const handle = globalThis.setTimeout(() => {
      if (search !== filters.search) onSearchChange(search);
    }, 250);

    return () => globalThis.clearTimeout(handle);
  }, [filters.search, onSearchChange, search]);

  return (
    <DataTableControls
      aria-label="User directory controls"
      className={cn('rounded-md border bg-background p-2', className)}
      search={(
        <DataTableSearch
          value={search}
          onValueChange={setSearch}
          placeholder="Search users…"
          label="Search users"
          collapsedWidth={112}
          expandedWidth={216}
          className="max-w-full"
        />
      )}
      controls={(
        <>
          <Select
            value={filters.role || 'all'}
            onValueChange={(value) => onRoleChange(value === 'all' ? '' : value)}
          >
            <SelectTrigger
              className="h-8 w-[11rem] max-w-full text-sm"
              aria-label={`Filter by ${roleFieldLabel.toLowerCase()}`}
            >
              <SelectValue placeholder={roleFieldLabel} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All {roleFieldLabel.toLowerCase()}s</SelectItem>
              {roleOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.status}
            onValueChange={(value) => onStatusChange(value as UserManagementStatusFilter)}
          >
            <SelectTrigger className="h-8 w-[10rem] max-w-full text-sm" aria-label="Filter by status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
            </SelectContent>
          </Select>
        </>
      )}
      actions={(
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 text-sm text-muted-foreground">{pageWindow.label}</span>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              size="icon-xs"
              variant="outline"
              onClick={onRefresh}
              disabled={isLoading}
              aria-label="Refresh users"
            >
              <RefreshCw className={cn('size-3.5', isLoading && 'animate-spin')} />
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="outline"
              onClick={onPreviousPage}
              disabled={isLoading || !pageWindow.canPrevious}
              aria-label="Previous user page"
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="outline"
              onClick={onNextPage}
              disabled={isLoading || !pageWindow.canNext}
              aria-label="Next user page"
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
      supplemental={isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          <RefreshCw className="size-3 animate-spin" />
          Loading users
        </div>
      ) : undefined}
    />
  );
}
