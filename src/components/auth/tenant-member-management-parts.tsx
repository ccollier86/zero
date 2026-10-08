'use client';

import * as React from 'react';
import type { AuthTenantMember } from '../../frontend/client/auth-types';
import type { AlertDialogContent } from '#zero/components/animate-ui/components/radix/alert-dialog';
import { ControlledModal } from '../../modals/modal-controlled';

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
  onOpenChange,
}: {
  confirmation: PendingConfirmation;
  tenantSingular: string;
  transferDescription?: string;
  busy: boolean;
  error: string | null;
  onConfirm(): Promise<boolean>;
  onOpenChange(open: boolean): void;
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
    <ControlledModal open busy={busy} error={error} onOpenChange={onOpenChange}
      identityKey={`${confirmation.action}:${confirmation.member.membershipId}`} descriptor={{
        title: heading, description: `${tenantMemberName(confirmation.member)} — ${description}`,
        role: 'alertdialog', size: 'sm', guard: false, initialFocus: 'cancel', onCloseAutoFocus,
        tone: confirmation.action === 'remove' ? 'danger' : 'default',
        actions: [{ id: 'cancel', label: 'Cancel', role: 'cancel', disabled: busy },
          { id: 'confirm', label: action, variant: confirmation.action === 'remove' ? 'danger' : 'primary',
            disabled: busy, onClick: async context => { const accepted = await onConfirm(); return context.signal.aborted ? false : accepted; } }],
      }} />
  );
}

export function tenantMemberName(member: AuthTenantMember): string {
  const full = [member.identity.firstName, member.identity.lastName]
    .filter(Boolean)
    .join(' ');
  return full || member.identity.username;
}
