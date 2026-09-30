'use client';

import * as React from 'react';
import type {
  AuthTenantInvitation,
  AuthTenantRoleDescriptor,
} from '../../frontend/client/auth-types';
import { Badge } from '#zero/components/ui/badge';
import { Button } from '#zero/components/ui/button';
import { Input } from '#zero/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#zero/components/ui/select';
import { authRoleLabel } from './auth-role-presentation';
import { TenantRolePicker } from './tenant-role-picker';

export function TenantInvitationComposer({
  email,
  mode,
  emailDelivery,
  manualDelivery,
  busy,
  canChooseRoles,
  roles,
  selectedRoles,
  simple,
  tenantSingular,
  onEmailChange,
  onModeChange,
  onRolesChange,
  onSubmit,
}: {
  email: string;
  mode: 'email' | 'manual';
  emailDelivery: boolean;
  manualDelivery: boolean;
  busy: boolean;
  canChooseRoles: boolean;
  roles: readonly AuthTenantRoleDescriptor[];
  selectedRoles: readonly string[];
  simple: boolean;
  tenantSingular: string;
  onEmailChange(value: string): void;
  onModeChange(value: 'email' | 'manual'): void;
  onRolesChange(roles: string[]): void;
  onSubmit(event: React.FormEvent): void;
}) {
  return (
    <form className="space-y-3" onSubmit={onSubmit}>
      <div className="grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
        <Input
          type="email"
          value={email}
          onChange={(event) => onEmailChange(event.target.value)}
          placeholder="person@example.com"
          aria-label="Invitation email"
          autoComplete="email"
          disabled={busy}
          required
        />
        <Select
          value={mode}
          onValueChange={(value) => onModeChange(value as 'email' | 'manual')}
          disabled={busy}
        >
          <SelectTrigger aria-label="Invitation delivery">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {emailDelivery && <SelectItem value="email">Send email</SelectItem>}
            {manualDelivery && <SelectItem value="manual">Copy token</SelectItem>}
          </SelectContent>
        </Select>
        <Button
          type="submit"
          disabled={busy || !email.trim() || (canChooseRoles && selectedRoles.length === 0)}
        >
          Invite
        </Button>
      </div>
      {canChooseRoles && (
        <TenantRolePicker
          roles={roles}
          selected={selectedRoles}
          simple={simple}
          disabled={busy}
          legend="Roles granted when accepted"
          selectLabel={`Invitation ${tenantSingular} role`}
          selectPlaceholder={`Choose ${tenantSingular} role`}
          actionContext="on invitation"
          onChange={onRolesChange}
        />
      )}
    </form>
  );
}

export function ManualInvitationToken({
  token,
  headingId,
  copyError = null,
  inputLabel = 'One-time invitation token',
  recipient = 'intended recipient',
  onCopy,
  onDismiss,
}: {
  token: string;
  headingId: string;
  copyError?: string | null;
  inputLabel?: string;
  recipient?: string;
  onCopy(): void;
  onDismiss(): void;
}) {
  const descriptionId = React.useId();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const copyButtonRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      copyButtonRef.current?.focus();
      return;
    }
    const frame = window.requestAnimationFrame(() => copyButtonRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [token]);

  React.useEffect(() => {
    if (!copyError) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [copyError]);

  return (
    <section
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
      className="rounded-md border border-warning/40 bg-warning/10 p-4 text-warning-foreground dark:border-warning/50 dark:bg-warning/15 dark:text-warning"
    >
      <h3 id={headingId} className="text-sm font-semibold">
        Copy this one-time invitation token now
      </h3>
      <p id={descriptionId} className="mt-1 text-sm">
        Zero will not show this token again. Share it only with the {recipient}.
      </p>
      <Input
        ref={inputRef}
        className="mt-3 font-mono text-xs"
        readOnly
        value={token}
        aria-label={inputLabel}
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onFocus={(event) => event.currentTarget.select()}
      />
      {copyError && (
        <p className="mt-2 text-sm" role="alert">
          {copyError} Use the one-time token field above to copy it manually.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button ref={copyButtonRef} type="button" size="sm" onClick={onCopy}>
          Copy now
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDismiss}>
          Dismiss and clear from page
        </Button>
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        A new one-time invitation token is ready to copy.
      </p>
    </section>
  );
}

export function TenantInvitationList({
  headingId,
  headingRef,
  invitations,
  roleLabels,
  canManage,
  busy,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onRevoke,
}: {
  headingId: string;
  headingRef: React.Ref<HTMLHeadingElement>;
  invitations: readonly AuthTenantInvitation[];
  roleLabels: ReadonlyMap<string, string>;
  canManage: boolean;
  busy: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore(): void;
  onRevoke(invitation: AuthTenantInvitation, trigger: HTMLButtonElement): void;
}) {
  return (
    <section aria-labelledby={headingId}>
      <h3 ref={headingRef} id={headingId} tabIndex={-1} className="text-sm font-semibold">
        Invitations
      </h3>
      <div className="mt-3 divide-y rounded-md border">
        {invitations.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No invitations yet.</p>
        ) : invitations.map((invitation) => (
          <div
            key={invitation.invitationId}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{invitation.email}</p>
              <p className="text-xs text-muted-foreground">
                Expires {new Date(invitation.expiresAt).toLocaleString()}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{invitation.status}</Badge>
              {invitation.roles.map((role) => (
                <Badge key={role} variant="outline">
                  {authRoleLabel(role, roleLabels)}
                </Badge>
              ))}
              {canManage && invitation.status === 'pending' && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  aria-haspopup="dialog"
                  onClick={(event) => onRevoke(invitation, event.currentTarget)}
                >
                  Revoke
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      {hasMore && (
        <Button
          type="button"
          className="mt-3"
          size="sm"
          variant="outline"
          disabled={isLoadingMore}
          onClick={onLoadMore}
        >
          {isLoadingMore ? 'Loading…' : 'Load more invitations'}
        </Button>
      )}
    </section>
  );
}
