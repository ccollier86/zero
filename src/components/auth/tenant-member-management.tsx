'use client';

import * as React from 'react';
import type {
  AuthTenantMember,
  AuthTenantMembershipStatus,
} from '../../frontend/client/auth-types';
import { useAuth, useAuthConfig } from '../../frontend/client/auth-hooks';
import { useTenantMembers } from '../../frontend/client/tenant-administration-hooks';
import {
  AlertDialog,
} from '#zero/components/animate-ui/components/radix/alert-dialog';
import { Button } from '#zero/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#zero/components/ui/card';
import { Input } from '#zero/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#zero/components/ui/select';
import { cn } from '#zero/lib/utils';
import { createAuthRoleLabelMap } from './auth-role-presentation';
import { TenantRolePicker } from './tenant-role-picker';
import { rolesForTenantKind } from './tenant-role-scope';
import {
  ConfirmationDialog,
  MemberRow,
  tenantMemberName,
  type ConfirmationAction,
  type PendingConfirmation,
} from './tenant-member-management-parts';
import { TenantMemberRoleEditor } from './tenant-member-role-editor';
import { AuthConfigLoadState } from './auth-config-load-state';

export { rolesForTenantKind } from './tenant-role-scope';
export {
  assignedRolesAboveGrantCeiling,
  projectTenantMemberRoleChoices,
} from './tenant-member-role-editor';

export interface TenantMemberManagementProps {
  className?: string;
  pageSize?: number;
  title?: string;
  description?: string;
  /** Runs after a successful self-role/status/removal or ownership mutation signs the actor out. */
  onActorSessionInvalidated?: () => void;
}

/** Capability-aware, mode-neutral active-tenant member management. */
export function TenantMemberManagement(props: TenantMemberManagementProps) {
  const auth = useAuth();
  const authConfig = useAuthConfig();
  const publicConfig = authConfig.config;
  const configuredTenantSingular = publicConfig?.tenancy?.terminology?.singular
    ?? 'organization';
  const tenantSingular = auth.activeTenant?.kind === 'administration'
    ? 'platform administration'
    : configuredTenantSingular;
  const boundary = JSON.stringify([
    auth.user?.userId ?? null,
    auth.activeTenant?.tenantId ?? null,
  ]);
  return (
    <TenantMemberManagementScope
      key={boundary}
      {...props}
      tenantSingular={tenantSingular}
      tenantKind={auth.activeTenant?.kind ?? null}
      configState={authConfig}
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
  tenantKind,
  configState,
}: TenantMemberManagementProps & {
  tenantSingular: string;
  tenantKind: 'administration' | 'organization' | null;
  configState: ReturnType<typeof useAuthConfig>;
}) {
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
  const rolePanelBaseId = React.useId();
  const confirmationTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
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
    const changedMemberName = tenantMemberName(selectedMember);
    setLocalError(null);
    setAnnouncement('');
    try {
      await tenant.updateMember(selectedMember.membershipId, { roles: draftRoles });
      if (mounted.current) {
        setAnnouncement(`Updated ${tenantSingular} roles for ${changedMemberName}`);
      }
      if (selectedMember.membershipId === actorMembershipId) {
        onActorSessionInvalidated?.();
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
        setAnnouncement(`Reactivated ${tenantMemberName(member)}`);
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
      let actorSessionInvalidated = false;
      if (pending.action === 'suspend') {
        await tenant.updateMember(pending.member.membershipId, { status: 'suspended' });
        actorSessionInvalidated = pending.member.membershipId === actorMembershipId;
      } else if (pending.action === 'remove') {
        await tenant.removeMember(pending.member.membershipId);
        actorSessionInvalidated = pending.member.membershipId === actorMembershipId;
      } else {
        const result = await tenant.transferOwnership(pending.member.membershipId);
        actorSessionInvalidated = result.actorSessionInvalidated;
      }
      if (mounted.current) {
        setConfirmation(null);
        setAnnouncement(tenantConfirmationAnnouncement(
          pending.action,
          tenantMemberName(pending.member),
          tenantSingular,
        ));
      }
      if (actorSessionInvalidated) onActorSessionInvalidated?.();
    } catch (cause) {
      if (mounted.current) setLocalError(errorMessage(cause, tenantSingular));
    }
  }

  const capabilities = tenant.config?.capabilities;
  const actorMembershipId = tenant.config?.actor.membershipId;
  const roles = rolesForTenantKind(tenant.config?.roles ?? [], tenantKind);
  const roleLabels = createAuthRoleLabelMap(roles);
  const roleChoices = roles.filter((role) => role.assignable);
  const simpleMode = tenant.config?.authorization === 'simple';
  const addRoleChoices = roleChoices.filter((role) => (
    role.grantable && !role.system && role.key !== 'owner'
  ));
  const canChooseAddRoles = capabilities?.canManageRoles === true
    && addRoleChoices.length > 0;
  const canAddMember = capabilities?.canManageMembers === true
    && (tenantKind !== 'administration' || canChooseAddRoles);
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
        {canAddMember && (
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
        {capabilities?.canManageMembers && tenantKind === 'administration'
          && !canChooseAddRoles && (
          <p className="text-sm text-muted-foreground" role="status">
            Adding a platform administrator requires authority to grant at
            least one administration role.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <AuthConfigLoadState
          state={configState}
          loadingMessage="Loading organization terminology…"
          unavailableMessage="Organization terminology could not be loaded. Member controls remain available with default labels."
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            ref={searchInputRef}
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
                } else {
                  searchInputRef.current?.focus();
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
                rolePanelId={`${rolePanelBaseId}-${member.membershipId}`}
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
          <TenantMemberRoleEditor
            member={selectedMember}
            declaredRoles={roles}
            assignableRoles={roleChoices}
            simple={simpleMode}
            draftRoles={draftRoles}
            busy={tenant.isMutating}
            canTransferOwnership={capabilities.canTransferOwnership}
            tenantSingular={tenantSingular}
            rolePanelId={`${rolePanelBaseId}-${selectedMember.membershipId}`}
            roleSelectionChanged={roleSelectionChanged}
            onChange={setDraftRoles}
            onSave={() => void saveRoles()}
          />
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
