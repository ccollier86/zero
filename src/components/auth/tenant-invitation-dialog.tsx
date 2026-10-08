'use client';

import * as React from 'react';
import type { AuthTenantRoleDescriptor } from '../../frontend/client/auth-types';
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#zero/components/animate-ui/components/radix/dialog';
import { ControlledModal } from '../../modals/modal-controlled';
import { submitOwnedAuthModal } from './auth-modal-submit';
import { Button } from '#zero/components/ui/button';
import {
  ManualInvitationToken,
  TenantInvitationComposer,
} from './tenant-onboarding-invitations';
import type { TenantInvitationDeliveryMode } from './tenant-invitation-action-policy';

export interface TenantInvitationDialogProps {
  open: boolean;
  email: string;
  mode: TenantInvitationDeliveryMode;
  availableModes: readonly TenantInvitationDeliveryMode[];
  roles: readonly AuthTenantRoleDescriptor[];
  selectedRoles: readonly string[];
  simple: boolean;
  canChooseRoles: boolean;
  canIssue: boolean;
  busy: boolean;
  error: string | null;
  manualToken: string | null;
  manualTokenError: string | null;
  pendingContent?: React.ReactNode;
  tenantSingular: string;
  onOpenChange(open: boolean): void;
  onEmailChange(email: string): void;
  onModeChange(mode: TenantInvitationDeliveryMode): void;
  onRolesChange(roles: string[]): void;
  onSubmit(event: React.FormEvent): void | Promise<void>;
  onCopyToken(): void;
  onDismissToken(): void;
}

export type TenantInvitationDialogBodyProps = Omit<
  TenantInvitationDialogProps,
  'open' | 'onOpenChange'
> & { managed?: boolean; formId?: string };

/** Focused invitation workflow composed beside the member-directory Add action. */
export function TenantInvitationDialog({
  open,
  email,
  mode,
  availableModes,
  roles,
  selectedRoles,
  simple,
  canChooseRoles,
  canIssue,
  busy,
  error,
  manualToken,
  manualTokenError,
  pendingContent,
  tenantSingular,
  onOpenChange,
  onEmailChange,
  onModeChange,
  onRolesChange,
  onSubmit,
  onCopyToken,
  onDismissToken,
}: TenantInvitationDialogProps) {
  const pending = React.useRef(false);
  return (
    <ControlledModal
      open={open} busy={busy} error={error} identityKey={manualToken ? 'issued-token' : canIssue ? 'composer' : 'pending'}
      onOpenChange={nextOpen => {
        if (!busy || nextOpen) onOpenChange(nextOpen);
      }}
      descriptor={{ title: canIssue ? 'Invite member' : 'Pending invitations', size: 'lg', guard: false,
        description: canIssue ? `Invite someone to this ${tenantSingular} and choose the access they receive after accepting.`
          : `Review pending invitations for this ${tenantSingular}.`,
        actions: manualToken ? [] : [{ id: 'cancel', label: canIssue ? 'Cancel' : 'Close', role: 'cancel', disabled: busy },
          ...(canIssue ? [{ id: 'invite', label: 'Invite', variant: 'primary' as const, submit: true,
            disabled: busy || !email.trim() || canChooseRoles && selectedRoles.length === 0 }] : [])],
        body: context => <TenantInvitationDialogBody managed formId={`${context.id}-invite`}
          email={email}
          mode={mode}
          availableModes={availableModes}
          roles={roles}
          selectedRoles={selectedRoles}
          simple={simple}
          canChooseRoles={canChooseRoles}
          canIssue={canIssue}
          busy={busy}
          error={null}
          manualToken={manualToken}
          manualTokenError={manualTokenError}
          pendingContent={pendingContent}
          tenantSingular={tenantSingular}
          onEmailChange={onEmailChange}
          onModeChange={onModeChange}
          onRolesChange={onRolesChange}
          onSubmit={event => { if (!busy) void submitOwnedAuthModal(context, event, pending, () => onSubmit(event));
            else { event.preventDefault(); event.stopPropagation(); } }}
          onCopyToken={onCopyToken}
          onDismissToken={onDismissToken}
        />,
      }} />
  );
}

/** Dialog body is separate so presentation policy stays independently testable. */
export function TenantInvitationDialogBody({
  email,
  mode,
  availableModes,
  roles,
  selectedRoles,
  simple,
  canChooseRoles,
  canIssue,
  busy,
  error,
  manualToken,
  manualTokenError,
  pendingContent,
  tenantSingular,
  onEmailChange,
  onModeChange,
  onRolesChange,
  onSubmit,
  onCopyToken,
  onDismissToken,
  managed = false, formId,
}: TenantInvitationDialogBodyProps) {
  const headingId = React.useId();

  return (
    <>
      {!managed && <DialogHeader>
        <DialogTitle>{canIssue ? 'Invite member' : 'Pending invitations'}</DialogTitle>
        <DialogDescription>
          {canIssue
            ? `Invite someone to this ${tenantSingular} and choose the access they receive after accepting.`
            : `Review pending invitations for this ${tenantSingular}.`}
        </DialogDescription>
      </DialogHeader>}

      {manualToken ? (
        <ManualInvitationToken
          token={manualToken}
          headingId={headingId}
          copyError={manualTokenError}
          recipient="invited person"
          onCopy={onCopyToken}
          onDismiss={onDismissToken}
        />
      ) : canIssue ? (
        <TenantInvitationComposer
          email={email}
          mode={mode}
          emailDelivery={availableModes.includes('email')}
          manualDelivery={availableModes.includes('manual')}
          busy={busy}
          canChooseRoles={canChooseRoles}
          roles={roles}
          selectedRoles={selectedRoles}
          simple={simple}
          tenantSingular={tenantSingular}
          onEmailChange={onEmailChange}
          onModeChange={onModeChange}
          onRolesChange={onRolesChange}
          onSubmit={onSubmit}
          formId={formId} showSubmit={!managed}
        />
      ) : null}

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {pendingContent}

      {!managed && !manualToken && (
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" size="sm" variant="outline" disabled={busy}>
              {canIssue ? 'Cancel' : 'Close'}
            </Button>
          </DialogClose>
        </DialogFooter>
      )}
    </>
  );
}
