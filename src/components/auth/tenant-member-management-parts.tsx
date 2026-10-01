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
import { Button } from '#zero/components/ui/button';

export type ConfirmationAction = 'suspend' | 'remove' | 'transfer';

export interface PendingConfirmation {
  action: ConfirmationAction;
  member: AuthTenantMember;
}

interface TenantMemberConfirmationCapabilities {
  canReadMembers: boolean;
  canManageMembers: boolean;
  canTransferOwnership: boolean;
}

/** Fail closed when a member dialog outlives the actor's exact capabilities. */
export function canRetainTenantMemberConfirmation(
  confirmation: PendingConfirmation | null,
  capabilities: TenantMemberConfirmationCapabilities | null | undefined,
): boolean {
  if (!confirmation || !capabilities?.canReadMembers) return false;
  return confirmation.action === 'transfer'
    ? capabilities.canTransferOwnership
    : capabilities.canManageMembers;
}

export function ConfirmationDialog({
  confirmation,
  tenantSingular,
  transferDescription,
  busy,
  error,
  onConfirm,
  onCloseAutoFocus,
}: {
  confirmation: PendingConfirmation;
  tenantSingular: string;
  transferDescription?: string;
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
      transferDescription
        ?? 'You will become a regular member and must sign in again after the transfer.',
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
