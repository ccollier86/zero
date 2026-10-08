'use client';

import * as React from 'react';
import type { AuthTenantRoleDescriptor } from '../../frontend/client/auth-types';
import type { DialogContent } from '#zero/components/animate-ui/components/radix/dialog';
import { ControlledModal } from '../../modals/modal-controlled';
import { Input } from '#zero/components/ui/input';
import { TenantRolePicker } from './tenant-role-picker';
import { submitOwnedAuthModal } from './auth-modal-submit';

export interface TenantMemberAddDialogProps {
  open: boolean;
  email: string;
  roles: readonly AuthTenantRoleDescriptor[];
  selectedRoles: readonly string[];
  simple: boolean;
  canChooseRoles: boolean;
  busy: boolean;
  error: string | null;
  tenantSingular: string;
  onOpenChange(open: boolean): void;
  onEmailChange(email: string): void;
  onRolesChange(roles: string[]): void;
  onSubmit(event: React.FormEvent): Promise<boolean>;
  onCloseAutoFocus: React.ComponentProps<typeof DialogContent>['onCloseAutoFocus'];
}

/** Focused member-add workflow; the management surface stays devoted to browsing. */
export function TenantMemberAddDialog({
  open,
  email,
  roles,
  selectedRoles,
  simple,
  canChooseRoles,
  busy,
  error,
  tenantSingular,
  onOpenChange,
  onEmailChange,
  onRolesChange,
  onSubmit,
  onCloseAutoFocus,
}: TenantMemberAddDialogProps) {
  const canSubmit = email.trim().length > 0
    && (!canChooseRoles || selectedRoles.length > 0);
  const pending = React.useRef(false);

  return (
    <ControlledModal open={open} busy={busy} error={error}
      onOpenChange={onOpenChange}
      descriptor={{ title: 'Add member',
        description: `Add an existing Zero account to this ${tenantSingular} and choose its initial access.`,
        onCloseAutoFocus, guard: false,
        actions: [{ id: 'cancel', label: 'Cancel', role: 'cancel', disabled: busy },
          { id: 'add', label: busy ? 'Adding…' : 'Add member', variant: 'primary', submit: true, disabled: busy || !canSubmit }],
        body: context => <form id={`${context.id}-add-member`} className="space-y-4" onSubmit={event => {
          if (!busy) void submitOwnedAuthModal(context, event, pending, async () => {
            if (await onSubmit(event) && !context.signal.aborted) context.accept(undefined);
          });
          else { event.preventDefault(); event.stopPropagation(); }
        }}>
          <Input
            autoFocus
            type="email"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            placeholder="Existing account email"
            aria-label="Existing account email"
            autoComplete="email"
            disabled={busy}
            required
          />

          {canChooseRoles && (
            <TenantRolePicker
              roles={roles}
              selected={selectedRoles}
              simple={simple}
              disabled={busy}
              legend={`Initial ${tenantSingular} roles`}
              selectLabel={`New member ${tenantSingular} role`}
              selectPlaceholder={`Choose ${tenantSingular} role`}
              actionContext="for new member"
              onChange={onRolesChange}
            />
          )}

        </form>,
      }} />
  );
}
