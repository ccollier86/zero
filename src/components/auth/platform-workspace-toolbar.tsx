'use client';

import * as React from 'react';
import { RefreshCw, Search } from 'lucide-react';
import type { AuthPlatformTenantStatus } from '../../frontend/client/auth-platform-administration-types';
import { Badge } from '#zero/components/ui/badge';
import { Button } from '#zero/components/ui/button';
import { Input } from '#zero/components/ui/input';
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
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
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

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 lg:max-w-[42rem] lg:justify-end">
          <div className="relative min-w-[12rem] flex-1 lg:max-w-[20rem]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={props.search}
              onChange={(event) => props.onSearchChange(event.target.value)}
              aria-label={`Search customer ${props.plural}`}
              placeholder={`Search ${props.plural}`}
              className="h-8 pl-8"
              disabled={!props.canRead}
            />
          </div>
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
        </div>
      </div>
    </div>
  );
}
