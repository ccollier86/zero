'use client';

/** Workspace directory context and filters; server state stays in the controller. */

import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import type { AuthPlatformTenantStatus } from '../../frontend/client/auth-platform-administration-types';
import { Badge } from '#zero/components/ui/badge';
import { Button } from '#zero/components/ui/button';
import { DataTableSearch } from '../data-table/data-table-search';
import { DataTableControls } from '../data-table/data-table-controls';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#zero/components/ui/select';

export type PlatformWorkspaceStatusFilter = AuthPlatformTenantStatus | 'all';

/** Compact directory context and server-backed filters. */
export function PlatformWorkspaceToolbar(props: {
  titleId: string;
  descriptionId: string;
  title: string;
  description: string;
  scopeName: string;
  singular: string;
  plural: string;
  search: string;
  status: PlatformWorkspaceStatusFilter;
  canRead: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: PlatformWorkspaceStatusFilter) => void;
  onReload: () => void;
  onLoadMore: () => void;
}) {
  return (
    <div className="shrink-0 border-b border-border/70 px-3 py-3">
      <div className="flex flex-col gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 id={props.titleId} className="truncate text-base font-semibold">{props.title}</h2>
            <Badge variant="secondary" className="max-w-full truncate font-normal">
              {props.scopeName}
            </Badge>
          </div>
          <p id={props.descriptionId} className="mt-0.5 text-xs text-muted-foreground">
            {props.description}
          </p>
        </div>

        <DataTableControls
          aria-label={`${props.title} controls`}
          search={(
            <DataTableSearch
              value={props.search}
              onValueChange={props.onSearchChange}
              label={`Search customer ${props.plural}`}
              placeholder={`Search ${props.plural}…`}
              collapsedWidth={112}
              expandedWidth={216}
              disabled={!props.canRead}
              className="max-w-full"
            />
          )}
          controls={(
            <Select
              value={props.status}
              onValueChange={(value) => props.onStatusChange(value as PlatformWorkspaceStatusFilter)}
              disabled={!props.canRead}
            >
              <SelectTrigger
                className="h-8 w-36"
                aria-label={`Customer ${props.singular} status`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          )}
          actions={(
            <>
              {props.canRead && props.hasMore && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={props.isLoadingMore}
                  onClick={props.onLoadMore}
                >
                  {props.isLoadingMore ? 'Loading…' : 'Load more'}
                </Button>
              )}
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={props.isLoading}
                aria-label={`Refresh customer ${props.plural}`}
                onClick={props.onReload}
              >
                <RefreshCw className={props.isLoading ? 'animate-spin' : undefined} />
              </Button>
            </>
          )}
        />
      </div>
    </div>
  );
}
