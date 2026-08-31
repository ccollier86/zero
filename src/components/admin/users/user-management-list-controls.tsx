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
import { Search } from '../../animate-ui/icons/search';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
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
    <div className={cn('flex flex-col gap-2 rounded-md border bg-background p-2', className)}>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1 sm:max-w-[22rem]">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
              <Search size={16} />
            </span>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search users"
              className="h-8 pl-8 text-sm"
              aria-label="Search users"
            />
          </div>

          <Select
            value={filters.role || 'all'}
            onValueChange={(value) => onRoleChange(value === 'all' ? '' : value)}
          >
            <SelectTrigger className="h-8 w-full text-sm sm:w-[10rem]" aria-label="Filter by role">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
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
            <SelectTrigger className="h-8 w-full text-sm sm:w-[10rem]" aria-label="Filter by status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-2 lg:justify-end">
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
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          <RefreshCw className="size-3 animate-spin" />
          Loading users
        </div>
      )}
    </div>
  );
}
