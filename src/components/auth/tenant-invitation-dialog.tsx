'use client';

import * as React from 'react';
import type { AuthTenantRoleDescriptor } from '../../frontend/client/auth-types';
import {
  Dialog,
  DialogClose,
  DialogContent as RadixDialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#zero/components/animate-ui/components/radix/dialog';
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
  onSubmit(event: React.FormEvent): void;
  onCopyToken(): void;
  onDismissToken(): void;
}

export type TenantInvitationDialogBodyProps = Omit<
  TenantInvitationDialogProps,
  'open' | 'onOpenChange'
>;

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
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy || nextOpen) onOpenChange(nextOpen);
      }}
    >
      <RadixDialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        <TenantInvitationDialogBody
          email={email}
          mode={mode}
          availableModes={availableModes}
          roles={roles}
          selectedRoles={selectedRoles}
          simple={simple}
          canChooseRoles={canChooseRoles}
          canIssue={canIssue}
          busy={busy}
          error={error}
          manualToken={manualToken}
          manualTokenError={manualTokenError}
          pendingContent={pendingContent}
          tenantSingular={tenantSingular}
          onEmailChange={onEmailChange}
          onModeChange={onModeChange}
          onRolesChange={onRolesChange}
          onSubmit={onSubmit}
          onCopyToken={onCopyToken}
          onDismissToken={onDismissToken}
        />
      </RadixDialogContent>
    </Dialog>
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
}: TenantInvitationDialogBodyProps) {
  const headingId = React.useId();

  return (
    <>
      <DialogHeader>
        <DialogTitle>{canIssue ? 'Invite member' : 'Pending invitations'}</DialogTitle>
        <DialogDescription>
          {canIssue
            ? `Invite someone to this ${tenantSingular} and choose the access they receive after accepting.`
            : `Review pending invitations for this ${tenantSingular}.`}
        </DialogDescription>
      </DialogHeader>

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

      {!manualToken && (
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
