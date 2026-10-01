'use client';

import * as React from 'react';
import type {
  AuthTenantMember,
  AuthTenantRoleDescriptor,
} from '../../frontend/client/auth-types';
import { Avatar, AvatarFallback } from '#zero/components/ui/avatar';
import { Badge } from '#zero/components/ui/badge';
import { DetailPanel } from '#zero/components/ui/detail-panel';
import {
  authRoleLabel,
  projectAuthRoleAccess,
} from './auth-role-presentation';
import { TenantMemberAccessSummary } from './tenant-member-access-summary';
import { tenantMemberName } from './tenant-member-management-parts';
import { TenantMemberRoleEditor } from './tenant-member-role-editor';

export interface TenantMemberDetailProps {
  member: AuthTenantMember | null;
  actorMembershipId?: string;
  declaredRoles: readonly AuthTenantRoleDescriptor[];
  assignableRoles: readonly AuthTenantRoleDescriptor[];
  roleLabels: ReadonlyMap<string, string>;
  simple: boolean;
  draftRoles: readonly string[];
  busy: boolean;
  canManageRoles: boolean;
  canTransferOwnership: boolean;
  tenantSingular: string;
  rolePanelId: string;
  roleSelectionChanged: boolean;
  detailContent?: React.ReactNode;
  onRolesChange(roles: string[]): void;
  onSaveRoles(): void;
}

/** Selected member identity and tenant-scoped access; global security stays separate. */
export function TenantMemberDetail({
  member,
  actorMembershipId,
  declaredRoles,
  assignableRoles,
  roleLabels,
  simple,
  draftRoles,
  busy,
  canManageRoles,
  canTransferOwnership,
  tenantSingular,
  rolePanelId,
  roleSelectionChanged,
  detailContent,
  onRolesChange,
  onSaveRoles,
}: TenantMemberDetailProps) {
  if (!member) {
    return (
      <DetailPanel isEmpty emptyState={(
        <p className="px-6 text-center text-sm">Select a member to view access details</p>
      )}>
        {null}
      </DetailPanel>
    );
  }

  const isOwner = member.roles.includes('owner');
  const canEditRoles = canManageRoles && !isOwner && member.status === 'active';
  const access = projectAuthRoleAccess(declaredRoles, member.roles);

  return (
    <DetailPanel header={(
      <TenantMemberDetailHeader
        member={member}
        roleLabels={roleLabels}
        isActor={member.membershipId === actorMembershipId}
      />
    )}>
      <div className="space-y-5">
        <TenantMemberIdentity member={member} headingId={`${rolePanelId}-identity`} />
        <TenantMemberMembership
          member={member}
          tenantSingular={tenantSingular}
          headingId={`${rolePanelId}-membership`}
        />

        <TenantMemberAccessSummary
          access={access}
          tenantSingular={tenantSingular}
          headingId={`${rolePanelId}-access`}
        />

        {canEditRoles ? (
          <TenantMemberRoleEditor
            member={member}
            declaredRoles={declaredRoles}
            assignableRoles={assignableRoles}
            simple={simple}
            draftRoles={draftRoles}
            busy={busy}
            canTransferOwnership={canTransferOwnership}
            tenantSingular={tenantSingular}
            rolePanelId={rolePanelId}
            roleSelectionChanged={roleSelectionChanged}
            onChange={onRolesChange}
            onSave={onSaveRoles}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            {isOwner
              ? 'Ownership is managed with the transfer action below.'
              : member.status !== 'active'
                ? 'Roles can be changed after this membership is active.'
                : 'Your current access can view these roles but cannot change them.'}
          </p>
        )}
        {detailContent && (
          <div className="border-t border-border/70 pt-4">{detailContent}</div>
        )}
      </div>
    </DetailPanel>
  );
}

export function TenantMemberDetailHeader({
  member,
  roleLabels,
  isActor,
}: {
  member: AuthTenantMember;
  roleLabels: ReadonlyMap<string, string>;
  isActor: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <Avatar className="size-11">
        <AvatarFallback className="bg-primary text-sm text-primary-foreground">
          {memberInitials(member)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <h2 className="min-w-0 truncate text-base font-semibold">
            {tenantMemberName(member)}
            {isActor && <span className="font-normal text-muted-foreground"> (you)</span>}
          </h2>
          <Badge
            className="h-5 px-1.5 text-[11px]"
            variant={member.status === 'active'
              ? 'secondary'
              : member.status === 'suspended' ? 'warning' : 'outline'}
          >
            {member.status}
          </Badge>
          {member.roles.slice(0, 2).map((role) => (
            <Badge key={role} className="h-5 px-1.5 text-[11px]" variant="outline">
              {authRoleLabel(role, roleLabels)}
            </Badge>
          ))}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {member.identity.username.toLowerCase() === member.identity.email.toLowerCase()
            ? member.identity.email
            : `@${member.identity.username} · ${member.identity.email}`}
        </p>
      </div>
    </div>
  );
}

function TenantMemberIdentity({
  member,
  headingId,
}: {
  member: AuthTenantMember;
  headingId: string;
}) {
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="text-sm font-semibold">Identity</h3>
      <dl className="mt-2 grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
        <DetailValue label="Username" value={member.identity.username} />
        <DetailValue label="Email" value={member.identity.email} />
        <DetailValue label="First name" value={member.identity.firstName ?? 'Not set'} />
        <DetailValue label="Last name" value={member.identity.lastName ?? 'Not set'} />
      </dl>
    </section>
  );
}

function TenantMemberMembership({
  member,
  tenantSingular,
  headingId,
}: {
  member: AuthTenantMember;
  tenantSingular: string;
  headingId: string;
}) {
  return (
    <section className="border-t border-border/70 pt-4" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-sm font-semibold">
        {capitalize(tenantSingular)} membership
      </h3>
      <dl className="mt-2 grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
        <DetailValue label="Status" value={member.status} />
        <DetailValue label="Joined" value={formatMembershipDate(member.joinedAt)} />
        <DetailValue label="Last updated" value={formatMembershipDate(member.updatedAt)} />
        <DetailValue label="Account ID" value={member.identity.userId} mono />
        <DetailValue label="Membership ID" value={member.membershipId} mono />
      </dl>
    </section>
  );
}

function DetailValue({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={mono ? 'mt-0.5 truncate font-mono text-xs' : 'mt-0.5 truncate'} title={value}>
        {value}
      </dd>
    </div>
  );
}

/** @internal Stable UTC formatting avoids server/client timezone disagreement. */
export function formatMembershipDate(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return 'Unknown';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(date);
}

function memberInitials(member: AuthTenantMember): string {
  const source = [member.identity.firstName, member.identity.lastName]
    .filter(Boolean)
    .join(' ') || member.identity.username;
  return source.split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase();
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}
