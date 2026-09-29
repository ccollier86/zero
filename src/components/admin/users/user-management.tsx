'use client';

/**
 * user-management.tsx
 *
 * Composes Zero's admin-user data, policy, actions, readiness, and detail UI.
 * Focused sibling modules own each responsibility; auth transport stays in the SDK.
 */

import * as React from 'react';
import { useCurrentUser } from '../../../frontend/client/hooks';
import { cn } from '../../../lib/utils';
import { normalizeRoleOptions } from './user-management-mappers';
import {
  createUserManagementSchema,
  getUserManagementEditableFields,
} from './user-management-schema';
import { canCreateManagedUser } from './user-management-action-policy';
import { UserManagementDetail } from './user-management-detail';
import type { UserManagementProps } from './user-management-props';
import { UserManagementToolbar } from './user-management-toolbar';
import { useAdminUsers } from './use-admin-users';
import { useUserCreateDialog } from './use-user-create-dialog';
import { useUserManagementMutations } from './use-user-management-mutations';
import { useUserManagementNavigationActions } from './use-user-management-navigation-actions';
import { useUserMfaStatus } from './use-user-mfa-status';

export type { UserManagementProps } from './user-management-props';

/** Render the self-wired or explicitly controlled admin user-management organism. */
export function UserManagement({
  data,
  config: configProp,
  roleOptions: roleOptionsProp,
  pageSize,
  onCreate,
  onUpdate,
  onDeleteProperty,
  onDelete,
  className,
}: UserManagementProps) {
  const controlled = data !== undefined;
  const live = useAdminUsers({
    enabled: !controlled || configProp === undefined,
    loadUsers: !controlled,
    pageSize,
  });
  const users = data ?? live.users;
  const config = configProp !== undefined ? configProp : live.config;
  const currentUser = useCurrentUser();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [securityRevision, setSecurityRevision] = React.useState(0);
  const selectedUser = React.useMemo(
    () => users.find((user) => user.id === selectedId) ?? null,
    [selectedId, users],
  );
  const roleOptions = React.useMemo(
    () => normalizeRoleOptions(users, roleOptionsProp, config?.tenancy?.mode ?? 'single'),
    [config?.tenancy?.mode, roleOptionsProp, users],
  );
  const roleFieldLabel = config?.tenancy?.mode === 'multi' ? 'Platform role' : 'Role';
  const schema = React.useMemo(
    () => createUserManagementSchema(roleOptions, roleFieldLabel),
    [roleFieldLabel, roleOptions],
  );
  const canManageSelectedLiveUser = config?.capabilities.canManageUsers === true
    && (selectedUser?.role !== 'admin'
      || config.capabilities.canManageGlobalAdmins === true);
  const canUpdate = controlled ? Boolean(onUpdate) : canManageSelectedLiveUser;
  const editableFields = React.useMemo(() => getUserManagementEditableFields(config, {
    canUpdate,
    isSelf: selectedUser?.userId === currentUser?.userId,
    enforceCapabilities: !controlled,
  }), [canUpdate, config, controlled, currentUser?.userId, selectedUser?.userId]);

  const mutations = useUserManagementMutations({
    controlled,
    live,
    handlers: { onCreate, onUpdate, onDeleteProperty, onDelete },
  });
  const createRoleOptions = React.useMemo(() => (
    controlled || config?.capabilities.canManageGlobalAdmins === true
      ? roleOptions
      : roleOptions.filter((option) => option.value !== 'admin')
  ), [config?.capabilities.canManageGlobalAdmins, controlled, roleOptions]);
  const openCreateDialog = useUserCreateDialog({
    config,
    roleOptions: createRoleOptions,
    allowGlobalAdminRole: controlled
      || config?.capabilities.canManageGlobalAdmins === true,
    createUser: mutations.createUser,
  });
  const mfaLoader = useStableMfaLoader(live.getMfaStatus);
  const mfa = useUserMfaStatus({
    user: selectedUser,
    enabled: !controlled && canManageSelectedLiveUser
      && config?.capabilities.mfa === true,
    revision: securityRevision,
    load: mfaLoader,
  });
  const operations = React.useMemo(() => pickActionOperations(live), [live]);
  const securityChanged = React.useCallback(() => setSecurityRevision((value) => value + 1), []);
  const { navigationActions } = useUserManagementNavigationActions({
    config,
    mfaStatus: mfa.status,
    currentUserId: currentUser?.userId ?? null,
    controlled,
    controlledDelete: Boolean(onDelete),
    operations,
    deleteUser: mutations.deleteUser,
    onSecurityChanged: securityChanged,
  });
  const canCreate = controlled ? Boolean(onCreate) : canCreateManagedUser(config);
  const creationDisabled = (!controlled && config === null) || live.isLoading || !canCreate;
  const primaryAction = !canCreate ? undefined : {
    label: config?.registration.mode === 'disabled' ? 'Creation Disabled'
      : live.isLoading ? 'Loading' : 'Add User',
    disabled: creationDisabled,
    onClick: openCreateDialog,
  };

  return (
    <div className={cn('flex h-full min-h-[32rem] flex-col gap-3', className)}>
      <UserManagementToolbar
        controlled={controlled}
        config={config}
        live={live}
        roleOptions={roleOptions}
        roleFieldLabel={roleFieldLabel}
      />
      <UserManagementDetail
        schema={schema}
        users={users}
        config={config}
        roleOptions={roleOptions}
        editableFields={editableFields}
        controlled={controlled}
        canUpdate={canUpdate}
        canDeleteProperty={!controlled || Boolean(onDeleteProperty)}
        mfaStatus={mfa.status}
        mfaLoading={mfa.loading}
        mfaError={mfa.error}
        navigationActions={navigationActions}
        primaryAction={primaryAction}
        updateUser={mutations.updateUser}
        deleteProperty={mutations.deleteProperty}
        onSelectedIdChange={setSelectedId}
      />
    </div>
  );
}

function useStableMfaLoader(load: ReturnType<typeof useAdminUsers>['getMfaStatus']) {
  const loadRef = React.useRef(load);
  loadRef.current = load;
  return React.useCallback((userId: string) => loadRef.current(userId), []);
}

function pickActionOperations(live: ReturnType<typeof useAdminUsers>) {
  return {
    sendSetupEmail: live.sendSetupEmail,
    sendPasswordReset: live.sendPasswordReset,
    clearPasswordChangeRequirement: live.clearPasswordChangeRequirement,
    resetPassword: live.resetPassword,
    sendVerificationEmail: live.sendVerificationEmail,
    verifyEmail: live.verifyEmail,
    requireMfa: live.requireMfa,
    clearMfaRequirement: live.clearMfaRequirement,
    resetMfa: live.resetMfa,
    revokeSessions: live.revokeSessions,
    suspendUser: live.suspendUser,
    activateUser: live.activateUser,
  };
}
