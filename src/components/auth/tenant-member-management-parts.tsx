'use client';

import * as React from 'react';
import type { AuthTenantMember } from '../../frontend/client/auth-types';
import {
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#zero/components/animate-ui/components/radix/alert-dialog';
import { Badge } from '#zero/components/ui/badge';
import { Button } from '#zero/components/ui/button';
import { cn } from '#zero/lib/utils';
import { authRoleLabel } from './auth-role-presentation';

export type ConfirmationAction = 'suspend' | 'remove' | 'transfer';

export interface PendingConfirmation {
  action: ConfirmationAction;
  member: AuthTenantMember;
}

export function MemberRow({
  member,
  actorMembershipId,
  selected,
  canManage,
  canManageRoles,
  canTransfer,
  busy,
  rolePanelId,
  roleLabels,
  onSelect,
  onReactivate,
  onConfirm,
}: {
  member: AuthTenantMember;
  actorMembershipId?: string;
  selected: boolean;
  canManage?: boolean;
  canManageRoles?: boolean;
  canTransfer?: boolean;
  busy: boolean;
  rolePanelId: string;
  roleLabels: ReadonlyMap<string, string>;
  onSelect(): void;
  onReactivate(): void;
  onConfirm(action: ConfirmationAction, trigger: HTMLButtonElement): void;
}) {
  const isActor = member.membershipId === actorMembershipId;
  const isOwner = member.roles.includes('owner');
  const canSelectRoles = canManageRoles === true
    && !isOwner
    && member.status === 'active';
  return (
    <div className={cn('p-4', selected && 'bg-accent/35')}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <button
          type="button"
          className="min-w-0 text-left disabled:cursor-default"
          onClick={onSelect}
          aria-expanded={canSelectRoles ? selected : undefined}
          aria-controls={canSelectRoles ? rolePanelId : undefined}
          aria-label={canSelectRoles
            ? `${selected ? 'Hide' : 'Manage'} roles for ${tenantMemberName(member)}`
            : undefined}
          disabled={!canSelectRoles || busy}
        >
          <span className="block truncate text-sm font-semibold">
            {tenantMemberName(member)} {isActor && <span className="font-normal text-muted-foreground">(you)</span>}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{member.identity.email}</span>
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={member.status === 'active' ? 'secondary' : member.status === 'suspended' ? 'warning' : 'outline'}>
            {member.status}
          </Badge>
          {member.roles.map((role) => (
            <Badge key={role} variant="outline">{authRoleLabel(role, roleLabels)}</Badge>
          ))}
          {canManageRoles && !isOwner && member.status === 'active' && (
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={onSelect}
              disabled={busy}
              aria-expanded={selected}
              aria-controls={rolePanelId}
              aria-label={`${selected ? 'Hide' : 'Manage'} roles for ${tenantMemberName(member)}`}
            >
              Roles
            </Button>
          )}
          {canManage && member.status === 'active' && !isOwner && (
            <Button type="button" size="xs" variant="outline" aria-haspopup="dialog" onClick={(event) => onConfirm('suspend', event.currentTarget)} disabled={busy}>
              Suspend
            </Button>
          )}
          {canManage && member.status === 'suspended' && (
            <Button type="button" size="xs" variant="outline" onClick={onReactivate} disabled={busy}>
              Reactivate
            </Button>
          )}
          {canManage && member.status !== 'removed' && !isOwner && (
            <Button type="button" size="xs" variant="destructive" aria-haspopup="dialog" onClick={(event) => onConfirm('remove', event.currentTarget)} disabled={busy}>
              Remove
            </Button>
          )}
          {canTransfer && !isActor && member.status === 'active' && (
            <Button type="button" size="xs" aria-haspopup="dialog" onClick={(event) => onConfirm('transfer', event.currentTarget)} disabled={busy}>
              Transfer ownership
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ConfirmationDialog({
  confirmation,
  tenantSingular,
  busy,
  error,
  onConfirm,
  onCloseAutoFocus,
}: {
  confirmation: PendingConfirmation;
  tenantSingular: string;
  busy: boolean;
  error: string | null;
  onConfirm(): void;
  onCloseAutoFocus: React.ComponentProps<typeof AlertDialogContent>['onCloseAutoFocus'];
}) {
  const labels = {
    suspend: ['Suspend member?', `Their active sessions for this ${tenantSingular} will stop working.`, 'Suspend'],
    remove: ['Remove member?', 'This retained membership cannot be reactivated by this screen.', 'Remove'],
    transfer: [
      'Transfer ownership?',
      'You will become a regular member and must sign in again after the transfer.',
      'Transfer ownership',
    ],
  } as const;
  const [heading, description, action] = labels[confirmation.action];
  return (
    <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
      <AlertDialogHeader>
        <AlertDialogTitle>{heading}</AlertDialogTitle>
        <AlertDialogDescription>
          {tenantMemberName(confirmation.member)} — {description}
        </AlertDialogDescription>
      </AlertDialogHeader>
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      <AlertDialogFooter>
        <AlertDialogCancel asChild>
          <Button type="button" size="sm" variant="outline" disabled={busy}>
            Cancel
          </Button>
        </AlertDialogCancel>
        <Button type="button" size="sm" variant={confirmation.action === 'remove' ? 'destructive' : 'default'} onClick={onConfirm} disabled={busy}>
          {busy ? 'Working…' : action}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}

export function tenantMemberName(member: AuthTenantMember): string {
  const full = [member.identity.firstName, member.identity.lastName]
    .filter(Boolean)
    .join(' ');
  return full || member.identity.username;
}
