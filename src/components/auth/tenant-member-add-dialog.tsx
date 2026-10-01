'use client';

import * as React from 'react';
import type { AuthTenantRoleDescriptor } from '../../frontend/client/auth-types';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#zero/components/animate-ui/components/radix/dialog';
import { Button } from '#zero/components/ui/button';
import { Input } from '#zero/components/ui/input';
import { TenantRolePicker } from './tenant-role-picker';

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
  onSubmit(event: React.FormEvent): void;
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

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!busy || nextOpen) onOpenChange(nextOpen);
    }}>
      <DialogContent
        className="max-h-[calc(100vh-2rem)] overflow-y-auto"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <form className="space-y-4" onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Add member</DialogTitle>
            <DialogDescription>
              Add an existing Zero account to this {tenantSingular} and choose its
              initial access.
            </DialogDescription>
          </DialogHeader>

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

          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" size="sm" variant="outline" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={busy || !canSubmit}>
              {busy ? 'Adding…' : 'Add member'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
