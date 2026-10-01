'use client';

import * as React from 'react';
import { Crown } from 'lucide-react';
import { toast } from 'sonner';
import { useApplicationAccess } from '../../../frontend/client/application-administration-hooks';
import type { AuthApplicationUser } from '../../../frontend/client/auth-application-administration-types';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import type { NavigationAction } from '../../ui/record-navigation-bar';
import { modals } from '../../../modals';
import { ApplicationRoleEditor } from '../../auth/application-access-management-parts';
import { projectAuthRoleAccess } from '../../auth/auth-role-presentation';
import { getAuthDisplayMessage } from '../../auth/auth-error';
import { IdentityUserManagement } from './user-management';
import type { UserManagementProps } from './user-management-props';
import type { UserManagementUser } from './user-management-types';

export interface SingleAdvancedUserManagementProps extends UserManagementProps {
  onActorAuthorizationChanged?: () => void;
}

/**
 * Keeps account administration and advanced application RBAC in one selected-
 * user workflow. The established account action bar remains authoritative.
 */
export function SingleAdvancedUserManagement({
  onActorAuthorizationChanged,
  ...props
}: SingleAdvancedUserManagementProps) {
  const [selected, setSelected] = React.useState<UserManagementUser | null>(null);
  const access = useApplicationAccess({
    enabled: selected !== null,
    limit: 25,
    search: selected?.email,
  });
  const applicationUser = access.users.find((candidate) => (
    candidate.identity.userId === selected?.userId
  )) ?? null;
  const [draftRoles, setDraftRoles] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);
  const rolePanelId = React.useId();

  React.useEffect(() => {
    setDraftRoles(applicationUser?.roles.filter((role) => role !== 'owner') ?? []);
  }, [applicationUser?.identity.userId, applicationUser?.roleRevision,
    applicationUser?.roles.join('|')]);

  const saveRoles = React.useCallback(async () => {
    if (!applicationUser || saving) return;
    setSaving(true);
    try {
      const result = await access.replaceUserRoles(applicationUser.identity.userId, draftRoles);
      toast.success(`Updated application roles for ${displayName(applicationUser)}`);
      if (result.actorAuthorizationChanged) onActorAuthorizationChanged?.();
    } catch (cause) {
      toast.error(getAuthDisplayMessage(cause, 'Failed to update application roles'));
    } finally {
      setSaving(false);
    }
  }, [access.replaceUserRoles, applicationUser, draftRoles,
    onActorAuthorizationChanged, saving]);

  const transferOwnership = React.useCallback(async () => {
    if (!applicationUser || access.isMutating) return;
    const confirmed = await modals.confirm({
      title: 'Transfer application ownership?',
      description: `${displayName(applicationUser)} will become the application owner. Your authorization will refresh immediately.`,
      confirmLabel: 'Transfer ownership',
    });
    if (!confirmed) return;
    try {
      const result = await access.transferOwnership(applicationUser.identity.userId);
      toast.success(`Transferred application ownership to ${displayName(applicationUser)}`);
      if (result.actorAuthorizationChanged) onActorAuthorizationChanged?.();
    } catch (cause) {
      toast.error(getAuthDisplayMessage(cause, 'Failed to transfer application ownership'));
    }
  }, [access, applicationUser, onActorAuthorizationChanged]);

  const additionalDetailContent = React.useCallback((user: UserManagementUser) => (
    <ApplicationAccessDetail
      key={`${user.userId}:${applicationUser?.roleRevision ?? 'none'}`}
      applicationUser={user.userId === selected?.userId ? applicationUser : null}
      loading={access.isLoading}
      denied={access.isDenied}
      error={access.error}
      roles={access.config?.roles ?? []}
      canRead={access.config?.capabilities.canReadUsers === true}
      canManageRoles={access.config?.capabilities.canManageRoles === true}
      canTransferOwnership={access.config?.capabilities.canTransferOwnership === true}
      busy={access.isMutating || saving}
      draftRoles={draftRoles}
      rolePanelId={rolePanelId}
      onDraftRolesChange={setDraftRoles}
      onSaveRoles={() => { void saveRoles(); }}
      onRetry={access.reload}
    />
  ), [access.config, access.error, access.isDenied, access.isLoading,
    access.isMutating, access.reload, applicationUser, draftRoles, rolePanelId,
    saveRoles, saving, selected?.userId]);

  const additionalNavigationActions = React.useCallback((user: UserManagementUser | null) => {
    if (!user || user.userId !== applicationUser?.identity.userId
      || access.config?.capabilities.canTransferOwnership !== true
      || applicationUser.identity.userId === access.config.actor.userId
      || applicationUser.roles.includes('owner')
      || applicationUser.status !== 'active') return [];
    return [{
      icon: <Crown size={20} />,
      label: 'Transfer Ownership',
      disabled: access.isMutating || saving,
      onClick: () => { void transferOwnership(); },
    }] satisfies NavigationAction[];
  }, [access.config, access.isMutating, applicationUser, saving, transferOwnership]);

  return (
    <IdentityUserManagement
      {...props}
      onSelectedUserChange={(user) => {
        setSelected(user);
        props.onSelectedUserChange?.(user);
      }}
      additionalDetailContent={(user) => (
        <>
          {props.additionalDetailContent?.(user)}
          {additionalDetailContent(user)}
        </>
      )}
      additionalNavigationActions={(user) => [
        ...(props.additionalNavigationActions?.(user) ?? []),
        ...additionalNavigationActions(user),
      ]}
    />
  );
}

function ApplicationAccessDetail({
  applicationUser,
  loading,
  denied,
  error,
  roles,
  canRead,
  canManageRoles,
  canTransferOwnership,
  busy,
  draftRoles,
  rolePanelId,
  onDraftRolesChange,
  onSaveRoles,
  onRetry,
}: {
  applicationUser: AuthApplicationUser | null;
  loading: boolean;
  denied: boolean;
  error: string | null;
  roles: NonNullable<ReturnType<typeof useApplicationAccess>['config']>['roles'];
  canRead: boolean;
  canManageRoles: boolean;
  canTransferOwnership: boolean;
  busy: boolean;
  draftRoles: string[];
  rolePanelId: string;
  onDraftRolesChange(roles: string[]): void;
  onSaveRoles(): void;
  onRetry(): void;
}) {
  if (loading) return <AccessState>Loading application access…</AccessState>;
  if (denied || !canRead) return null;
  if (error) {
    return (
      <section className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        <p>{error}</p>
        <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onRetry}>
          Retry access details
        </Button>
      </section>
    );
  }
  if (!applicationUser) return <AccessState>No retained application roles are assigned.</AccessState>;

  const access = projectAuthRoleAccess(roles, applicationUser.roles);
  const editableRoles = roles.filter((role) => role.assignable);
  return (
    <div className="mt-4 space-y-3">
      <section className="rounded-md border border-border/80 bg-muted/20 p-4">
        <h3 className="text-sm font-semibold">Application access</h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {access.assignedRoles.map((role) => (
            <Badge key={role.key} variant="outline">
              {role.label}{role.retired ? ' (retired)' : ''}
            </Badge>
          ))}
          {access.assignedRoles.length === 0 && (
            <span className="text-xs text-muted-foreground">No roles assigned</span>
          )}
        </div>
        <p className="mt-3 text-xs font-medium text-muted-foreground">Effective permissions</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {access.allPermissions
            ? 'All permissions'
            : access.permissions.length > 0
              ? access.permissions.join(' · ')
              : 'No permissions granted'}
        </p>
      </section>
      {canManageRoles && (
        <ApplicationRoleEditor
          user={applicationUser}
          roles={editableRoles}
          draftRoles={draftRoles}
          busy={busy}
          canTransferOwnership={canTransferOwnership}
          roleSelectionChanged={!sameRoles(
            applicationUser.roles.filter((role) => role !== 'owner'),
            draftRoles,
          )}
          rolePanelId={rolePanelId}
          onChange={onDraftRolesChange}
          onSave={onSaveRoles}
        />
      )}
    </div>
  );
}

function AccessState({ children }: { children: React.ReactNode }) {
  return (
    <section className="mt-4 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
      {children}
    </section>
  );
}

function sameRoles(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((role) => right.includes(role));
}

function displayName(user: AuthApplicationUser): string {
  return [user.identity.firstName, user.identity.lastName].filter(Boolean).join(' ')
    || user.identity.username;
}
