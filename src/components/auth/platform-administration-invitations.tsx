'use client';

import * as React from 'react';
import type { AuthTenantInvitation } from '../../frontend/client/auth-types';
import type { UsePlatformAdministrationResult } from '../../frontend/client/platform-administration-hooks';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#zero/components/animate-ui/components/radix/alert-dialog';
import { Badge } from '#zero/components/ui/badge';
import { Button } from '#zero/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#zero/components/ui/card';
import { Input } from '#zero/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#zero/components/ui/select';
import { authRoleLabel, createAuthRoleLabelMap } from './auth-role-presentation';
import { writeAuthClipboardText } from './auth-clipboard';
import {
  platformAssignableRoles,
  platformRoleSelection,
} from './platform-administration-role-policy';
import { TenantRolePicker } from './tenant-role-picker';

interface InvitationDelivery {
  email: boolean;
  manual: boolean;
  default: 'email' | 'manual';
}

export function PlatformAdministrationInvitations({
  administration,
  delivery,
  onError,
  onAnnounce,
}: {
  administration: UsePlatformAdministrationResult;
  delivery?: InvitationDelivery;
  onError(value: string | null): void;
  onAnnounce(value: string): void;
}) {
  const capabilities = administration.config?.capabilities;
  const roles = administration.config?.roles ?? [];
  const simpleMode = administration.config?.authorization === 'simple';
  const invitationRoles = platformAssignableRoles(roles);
  const roleLabels = createAuthRoleLabelMap(roles);
  const availableModes = [
    ...(delivery?.email ? ['email' as const] : []),
    ...(delivery?.manual ? ['manual' as const] : []),
  ];
  const [email, setEmail] = React.useState('');
  const [mode, setMode] = React.useState<'email' | 'manual'>(delivery?.default ?? 'manual');
  const [selectedRoles, setSelectedRoles] = React.useState<string[]>([]);
  const [manualToken, setManualToken] = React.useState<string | null>(null);
  const [confirmation, setConfirmation] = React.useState<AuthTenantInvitation | null>(null);
  const [revokeError, setRevokeError] = React.useState<string | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  const effectiveMode = availableModes.includes(mode)
    ? mode
    : availableModes.includes(delivery?.default ?? 'manual')
      ? delivery?.default ?? 'manual'
      : availableModes[0] ?? mode;

  React.useEffect(() => {
    const allowed = new Set(invitationRoles.map((role) => role.key));
    setSelectedRoles((current) => {
      const retained = current.filter((role) => allowed.has(role));
      if (retained.length > 0) return simpleMode ? [retained[0]!] : retained;
      const fallback = invitationRoles.find((role) => role.key === 'administrator')
        ?? invitationRoles[0];
      return fallback ? [fallback.key] : [];
    });
  }, [simpleMode, invitationRoles.map((role) => role.key).join('|')]);

  async function issue(event: React.FormEvent) {
    event.preventDefault();
    const nextEmail = email.trim();
    const roles = platformRoleSelection(selectedRoles);
    if (!nextEmail || !roles) return;
    onError(null);
    setManualToken(null);
    try {
      const result = await administration.issueInvitation({
        email: nextEmail,
        roles,
        delivery: effectiveMode,
      });
      setEmail('');
      if ('token' in result) setManualToken(result.token);
      onAnnounce(`Created platform administration invitation for ${nextEmail}`);
    } catch (cause) {
      onError(message(cause));
    }
  }

  async function revoke() {
    if (!confirmation) return;
    const pending = confirmation;
    onError(null);
    setRevokeError(null);
    try {
      await administration.revokeInvitation(pending.invitationId);
      setConfirmation(null);
      onAnnounce(`Revoked platform administration invitation for ${pending.email}`);
      requestFrame(() => headingRef.current?.focus());
    } catch (cause) {
      const error = message(cause);
      setRevokeError(error);
      onError(error);
    }
  }

  async function copyToken() {
    if (!manualToken) return;
    try {
      await writeAuthClipboardText(manualToken);
      onAnnounce('Copied one-time platform administration invitation token');
    } catch (cause) {
      onError(message(cause));
    }
  }

  return (
    <Card className="overflow-hidden" aria-busy={
      administration.isLoading || administration.isMutating
    }>
      <CardHeader className="border-b border-border/70">
        <CardTitle>Administrator invitations</CardTitle>
        <CardDescription>
          Invitations grant access only to the protected administration organization.
          Administration members follow the platform-administrator MFA policy.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        {capabilities?.canManageInvitations && availableModes.length > 0 && (
          <form className="space-y-3" onSubmit={issue}>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="administrator@example.com"
                aria-label="Administrator invitation email"
                autoComplete="email"
                disabled={administration.isMutating}
                required
              />
              <Select value={effectiveMode} onValueChange={(value) => setMode(value as typeof mode)} disabled={administration.isMutating}>
                <SelectTrigger aria-label="Administrator invitation delivery">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableModes.includes('email') && <SelectItem value="email">Email</SelectItem>}
                  {availableModes.includes('manual') && <SelectItem value="manual">Manual</SelectItem>}
                </SelectContent>
              </Select>
              <Button type="submit" disabled={
                administration.isMutating || !email.trim() || selectedRoles.length === 0
              }>
                Invite administrator
              </Button>
            </div>
            {invitationRoles.length > 0 && (
              <TenantRolePicker
                roles={invitationRoles}
                selected={selectedRoles}
                simple={simpleMode}
                disabled={administration.isMutating}
                legend="Invited platform roles"
                selectLabel="Invitation platform roles"
                actionContext="for administrator invitation"
                onChange={setSelectedRoles}
              />
            )}
          </form>
        )}

        {manualToken && (
          <section className="rounded-md border border-warning/40 bg-warning/10 p-4" aria-labelledby="zero-platform-manual-invitation">
            <h3 id="zero-platform-manual-invitation" className="font-semibold">Copy this one-time invitation token now</h3>
            <p className="mt-1 text-sm">Zero will not show this token again. Share it only with the intended administrator.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
              <Input readOnly value={manualToken} aria-label="One-time administrator invitation token" />
              <Button type="button" variant="outline" onClick={() => void copyToken()}>Copy</Button>
              <Button type="button" variant="ghost" onClick={() => setManualToken(null)}>Dismiss</Button>
            </div>
          </section>
        )}

        <AlertDialog
          open={confirmation !== null}
          onOpenChange={(open) => {
            if (!open && !administration.isMutating) {
              setConfirmation(null);
              setRevokeError(null);
            }
          }}
        >
          {confirmation && (
            <AlertDialogContent onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (triggerRef.current?.isConnected) triggerRef.current.focus();
              else headingRef.current?.focus();
            }}>
              <AlertDialogHeader>
                <AlertDialogTitle>Revoke administrator invitation?</AlertDialogTitle>
                <AlertDialogDescription>{confirmation.email} will no longer be able to use this invitation.</AlertDialogDescription>
              </AlertDialogHeader>
              {revokeError && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                >
                  {revokeError}
                </div>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel asChild><Button type="button" variant="outline" disabled={administration.isMutating}>Cancel</Button></AlertDialogCancel>
                <Button type="button" variant="destructive" disabled={administration.isMutating} onClick={() => void revoke()}>
                  {administration.isMutating ? 'Revoking…' : 'Revoke invitation'}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          )}
        </AlertDialog>

        {administration.isLoading ? (
          <p role="status" aria-live="polite" className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">Loading administrator invitations…</p>
        ) : !capabilities?.canReadInvitations ? (
          <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">Your administration role cannot view invitations.</p>
        ) : (
          <section aria-labelledby="zero-platform-invitations-heading">
            <h3 ref={headingRef} tabIndex={-1} id="zero-platform-invitations-heading" className="text-sm font-semibold">Pending invitations</h3>
            <div className="mt-3 divide-y rounded-md border">
              {administration.invitations.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No pending administrator invitations.</p>
              ) : administration.invitations.map((invitation) => (
                <div key={invitation.invitationId} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{invitation.email}</p>
                    <p className="text-xs text-muted-foreground">Expires {new Date(invitation.expiresAt).toLocaleString()}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{invitation.status}</Badge>
                    {invitation.roles.map((role) => <Badge key={role} variant="outline">{authRoleLabel(role, roleLabels)}</Badge>)}
                    {capabilities.canManageInvitations && invitation.status === 'pending' && (
                      <Button type="button" size="sm" variant="outline" aria-haspopup="dialog" disabled={administration.isMutating} onClick={(event) => {
                        triggerRef.current = event.currentTarget;
                        setRevokeError(null);
                        setConfirmation(invitation);
                      }}>Revoke</Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {administration.invitationPage?.hasMore && (
              <Button type="button" className="mt-3" size="sm" variant="outline" disabled={administration.isLoadingMoreInvitations} onClick={() => void administration.loadMoreInvitations()}>
                {administration.isLoadingMoreInvitations ? 'Loading…' : 'Load more invitations'}
              </Button>
            )}
          </section>
        )}
      </CardContent>
    </Card>
  );
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Platform invitation request failed';
}

function requestFrame(callback: () => void): void {
  if (typeof window === 'undefined') return;
  window.requestAnimationFrame(callback);
}
