'use client';

/**
 * use-admin-users.ts
 *
 * Composes focused admin-user data and mutation hooks into the public hook
 * contract. Transport, reconciliation, and rendering stay in sibling modules.
 */

import { useClientMaybe } from '../../../frontend/client/hooks';
import type { UseAdminUsersOptions, UseAdminUsersResult } from './user-management-types';
import { useAdminUserActions } from './use-admin-user-actions';
import { useAdminUserData } from './use-admin-user-data';

/** Load and mutate admin users through the shared Zero client. */
export function useAdminUsers(options: UseAdminUsersOptions = {}): UseAdminUsersResult {
  const client = useClientMaybe();
  const data = useAdminUserData(client, options);
  const actions = useAdminUserActions(client, data);

  return {
    users: data.users,
    config: data.config,
    page: data.page,
    filters: data.filters,
    isLoading: data.isLoading,
    error: data.error ?? actions.error,
    setSearch: data.setSearch,
    setRole: data.setRole,
    setStatus: data.setStatus,
    reload: data.reload,
    loadPage: data.loadPage,
    createUser: actions.createUser,
    updateUser: actions.updateUser,
    deleteUserProperty: actions.deleteUserProperty,
    deleteUser: actions.deleteUser,
    suspendUser: actions.suspendUser,
    activateUser: actions.activateUser,
    sendSetupEmail: actions.sendSetupEmail,
    sendPasswordReset: actions.sendPasswordReset,
    clearPasswordChangeRequirement: actions.clearPasswordChangeRequirement,
    resetPassword: actions.resetPassword,
    revokeSessions: actions.revokeSessions,
    getMfaStatus: actions.getMfaStatus,
    requireMfa: actions.requireMfa,
    clearMfaRequirement: actions.clearMfaRequirement,
    resetMfa: actions.resetMfa,
    sendVerificationEmail: actions.sendVerificationEmail,
    verifyEmail: actions.verifyEmail,
  };
}
