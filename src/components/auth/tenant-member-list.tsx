'use client';

import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { Search } from '#zero/components/animate-ui/icons/search';
import type {
  AuthTenantMember,
  AuthTenantMembershipStatus,
} from '../../frontend/client/auth-types';
import { badgeVariants } from '#zero/components/ui/badge';
import { Button } from '#zero/components/ui/button';
import { Input } from '#zero/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#zero/components/ui/select';
import { cn } from '#zero/lib/utils';
import { authRoleLabel } from './auth-role-presentation';
import { tenantMemberName } from './tenant-member-management-parts';

export interface TenantMemberListControlsProps {
  search: string;
  status: AuthTenantMembershipStatus | 'all';
  loadedCount: number;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  searchInputRef?: React.Ref<HTMLInputElement>;
  onSearchChange(value: string): void;
  onStatusChange(value: AuthTenantMembershipStatus | 'all'): void;
  onRefresh(): void;
  onLoadMore(): void;
}

/** Compact server-backed search, status, refresh, and cursor controls. */
export function TenantMemberListControls({
  search,
  status,
  loadedCount,
  hasMore,
  isLoading,
  isLoadingMore,
  searchInputRef,
  onSearchChange,
  onStatusChange,
  onRefresh,
  onLoadMore,
}: TenantMemberListControlsProps) {
  return (
    <div className="flex flex-col gap-2 rounded-md border bg-background p-2 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-[24rem]">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
            <Search size={16} />
          </span>
          <Input
            ref={searchInputRef}
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search members"
            className="h-8 pl-8 text-sm"
            aria-label="Search members"
          />
        </div>
        <Select value={status} onValueChange={(value) => (
          onStatusChange(value as AuthTenantMembershipStatus | 'all')
        )}>
          <SelectTrigger className="h-8 w-full text-sm sm:w-[10rem]" aria-label="Membership status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="removed">Removed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-2 lg:justify-end">
        <span className="text-xs text-muted-foreground">
          {loadedCount === 0 ? 'No members' : `${loadedCount} loaded${hasMore ? '+' : ''}`}
        </span>
        <Button
          type="button"
          size="icon-xs"
          variant="outline"
          onClick={onRefresh}
          disabled={isLoading || isLoadingMore}
          aria-label="Refresh members"
        >
          <RefreshCw className={cn('size-3.5', isLoading && 'animate-spin')} />
        </Button>
        {hasMore && (
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={onLoadMore}
            disabled={isLoading || isLoadingMore}
          >
            {isLoadingMore ? 'Loading…' : 'Load more'}
          </Button>
        )}
      </div>
    </div>
  );
}

export function TenantMemberList({
  members,
  selectedId,
  actorMembershipId,
  roleLabels,
  busy,
  onSelect,
}: {
  members: readonly AuthTenantMember[];
  selectedId: string | null;
  actorMembershipId?: string;
  roleLabels: ReadonlyMap<string, string>;
  busy: boolean;
  onSelect(member: AuthTenantMember): void;
}) {
  return (
    <ul aria-label="Members" className="divide-y divide-border/70">
      {members.map((member) => {
        const selected = member.membershipId === selectedId;
        const isActor = member.membershipId === actorMembershipId;
        return (
          <li key={member.membershipId}>
            <button
              type="button"
              aria-current={selected ? 'true' : undefined}
              disabled={busy}
              className={cn(
                'flex w-full items-start justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-wait',
                selected && 'bg-accent/60',
              )}
              onClick={() => onSelect(member)}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {tenantMemberName(member)}
                  {isActor && <span className="font-normal text-muted-foreground"> (you)</span>}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {member.identity.email}
                </span>
                <span className="mt-1.5 flex flex-wrap gap-1">
                  {member.roles.map((role) => (
                    <span key={role} className={cn(badgeVariants({ variant: 'outline' }), 'h-5 px-1.5 text-[11px]')}>
                      {authRoleLabel(role, roleLabels)}
                    </span>
                  ))}
                </span>
              </span>
              <span
                className={cn(
                  badgeVariants({
                    variant: member.status === 'active'
                      ? 'secondary'
                      : member.status === 'suspended' ? 'warning' : 'outline',
                  }),
                  'h-5 shrink-0 px-1.5 text-[11px]',
                )}
              >
                {member.status}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
