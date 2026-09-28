'use client';

import * as React from 'react';
import type {
  AuthTenantMember,
  AuthTenantMembershipStatus,
  AuthTenantRoleDescriptor,
} from '../../frontend/client/auth-types';
import { useAuth, useAuthConfig } from '../../frontend/client/auth-hooks';
import { useTenantMembers } from '../../frontend/client/tenant-administration-hooks';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#zero/components/ui/select';
import { cn } from '#zero/lib/utils';
import { authRoleLabel, createAuthRoleLabelMap } from './auth-role-presentation';
import { TenantRolePicker } from './tenant-role-picker';

type ConfirmationAction = 'suspend' | 'remove' | 'transfer';

interface PendingConfirmation {
  action: ConfirmationAction;
  member: AuthTenantMember;
}

export interface TenantMemberManagementProps {
  className?: string;
  pageSize?: number;
  title?: string;
  description?: string;
  onActorSessionInvalidated?: () => void;
}

/** Capability-aware, mode-neutral active-tenant member management. */
export function TenantMemberManagement(props: TenantMemberManagementProps) {
  const auth = useAuth();
  const publicConfig = useAuthConfig().config;
  const tenantSingular = publicConfig?.tenancy?.terminology?.singular ?? 'organization';
  const boundary = JSON.stringify([
    auth.user?.userId ?? null,
    auth.activeTenant?.tenantId ?? null,
  ]);
  return (
    <TenantMemberManagementScope
      key={boundary}
      {...props}
      tenantSingular={tenantSingular}
    />
  );
}

function TenantMemberManagementScope({
  className,
  pageSize = 25,
  title,
  description,
  onActorSessionInvalidated,
  tenantSingular,
}: TenantMemberManagementProps & { tenantSingular: string }) {
  const resolvedTitle = title ?? `${capitalize(tenantSingular)} members`;
  const resolvedDescription = description
    ?? `Manage ${tenantSingular} membership access without changing global accounts or security settings.`;
  const boundedPageSize = Number.isFinite(pageSize)
    ? Math.min(100, Math.max(1, Math.trunc(pageSize)))
    : 25;
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState<AuthTenantMembershipStatus | 'all'>('all');
  const tenant = useTenantMembers({
    limit: boundedPageSize,
    search,
    status: status === 'all' ? undefined : status,
  });
  const [email, setEmail] = React.useState('');
  const [addRoles, setAddRoles] = React.useState<string[]>([]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [draftRoles, setDraftRoles] = React.useState<string[]>([]);
  const [confirmation, setConfirmation] = React.useState<PendingConfirmation | null>(null);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState('');
  const rolePanelId = React.useId();
  const confirmationTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const mounted = React.useRef(true);

  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  React.useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  React.useEffect(() => {
    setSelected(null);
    setConfirmation(null);
    setLocalError(null);
  }, [search, status]);

  const selectedMember = tenant.members.find((member) => member.membershipId === selected) ?? null;
  const roleSelectionChanged = selectedMember
    ? !sameRoleSelection(
        selectedMember.roles.filter((role) => role !== 'owner'),
        draftRoles,
      )
    : false;
  React.useEffect(() => {
    setDraftRoles(selectedMember?.roles.filter((role) => role !== 'owner') ?? []);
    setLocalError(null);
  }, [selectedMember?.membershipId, selectedMember?.roleRevision,
    selectedMember?.roles.join('|')]);

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    const addedEmail = email.trim();
    setLocalError(null);
    setAnnouncement('');
    try {
      await tenant.addMember({
        email: addedEmail,
        ...(canChooseAddRoles ? { roles: addRoles } : {}),
      });
      if (mounted.current) {
        setEmail('');
        setAnnouncement(`Added ${addedEmail} to this ${tenantSingular}`);
      }
    } catch (cause) {
      if (mounted.current) setLocalError(errorMessage(cause, tenantSingular));
    }
  }

  async function saveRoles() {
    if (!selectedMember) return;
    const changedMemberName = memberName(selectedMember);
    setLocalError(null);
    setAnnouncement('');
    try {
      await tenant.updateMember(selectedMember.membershipId, { roles: draftRoles });
      if (mounted.current) {
        setAnnouncement(`Updated ${tenantSingular} roles for ${changedMemberName}`);
      }
    } catch (cause) {
      if (mounted.current) setLocalError(errorMessage(cause, tenantSingular));
    }
  }

  async function reactivate(member: AuthTenantMember) {
    setLocalError(null);
    setAnnouncement('');
    try {
      await tenant.updateMember(member.membershipId, { status: 'active' });
      if (mounted.current) {
        setAnnouncement(`Reactivated ${memberName(member)}`);
      }
    } catch (cause) {
      if (mounted.current) setLocalError(errorMessage(cause, tenantSingular));
    }
  }

  async function confirmAction() {
    if (!confirmation) return;
    const pending = confirmation;
    setLocalError(null);
    setAnnouncement('');
    try {
      if (pending.action === 'suspend') {
        await tenant.updateMember(pending.member.membershipId, { status: 'suspended' });
      } else if (pending.action === 'remove') {
        await tenant.removeMember(pending.member.membershipId);
      } else {
        const result = await tenant.transferOwnership(pending.member.membershipId);
        if (result.actorSessionInvalidated) onActorSessionInvalidated?.();
      }
      if (mounted.current) {
        setConfirmation(null);
        setAnnouncement(tenantConfirmationAnnouncement(
          pending.action,
          memberName(pending.member),
          tenantSingular,
        ));
      }
    } catch (cause) {
      if (mounted.current) setLocalError(errorMessage(cause, tenantSingular));
    }
  }

  const capabilities = tenant.config?.capabilities;
  const actorMembershipId = tenant.config?.actor.membershipId;
  const roles = tenant.config?.roles ?? [];
  const roleLabels = createAuthRoleLabelMap(roles);
  const roleChoices = roles.filter((role) => role.assignable);
  const simpleMode = tenant.config?.authorization === 'simple';
  const addRoleChoices = roleChoices.filter((role) => (
    role.grantable && !role.system && role.key !== 'owner'
  ));
  const canChooseAddRoles = capabilities?.canManageRoles === true
    && addRoleChoices.length > 0;
  const displayedRoleChoices = projectTenantMemberRoleChoices(
    roleChoices,
    selectedMember?.roles ?? [],
    simpleMode,
  );
  const lockedAssignedRoles = simpleMode
    ? assignedRolesAboveGrantCeiling(roleChoices, selectedMember?.roles ?? [])
    : [];
  const declaredRoleKeys = new Set(roles.map((role) => role.key));
  const retiredRoles = selectedMember?.roles.filter((role) => (
    role !== 'owner' && !declaredRoleKeys.has(role)
  )) ?? [];
  const retainedRetiredRoles = retiredRoles.filter((role) => draftRoles.includes(role));
  const retiredRolesRequireOwner = retiredRoles.length > 0
    && capabilities?.canTransferOwnership !== true;

  React.useEffect(() => {
    if (!canChooseAddRoles) {
      setAddRoles([]);
      return;
    }
    const allowed = new Set(addRoleChoices.map((role) => role.key));
    setAddRoles((current) => {
      const retained = current.filter((role) => allowed.has(role));
      if ((simpleMode && retained.length === 1) || (!simpleMode && retained.length > 0)) {
        return retained;
      }
      const defaultRole = addRoleChoices.find((role) => role.key === 'member')
        ?? addRoleChoices[0];
      return defaultRole ? [defaultRole.key] : [];
    });
  }, [
    canChooseAddRoles,
    simpleMode,
    addRoleChoices.map((role) => role.key).join('|'),
  ]);

  return (
    <Card
      className={cn('overflow-hidden', className)}
      aria-busy={tenant.isLoading || tenant.isMutating}
    >
      <CardHeader className="gap-3 border-b border-border/70">
        <div>
          <CardTitle>{resolvedTitle}</CardTitle>
          <CardDescription>{resolvedDescription}</CardDescription>
        </div>
        {capabilities?.canManageMembers && (
          <form className="space-y-3" onSubmit={addMember}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Existing account email"
                aria-label="Existing account email"
                disabled={tenant.isMutating}
                required
              />
              <Button
                type="submit"
                disabled={tenant.isMutating || !email.trim()
                  || (canChooseAddRoles && addRoles.length === 0)}
              >
                Add member
              </Button>
            </div>
            {canChooseAddRoles && (
              <TenantRolePicker
                roles={addRoleChoices}
                selected={addRoles}
                simple={simpleMode}
                disabled={tenant.isMutating}
                legend={`Initial ${tenantSingular} roles`}
                selectLabel={`New member ${tenantSingular} role`}
                selectPlaceholder={`Choose ${tenantSingular} role`}
                actionContext="for new member"
                onChange={setAddRoles}
              />
            )}
          </form>
        )}
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search members"
            aria-label="Search members"
          />
          <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
            <SelectTrigger className="sm:w-44" aria-label="Membership status">
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

        {!confirmation && (tenant.error || localError) && (
          <div role="alert" className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0">{localError ?? tenant.error}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={tenant.isLoading || tenant.isMutating}
              onClick={() => {
                setLocalError(null);
                tenant.reload();
              }}
            >
              Retry
            </Button>
          </div>
        )}

        <AlertDialog
          open={confirmation !== null}
          onOpenChange={(open) => {
            if (!open && !tenant.isMutating) setConfirmation(null);
          }}
        >
          {confirmation && (
            <ConfirmationDialog
              key={`${confirmation.action}:${confirmation.member.membershipId}`}
              confirmation={confirmation}
              tenantSingular={tenantSingular}
              busy={tenant.isMutating}
              error={localError}
              onConfirm={() => void confirmAction()}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (confirmationTriggerRef.current?.isConnected) {
                  confirmationTriggerRef.current.focus();
                }
              }}
            />
          )}
        </AlertDialog>

        {tenant.isLoading ? (
          <div role="status" aria-live="polite" className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            Loading {tenantSingular} members…
          </div>
        ) : !tenant.config ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            {capitalize(tenantSingular)} member controls are available after signing in with active {tenantSingular} access.
          </div>
        ) : !capabilities?.canReadMembers ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            You do not have permission to view {tenantSingular} members.
          </div>
        ) : tenant.members.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            No members match this view.
          </div>
        ) : (
          <div className="divide-y divide-border/70 rounded-md border border-border/80">
            {tenant.members.map((member) => (
              <MemberRow
                key={member.membershipId}
                member={member}
                actorMembershipId={actorMembershipId}
                selected={selected === member.membershipId}
                canManage={capabilities.canManageMembers}
                canManageRoles={capabilities.canManageRoles}
                canTransfer={capabilities.canTransferOwnership}
                busy={tenant.isMutating}
                rolePanelId={rolePanelId}
                roleLabels={roleLabels}
                onSelect={() => setSelected((value) => (
                  value === member.membershipId ? null : member.membershipId
                ))}
                onReactivate={() => void reactivate(member)}
                onConfirm={(action, trigger) => {
                  confirmationTriggerRef.current = trigger;
                  setLocalError(null);
                  setConfirmation({ action, member });
                }}
              />
            ))}
          </div>
        )}

        {selectedMember && capabilities?.canManageRoles
          && !selectedMember.roles.includes('owner') && selectedMember.status === 'active' && (
          <section id={rolePanelId} aria-labelledby={`${rolePanelId}-heading`} className="rounded-md border border-border/80 bg-muted/20 p-4">
            <h3 id={`${rolePanelId}-heading`} className="text-sm font-semibold">
              Roles for {memberName(selectedMember)}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {simpleMode
                ? `Choose the member’s single ${tenantSingular} role.`
                : 'Choose one or more roles within your own authority ceiling.'}
            </p>
            {retiredRoles.length > 0 && (
              <p role="status" className="mt-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
                This member has a retired role that grants no permissions.
                {retiredRolesRequireOwner
                  ? ` The ${tenantSingular} owner must remove it before other role changes can be saved.`
                  : ' Remove every retired role before changing declared roles.'}
              </p>
            )}
            {lockedAssignedRoles.length > 0 && (
              <p role="status" className="mt-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
                This member&apos;s current role is above your assignment ceiling. An
                authorized {tenantSingular} manager must change it.
              </p>
            )}
            {simpleMode ? (
              <div className="mt-3">
                <TenantRolePicker
                  roles={displayedRoleChoices}
                  selected={draftRoles.filter((role) => declaredRoleKeys.has(role))}
                  simple
                  disabled={tenant.isMutating
                    || retainedRetiredRoles.length > 0
                    || lockedAssignedRoles.length > 0}
                  legend={`Member ${tenantSingular} role`}
                  selectLabel={`${capitalize(tenantSingular)} role for ${memberName(selectedMember)}`}
                  selectPlaceholder={`Choose ${tenantSingular} role`}
                  actionContext={`for ${memberName(selectedMember)}`}
                  onChange={(nextRoles) => setDraftRoles((current) => [
                    ...current.filter((role) => !declaredRoleKeys.has(role)),
                    ...nextRoles,
                  ])}
                />
              </div>
            ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {displayedRoleChoices.map((role) => {
                  const checked = draftRoles.includes(role.key);
                  const disabled = tenant.isMutating
                    || !role.grantable
                    || retainedRetiredRoles.length > 0;
                  return (
                    <label key={role.key} className={cn(
                      'flex items-start gap-2 rounded-md border bg-background p-3 text-sm',
                      disabled && 'opacity-65',
                    )}>
                      <Checkbox
                        checked={checked}
                        disabled={disabled}
                        onCheckedChange={(value) => setDraftRoles((current) => (
                          value
                            ? [...new Set([...current, role.key])]
                            : current.filter((item) => item !== role.key)
                        ))}
                        aria-label={`${checked ? 'Remove' : 'Assign'} ${role.label}`}
                      />
                      <span>
                        <span className="block font-medium">{role.label}</span>
                        {role.description && (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {role.description}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            {retiredRoles.length > 0 && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {retiredRoles.map((roleKey) => {
                const checked = draftRoles.includes(roleKey);
                const disabled = tenant.isMutating
                  || capabilities?.canTransferOwnership !== true;
                return (
                  <label key={roleKey} className={cn(
                    'flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm',
                    disabled && 'opacity-65',
                  )}>
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={(value) => setDraftRoles((current) => (
                        value
                          ? [...new Set([...current, roleKey])]
                          : current.filter((item) => item !== roleKey)
                      ))}
                      aria-label={`${checked ? 'Remove' : 'Retain'} retired role ${roleKey}`}
                    />
                    <span>
                      <span className="block font-medium">{roleKey} (retired)</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        This role is no longer declared and grants no permissions.
                        {disabled ? ` Only the ${tenantSingular} owner can remove it.` : ''}
                      </span>
                    </span>
                  </label>
                );
              })}
              </div>
            )}
            {displayedRoleChoices.length === 0 && retiredRoles.length === 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                No assignable roles are within your current authority.
              </p>
            )}
            <Button
              className="mt-3"
              size="sm"
              onClick={() => void saveRoles()}
              disabled={tenant.isMutating
                || !roleSelectionChanged
                || retiredRolesRequireOwner
                || retainedRetiredRoles.length > 0
                || lockedAssignedRoles.length > 0
                || (simpleMode && draftRoles.length !== 1)}
            >
              Save roles
            </Button>
          </section>
        )}

        {tenant.page?.hasMore && (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="outline"
              onClick={() => void tenant.loadMore()}
              disabled={tenant.isLoadingMore}
            >
              {tenant.isLoadingMore ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
      </CardContent>
    </Card>
  );
}

function MemberRow({
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
            ? `${selected ? 'Hide' : 'Manage'} roles for ${memberName(member)}`
            : undefined}
          disabled={!canSelectRoles || busy}
        >
          <span className="block truncate text-sm font-semibold">
            {memberName(member)} {isActor && <span className="font-normal text-muted-foreground">(you)</span>}
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
              aria-label={`${selected ? 'Hide' : 'Manage'} roles for ${memberName(member)}`}
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

function ConfirmationDialog({
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
          {memberName(confirmation.member)} — {description}
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

/** @internal Accessible action-completion copy shared by the live region and tests. */
export function tenantConfirmationAnnouncement(
  action: ConfirmationAction,
  name: string,
  tenantSingular: string,
): string {
  if (action === 'suspend') return `Suspended ${name}`;
  if (action === 'remove') return `Removed ${name} from this ${tenantSingular}`;
  return `Transferred ${tenantSingular} ownership to ${name}`;
}

function memberName(member: AuthTenantMember): string {
  const full = [member.identity.firstName, member.identity.lastName]
    .filter(Boolean)
    .join(' ');
  return full || member.identity.username;
}

function errorMessage(cause: unknown, tenantSingular: string): string {
  return cause instanceof Error
    ? cause.message
    : `${capitalize(tenantSingular)} member update failed`;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function sameRoleSelection(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((role) => rightSet.has(role));
}

/**
 * In simple mode, expose only roles the actor may grant. Keep an already
 * assigned above-ceiling role visible so the locked state is understandable.
 */
export function projectTenantMemberRoleChoices(
  roles: readonly AuthTenantRoleDescriptor[],
  assignedRoles: readonly string[],
  simple: boolean,
): AuthTenantRoleDescriptor[] {
  if (!simple) return [...roles];
  const assigned = new Set(assignedRoles);
  return roles.filter((role) => (
    role.key !== 'owner' && (role.grantable || assigned.has(role.key))
  ));
}

/** @internal Declared assigned roles the actor cannot add or remove. */
export function assignedRolesAboveGrantCeiling(
  roles: readonly AuthTenantRoleDescriptor[],
  assignedRoles: readonly string[],
): string[] {
  const assigned = new Set(assignedRoles);
  return roles
    .filter((role) => role.key !== 'owner' && assigned.has(role.key) && !role.grantable)
    .map((role) => role.key);
}
