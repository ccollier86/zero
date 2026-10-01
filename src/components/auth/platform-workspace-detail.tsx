'use client';

import * as React from 'react';
import { ArrowRight, Building2, Users } from 'lucide-react';
import type { AuthTenantMember } from '../../frontend/client/auth-types';
import { Badge } from '#zero/components/ui/badge';
import { Button } from '#zero/components/ui/button';
import { authRoleLabel } from './auth-role-presentation';
import type { PlatformWorkspaceRow } from './platform-workspace-schema';

/** Compact selected-workspace heading rendered by MasterDetailPage. */
export function PlatformWorkspaceDetailHeader({ item }: { item: PlatformWorkspaceRow }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Building2 className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="truncate text-base font-semibold">{item.name}</h2>
          <WorkspaceStatusBadge status={item.status} />
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">/{item.slug}</p>
      </div>
    </div>
  );
}

/** Compact workspace context and entry point into focused customer-member management. */
export function PlatformWorkspaceDetail(props: {
  workspace: PlatformWorkspaceRow;
  singular: string;
  members: readonly AuthTenantMember[];
  roleLabels: ReadonlyMap<string, string>;
  canReadMembers: boolean;
  canManageMembers: boolean;
  isLoadingMembers: boolean;
  membersError?: string | null;
  onRetryMembers?: () => void;
  peopleTriggerRef?: React.Ref<HTMLButtonElement>;
  onOpenMembers: () => void;
}) {
  const { workspace } = props;

  return (
    <div className="space-y-5">
      <section aria-labelledby={`${workspace.tenantId}-workspace-summary`}>
        <h3
          id={`${workspace.tenantId}-workspace-summary`}
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Workspace
        </h3>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <WorkspaceFact label="Members" value={String(workspace.memberCount)} />
          <WorkspaceFact label="Active members" value={String(workspace.activeMemberCount)} />
          <WorkspaceFact label="Created" value={formatDate(workspace.createdAt)} />
          <WorkspaceFact label="Last updated" value={formatDate(workspace.updatedAt)} />
        </dl>
      </section>

      <section
        className="border-t border-border/70 pt-5"
        aria-labelledby={`${workspace.tenantId}-workspace-members`}
      >
        <div className="flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" />
          <h3 id={`${workspace.tenantId}-workspace-members`} className="text-sm font-semibold">
            Members
          </h3>
          <Badge variant="outline" className="ml-auto font-normal">
            {workspace.activeMemberCount} active
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Open the focused people workspace for this {props.singular} to inspect
          identities, roles, effective permissions, and available account actions.
        </p>

        <WorkspaceMemberList
          members={props.members.slice(0, 3)}
          roleLabels={props.roleLabels}
          canRead={props.canReadMembers}
          isLoading={props.isLoadingMembers}
          error={props.membersError}
          onRetry={props.onRetryMembers}
        />

        {props.canReadMembers && (
          <Button
            ref={props.peopleTriggerRef}
            type="button"
            size="sm"
            className="mt-3 gap-2"
            data-platform-workspace-people-trigger
            disabled={props.isLoadingMembers}
            onClick={props.onOpenMembers}
          >
            {props.canManageMembers ? 'Manage people' : 'View people'}
            <ArrowRight className="size-4" />
          </Button>
        )}
      </section>
    </div>
  );
}

function WorkspaceMemberList(props: {
  members: readonly AuthTenantMember[];
  roleLabels: ReadonlyMap<string, string>;
  canRead: boolean;
  isLoading: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  if (!props.canRead) {
    return (
      <p className="mt-3 text-sm text-muted-foreground">
        Your administration role cannot view customer members.
      </p>
    );
  }
  if (props.isLoading) {
    return (
      <p role="status" aria-live="polite" className="mt-3 text-sm text-muted-foreground">
        Loading members…
      </p>
    );
  }
  if (props.error) {
    return (
      <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <p role="alert" className="text-destructive">{props.error}</p>
        {props.onRetry && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={props.onRetry}
          >
            Retry member list
          </Button>
        )}
      </div>
    );
  }
  if (props.members.length === 0) {
    return <p className="mt-3 text-sm text-muted-foreground">No members match this view.</p>;
  }

  return (
    <div className="mt-3 divide-y divide-border/70 border-y border-border/70">
      {props.members.map((member) => (
        <div
          key={member.membershipId}
          className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{memberName(member)}</p>
            <p className="truncate text-xs text-muted-foreground">{member.identity.email}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className="font-normal">{member.status}</Badge>
            {member.roles.map((role) => (
              <Badge key={role} variant="secondary" className="font-normal">
                {authRoleLabel(role, props.roleLabels)}
              </Badge>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function WorkspaceFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate font-medium">{value}</dd>
    </div>
  );
}

function WorkspaceStatusBadge({ status }: { status: PlatformWorkspaceRow['status'] }) {
  return (
    <Badge
      className="h-5 px-1.5 text-[11px] font-normal"
      variant={status === 'active' ? 'secondary' : status === 'suspended' ? 'warning' : 'outline'}
    >
      {status}
    </Badge>
  );
}

function memberName(member: AuthTenantMember): string {
  return [member.identity.firstName, member.identity.lastName].filter(Boolean).join(' ')
    || member.identity.username;
}

function formatDate(timestamp: number): string {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return 'Unknown';
  return value.toISOString().slice(0, 10);
}
