'use client';

import * as React from 'react';
import type {
  AuthTenantMember,
  AuthTenantMembershipStatus,
} from '../../frontend/client/auth-types';
import { useAuth, useAuthConfig } from '../../frontend/client/auth-hooks';
import {
  usePlatformAdministration,
  type UsePlatformAdministrationResult,
} from '../../frontend/client/platform-administration-hooks';
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
import { Checkbox } from '#zero/components/ui/checkbox';
import { Input } from '#zero/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '#zero/components/ui/select';
import { cn } from '#zero/lib/utils';
import { authRoleLabel, createAuthRoleLabelMap } from './auth-role-presentation';
import { PlatformAdministrationInvitations } from './platform-administration-invitations';
import { platformAssignableRoles } from './platform-administration-role-policy';
import { TenantRolePicker } from './tenant-role-picker';

type MemberAction = 'suspend' | 'remove' | 'transfer';

export interface PlatformAdministrationManagementProps {
  className?: string;
  pageSize?: number;
  title?: string;
  description?: string;
  /** Runs after a successful mutation invalidates the current administration session. */
  onActorSessionInvalidated?: () => void;
}

/**
 * Manages people and invitations inside Zero's protected administration
 * organization. It never accepts an administration tenant ID from the host.
 */
export function PlatformAdministrationManagement(
  props: PlatformAdministrationManagementProps,
) {
  const auth = useAuth();
  const boundary = JSON.stringify([
    auth.user?.userId ?? null,
    auth.activeTenant?.tenantId ?? null,
    auth.activeTenant?.kind ?? null,
  ]);
  return <PlatformAdministrationScope key={boundary} {...props} />;
}

function PlatformAdministrationScope({
  className,
  pageSize = 25,
  title = 'Platform administrators',
  description = 'Manage access to the protected administration organization.',
  onActorSessionInvalidated,
}: PlatformAdministrationManagementProps) {
  const auth = useAuth();
  const publicConfig = useAuthConfig().config;
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState<AuthTenantMembershipStatus | 'all'>('all');
  const boundedPageSize = bounded(pageSize, 25);
  const administration = usePlatformAdministration({
    memberLimit: boundedPageSize,
    memberSearch: search,
    memberStatus: status === 'all' ? undefined : status,
    invitationLimit: boundedPageSize,
    invitationStatus: 'pending',
  });
  const [announcement, setAnnouncement] = React.useState('');
  const [localError, setLocalError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  if (!administration.isAvailable) {
    return (
      <Card className={cn('overflow-hidden', className)}>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
            Switch to the Platform administration organization to use these controls.
            Customer-organization membership never grants platform administration access.
          </p>
        </CardContent>
      </Card>
    );
  }

  const error = localError ?? administration.error;
  return (
    <div className={cn('grid gap-6', className)} aria-busy={
      administration.isLoading || administration.isMutating
    }>
      <Card className="overflow-hidden">
        <CardHeader className="gap-3 border-b border-border/70">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {administration.config && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary">Administration organization</Badge>
              <span>{administration.config.administration.name}</span>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          {error && (
            <div role="alert" className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
              <span>{error}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={administration.isLoading || administration.isMutating}
                onClick={() => {
                  setLocalError(null);
                  administration.reload();
                }}
              >
                Retry
              </Button>
            </div>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              aria-label="Search platform administrators"
              placeholder="Search administrators"
              disabled={administration.isLoading}
            />
            <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
              <SelectTrigger className="sm:w-44" aria-label="Administration membership status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
                <SelectItem value="removed">Removed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <PlatformAdministrationMembers
            administration={administration}
            onError={setLocalError}
            onAnnounce={setAnnouncement}
            onActorSessionInvalidated={onActorSessionInvalidated}
          />
        </CardContent>
      </Card>

      <PlatformAdministrationInvitations
        administration={administration}
        delivery={publicConfig?.tenancy?.onboarding?.invitations.delivery}
        onError={setLocalError}
        onAnnounce={setAnnouncement}
      />
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <span className="sr-only">
        Active scope: {auth.activeTenant?.name ?? 'Platform administration'}
      </span>
    </div>
  );
}

export function PlatformAdministrationMembers({
  administration,
  onError,
  onAnnounce,
  onActorSessionInvalidated,
}: {
  administration: UsePlatformAdministrationResult;
  onError(value: string | null): void;
  onAnnounce(value: string): void;
  onActorSessionInvalidated?: () => void;
}) {
  const capabilities = administration.config?.capabilities;
  const actorMembershipId = administration.config?.administration.membershipId;
  const roles = administration.config?.roles ?? [];
  const simpleMode = administration.config?.authorization === 'simple';
  const assignableRoles = platformAssignableRoles(roles);
  const roleLabels = createAuthRoleLabelMap(roles);
  const [email, setEmail] = React.useState('');
  const [addRoles, setAddRoles] = React.useState<string[]>([]);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draftRoles, setDraftRoles] = React.useState<string[]>([]);
  const [confirmation, setConfirmation] = React.useState<{
    action: MemberAction;
    member: AuthTenantMember;
  } | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);

  const editedMember = administration.members.find((member) => (
    member.membershipId === editing
  )) ?? null;
  React.useEffect(() => {
    setDraftRoles(editedMember?.roles.filter((role) => role !== 'owner') ?? []);
  }, [editedMember?.membershipId, editedMember?.roleRevision]);
  React.useEffect(() => {
    const allowed = new Set(assignableRoles.map((role) => role.key));
    setAddRoles((current) => {
      const retained = current.filter((role) => allowed.has(role));
      if (retained.length > 0) return simpleMode ? [retained[0]!] : retained;
      const fallback = assignableRoles.find((role) => role.key === 'administrator')
        ?? assignableRoles[0];
      return fallback ? [fallback.key] : [];
    });
  }, [simpleMode, assignableRoles.map((role) => role.key).join('|')]);

  async function run(operation: () => Promise<unknown>, success: string): Promise<boolean> {
    onError(null);
    setActionError(null);
    onAnnounce('');
    try {
      await operation();
      onAnnounce(success);
      return true;
    } catch (cause) {
      const error = message(cause);
      setActionError(error);
      onError(error);
      return false;
    }
  }

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    const nextEmail = email.trim();
    if (!nextEmail) return;
    if (await run(
      () => administration.addMember({ email: nextEmail, roles: addRoles }),
      `Added ${nextEmail} to platform administration`,
    )) setEmail('');
  }

  async function saveRoles() {
    if (!editedMember) return;
    const result = await run(
      () => administration.updateMember(editedMember.membershipId, { roles: draftRoles }),
      `Updated platform roles for ${memberName(editedMember)}`,
    );
    if (result && editedMember.membershipId === actorMembershipId) {
      onActorSessionInvalidated?.();
    }
  }

  async function confirmAction() {
    if (!confirmation) return;
    const { action, member } = confirmation;
    const result = await run(
      () => action === 'remove'
        ? administration.removeMember(member.membershipId)
        : action === 'transfer'
          ? administration.transferOwnership(member.membershipId)
          : administration.updateMember(member.membershipId, { status: 'suspended' }),
      platformMemberAnnouncement(action, memberName(member)),
    );
    if (result) {
      setConfirmation(null);
      if (action === 'transfer' || member.membershipId === actorMembershipId) {
        onActorSessionInvalidated?.();
      }
    }
  }

  if (administration.isLoading) {
    return <p role="status" aria-live="polite" className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">Loading platform administrators…</p>;
  }
  if (!administration.config) {
    return <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">Platform administration is unavailable for this session.</p>;
  }
  if (!capabilities?.canReadMembers) {
    return <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">Your administration role cannot view platform administrators.</p>;
  }

  return (
    <section aria-labelledby="zero-platform-administration-members">
      <h3
        ref={headingRef}
        id="zero-platform-administration-members"
        tabIndex={-1}
        className="text-sm font-semibold"
      >
        Administration members
      </h3>
      {capabilities.canManageMembers && (
        <form className="mt-3 space-y-3 rounded-md border border-border/70 p-3" onSubmit={addMember}>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-label="Existing administrator account email"
              placeholder="Existing account email"
              autoComplete="email"
              disabled={administration.isMutating}
              required
            />
            <Button type="submit" disabled={
              administration.isMutating || !email.trim() || addRoles.length === 0
            }>
              Add administrator
            </Button>
          </div>
          {assignableRoles.length > 0 && (
            <TenantRolePicker
              roles={assignableRoles}
              selected={addRoles}
              simple={simpleMode}
              disabled={administration.isMutating}
              legend="Initial platform roles"
              selectLabel="New administrator roles"
              actionContext="for new administrator"
              onChange={setAddRoles}
            />
          )}
        </form>
      )}

      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !administration.isMutating) {
            setConfirmation(null);
            setActionError(null);
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
              <AlertDialogTitle>{memberActionTitle(confirmation.action)}</AlertDialogTitle>
              <AlertDialogDescription>
                {memberActionDescription(confirmation.action, memberName(confirmation.member))}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {actionError && (
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                {actionError}
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button type="button" variant="outline" disabled={administration.isMutating}>Cancel</Button>
              </AlertDialogCancel>
              <Button
                type="button"
                variant={confirmation.action === 'transfer' ? 'default' : 'destructive'}
                disabled={administration.isMutating}
                onClick={() => void confirmAction()}
              >
                {administration.isMutating ? 'Updating…' : memberActionTitle(confirmation.action)}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>

      <div className="mt-3 divide-y divide-border/70 rounded-md border border-border/80">
        {administration.members.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No administration members match this view.</p>
        ) : administration.members.map((member) => {
          const owner = member.roles.includes('owner');
          const actor = member.membershipId === actorMembershipId;
          const canEditRoles = capabilities.canManageMembers && !owner && member.status === 'active';
          return (
            <div key={member.membershipId} className="p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {memberName(member)} {actor && <span className="font-normal text-muted-foreground">(you)</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{member.identity.email}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={member.status === 'active' ? 'secondary' : member.status === 'suspended' ? 'warning' : 'outline'}>{member.status}</Badge>
                  {member.roles.map((role) => <Badge key={role} variant="outline">{authRoleLabel(role, roleLabels)}</Badge>)}
                  {canEditRoles && (
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={administration.isMutating}
                      aria-expanded={editing === member.membershipId}
                      aria-controls={`platform-roles-${member.membershipId}`}
                      onClick={() => setEditing((current) => current === member.membershipId ? null : member.membershipId)}
                    >Roles</Button>
                  )}
                  {capabilities.canManageMembers && member.status === 'active' && !owner && (
                    <Button type="button" size="xs" variant="outline" aria-haspopup="dialog" disabled={administration.isMutating} onClick={(event) => {
                      triggerRef.current = event.currentTarget;
                      setActionError(null);
                      setConfirmation({ action: 'suspend', member });
                    }}>Suspend</Button>
                  )}
                  {capabilities.canManageMembers && member.status === 'suspended' && (
                    <Button type="button" size="xs" variant="outline" disabled={administration.isMutating} onClick={() => void run(
                      () => administration.updateMember(member.membershipId, { status: 'active' }),
                      `Reactivated ${memberName(member)}`,
                    )}>Reactivate</Button>
                  )}
                  {capabilities.canManageMembers && member.status !== 'removed' && !owner && (
                    <Button type="button" size="xs" variant="destructive" aria-haspopup="dialog" disabled={administration.isMutating} onClick={(event) => {
                      triggerRef.current = event.currentTarget;
                      setActionError(null);
                      setConfirmation({ action: 'remove', member });
                    }}>Remove</Button>
                  )}
                  {capabilities.canTransferOwnership && !actor && member.status === 'active' && (
                    <Button type="button" size="xs" variant="outline" aria-haspopup="dialog" disabled={administration.isMutating} onClick={(event) => {
                      triggerRef.current = event.currentTarget;
                      setActionError(null);
                      setConfirmation({ action: 'transfer', member });
                    }}>Transfer ownership</Button>
                  )}
                </div>
              </div>
              {editing === member.membershipId && canEditRoles && (
                <div id={`platform-roles-${member.membershipId}`} className="mt-3 rounded-md border bg-muted/20 p-3">
                  {simpleMode ? (
                    <TenantRolePicker
                      roles={assignableRoles}
                      selected={draftRoles.slice(0, 1)}
                      simple
                      disabled={administration.isMutating}
                      legend={`Platform role for ${memberName(member)}`}
                      selectLabel={`Platform role for ${memberName(member)}`}
                      actionContext={`for ${memberName(member)}`}
                      onChange={setDraftRoles}
                    />
                  ) : (
                    <fieldset className="grid gap-2 sm:grid-cols-2">
                      <legend className="mb-2 text-xs font-medium">Platform roles for {memberName(member)}</legend>
                      {assignableRoles.map((role) => {
                        const checked = draftRoles.includes(role.key);
                        return (
                          <label key={role.key} className="flex items-start gap-2 rounded-md border bg-background p-3 text-sm">
                            <Checkbox
                              checked={checked}
                              disabled={administration.isMutating || !role.grantable}
                              aria-label={`${checked ? 'Remove' : 'Assign'} ${role.label}`}
                              onCheckedChange={(value) => setDraftRoles((current) => value
                                ? [...new Set([...current, role.key])]
                                : current.filter((item) => item !== role.key))}
                            />
                            <span><span className="block font-medium">{role.label}</span>{role.description && <span className="block text-xs text-muted-foreground">{role.description}</span>}</span>
                          </label>
                        );
                      })}
                    </fieldset>
                  )}
                  <Button type="button" size="sm" className="mt-3" disabled={
                    administration.isMutating
                    || draftRoles.length === 0
                    || (simpleMode && draftRoles.length !== 1)
                    || sameRoles(member.roles.filter((role) => role !== 'owner'), draftRoles)
                  } onClick={() => void saveRoles()}>Save roles</Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {administration.memberPage?.hasMore && (
        <Button type="button" className="mt-3" variant="outline" disabled={administration.isLoadingMoreMembers} onClick={() => void administration.loadMoreMembers()}>
          {administration.isLoadingMoreMembers ? 'Loading…' : 'Load more administrators'}
        </Button>
      )}
    </section>
  );
}

/** @internal Stable completion text for destructive administration actions. */
export function platformMemberAnnouncement(action: MemberAction, name: string): string {
  if (action === 'suspend') return `Suspended ${name}`;
  if (action === 'remove') return `Removed ${name} from platform administration`;
  return `Transferred platform ownership to ${name}`;
}

function memberActionTitle(action: MemberAction): string {
  if (action === 'suspend') return 'Suspend administrator';
  if (action === 'remove') return 'Remove administrator';
  return 'Transfer platform ownership';
}

function memberActionDescription(action: MemberAction, name: string): string {
  if (action === 'transfer') {
    return `${name} becomes the protected administration-organization owner. You become an administrator and your current session ends.`;
  }
  return `${name} will ${action === 'suspend' ? 'temporarily lose' : 'lose'} platform administration access.`;
}

function memberName(member: AuthTenantMember): string {
  return [member.identity.firstName, member.identity.lastName].filter(Boolean).join(' ')
    || member.identity.username;
}

function sameRoles(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const values = new Set(left);
  return right.every((role) => values.has(role));
}

function bounded(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(1, Math.trunc(value))) : fallback;
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Platform administration request failed';
}
