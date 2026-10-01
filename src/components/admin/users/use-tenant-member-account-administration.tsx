'use client';

import * as React from 'react';
import type { AuthAdminUpdateUserParams } from '../../../frontend/client/auth-client';
import { useAuthorization } from '../../../frontend/client/authorization-hooks';
import { useCurrentUser } from '../../../frontend/client/hooks';
import type { AuthTenantMember } from '../../../frontend/client/auth-types';
import type { NavigationAction } from '../../ui/record-navigation-bar';
import { resolveTenantAccountAdministrationAccess } from './tenant-account-access';
import { buildTenantAccountNavigationActions } from './tenant-account-navigation-actions';
import {
  getUserManagementEditableFields,
} from './user-management-schema';
import { normalizeRoleOptions } from './user-management-mappers';
import { useAdminUserRecord } from './use-admin-user-record';
import { useAdminUsers } from './use-admin-users';
import { useTenantAccountEditDialog } from './use-tenant-account-edit-dialog';
import { useUserManagementNavigationActions } from './use-user-management-navigation-actions';
import { useUserMfaStatus } from './use-user-mfa-status';

/** Compose exact-account state and established account actions for one tenant member. */
export function useTenantMemberAccountAdministration(
  selectedMember: AuthTenantMember | null,
) {
  const authorization = useAuthorization();
  const access = resolveTenantAccountAdministrationAccess({
    ready: authorization.isReady,
    authorization: authorization.authorization,
  });
  const admin = useAdminUsers({
    enabled: access.canReadAccounts,
    loadUsers: false,
  });
  const account = useAdminUserRecord({
    userId: selectedMember?.identity.userId ?? null,
    enabled: access.canReadAccounts && admin.config !== null,
  });
  const currentUser = useCurrentUser();
  const actorUserId = currentUser?.userId
    ?? authorization.authorization?.identity.userId
    ?? null;
  const user = account.user?.userId === selectedMember?.identity.userId
    ? account.user
    : null;
  const canManageTarget = Boolean(
    user
    && access.canManageAccounts
    && admin.config?.capabilities.canManageUsers
    && (user.role !== 'admin' || admin.config.capabilities.canManageGlobalAdmins),
  );
  const editableFields = React.useMemo(() => getUserManagementEditableFields(admin.config, {
    canUpdate: canManageTarget,
    isSelf: user?.userId === actorUserId,
  }), [actorUserId, admin.config, canManageTarget, user?.userId]);
  const roleOptions = React.useMemo(
    () => normalizeRoleOptions(user ? [user] : [], undefined, 'multi'),
    [user],
  );
  const updateUser = React.useCallback(async (
    userId: string,
    changes: AuthAdminUpdateUserParams,
  ) => {
    const next = await admin.updateUser(userId, changes);
    account.replace(next);
  }, [account.replace, admin.updateUser]);
  const deleteProperty = React.useCallback(async (key: string) => {
    if (!user) return;
    const next = await admin.deleteUserProperty(user.userId, key);
    account.replace(next);
  }, [account.replace, admin.deleteUserProperty, user]);
  const openEdit = useTenantAccountEditDialog({
    config: admin.config,
    roleOptions,
    editableFields,
    updateUser,
  });
  const [securityRevision, setSecurityRevision] = React.useState(0);
  const mfaLoader = useStableMfaLoader(admin.getMfaStatus);
  const mfa = useUserMfaStatus({
    user,
    enabled: canManageTarget && admin.config?.capabilities.mfa === true,
    revision: securityRevision,
    load: mfaLoader,
  });
  const trackedOperations = React.useMemo(
    () => createTrackedOperations(admin, account),
    [admin, account],
  );
  const securityChanged = React.useCallback(() => {
    setSecurityRevision((revision) => revision + 1);
  }, []);
  const { navigationActions: standardActions } = useUserManagementNavigationActions({
    config: admin.config,
    mfaStatus: mfa.status,
    currentUserId: actorUserId,
    controlled: false,
    controlledDelete: false,
    operations: trackedOperations,
    deleteUser: admin.deleteUser,
    onSecurityChanged: securityChanged,
  });
  const navigationActions = React.useCallback((member: AuthTenantMember | null): NavigationAction[] => {
    if (!member || member.identity.userId !== user?.userId) return [];
    return buildTenantAccountNavigationActions({
      user,
      canEdit: editableFields.length > 0,
      accountActions: standardActions(user),
      onEdit: openEdit,
    });
  }, [editableFields.length, openEdit, standardActions, user]);
  const retry = React.useCallback(async () => {
    if (!admin.config) {
      await admin.reload();
      return;
    }
    await account.reload();
  }, [account.reload, admin.config, admin.reload]);
  const updateProperties = React.useCallback(async (properties: Record<string, unknown>) => {
    if (!user) return;
    await updateUser(user.userId, { properties });
  }, [updateUser, user]);

  return {
    access,
    user,
    config: admin.config,
    loading: access.canReadAccounts && (admin.isLoading || account.isLoading),
    error: access.canReadAccounts ? admin.error ?? account.error : null,
    canManageTarget,
    mfa,
    navigationActions,
    retry,
    updateProperties,
    deleteProperty,
  };
}

function useStableMfaLoader(load: ReturnType<typeof useAdminUsers>['getMfaStatus']) {
  const loadRef = React.useRef(load);
  loadRef.current = load;
  return React.useCallback((userId: string) => loadRef.current(userId), []);
}

function createTrackedOperations(
  admin: ReturnType<typeof useAdminUsers>,
  account: ReturnType<typeof useAdminUserRecord>,
) {
  const replace = async <T extends NonNullable<typeof account.user>>(
    operation: Promise<T>,
  ): Promise<T> => {
    const user = await operation;
    account.replace(user);
    return user;
  };
  const reloadAfter = async <T,>(operation: Promise<T>): Promise<T> => {
    const result = await operation;
    await account.reload();
    return result;
  };
  return {
    sendSetupEmail: (id: string) => reloadAfter(admin.sendSetupEmail(id)),
    sendPasswordReset: (id: string) => reloadAfter(admin.sendPasswordReset(id)),
    clearPasswordChangeRequirement: (id: string) => replace(
      admin.clearPasswordChangeRequirement(id),
    ),
    resetPassword: (id: string, password: string) => reloadAfter(
      admin.resetPassword(id, password),
    ),
    sendVerificationEmail: admin.sendVerificationEmail,
    verifyEmail: (id: string) => replace(admin.verifyEmail(id)),
    requireMfa: (id: string) => replace(admin.requireMfa(id)),
    clearMfaRequirement: (id: string) => replace(admin.clearMfaRequirement(id)),
    resetMfa: admin.resetMfa,
    revokeSessions: admin.revokeSessions,
    suspendUser: (id: string) => replace(admin.suspendUser(id)),
    activateUser: (id: string) => replace(admin.activateUser(id)),
  };
}
