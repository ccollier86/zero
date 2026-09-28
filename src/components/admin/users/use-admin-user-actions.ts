'use client';

/**
 * use-admin-user-actions.ts
 *
 * Owns SDK-backed user mutations and local reconciliation. List/config loading
 * remains in use-admin-user-data and rendering remains in UserManagement.
 */

import * as React from 'react';
import type { Client } from '../../../frontend/client/sdk';
import {
  isAuthorizationScopeCallbackCurrent,
  useAuthorizationScopeBoundary,
} from '../../../frontend/client/authorization-scope-hooks';
import type { UseAdminUsersResult, UserManagementUser } from './user-management-types';
import { mapAuthUserToManagementUser } from './user-management-mappers';
import { reportAdminUserError } from './admin-user-error';
import type { AdminUserDataState } from './use-admin-user-data';

type AdminUserActions = Pick<UseAdminUsersResult,
  | 'createUser' | 'updateUser' | 'deleteUserProperty' | 'deleteUser'
  | 'suspendUser' | 'activateUser' | 'sendSetupEmail' | 'sendPasswordReset'
  | 'clearPasswordChangeRequirement' | 'resetPassword' | 'revokeSessions' | 'getMfaStatus' | 'requireMfa'
  | 'clearMfaRequirement' | 'resetMfa' | 'sendVerificationEmail' | 'verifyEmail'>;

/** Create stable admin mutation callbacks and expose their latest error. */
export function useAdminUserActions(
  client: Client | null,
  data: AdminUserDataState,
): AdminUserActions & { error: string | null } {
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const [error, setError] = React.useState<string | null>(null);
  const [loadedBoundaryKey, setLoadedBoundaryKey] = React.useState(authorizationBoundary.key);
  const boundaryKeyRef = React.useRef(authorizationBoundary.key);
  const boundaryReadyRef = React.useRef(authorizationBoundary.ready);
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;
  const isCurrentScope = React.useCallback(
    () => isAuthorizationScopeCallbackCurrent(
      boundaryKeyRef.current,
      boundaryReadyRef.current,
      callbackBoundaryKey,
    ),
    [callbackBoundaryKey],
  );

  React.useEffect(() => {
    setLoadedBoundaryKey(authorizationBoundary.key);
    setError(null);
  }, [authorizationBoundary.key]);

  const run = React.useCallback(async <T,>(
    action: string,
    task: () => Promise<T>,
    targetUserId?: string,
  ): Promise<T> => {
    if (!isCurrentScope()) throw staleAdminAction();
    const operationBoundaryKey = callbackBoundaryKey;
    setLoadedBoundaryKey(operationBoundaryKey);
    setError(null);
    try {
      const result = await task();
      if (!boundaryReadyRef.current
        || boundaryKeyRef.current !== operationBoundaryKey) throw staleAdminAction();
      return result;
    } catch (value) {
      if (!boundaryReadyRef.current
        || boundaryKeyRef.current !== operationBoundaryKey) throw staleAdminAction();
      const failure = reportAdminUserError(action, value, { targetUserId });
      setError(failure.message);
      throw failure;
    }
  }, [callbackBoundaryKey, isCurrentScope]);
  const requireClient = React.useCallback(() => {
    if (!client || !isCurrentScope()) throw staleAdminAction();
    return client;
  }, [client, isCurrentScope]);
  const refreshUser = React.useCallback(async (userId: string) => {
    const user = mapAuthUserToManagementUser(await requireClient().getAuthAdminUser(userId));
    data.replaceUser(user);
    return user;
  }, [data.replaceUser, requireClient]);

  const createUser: AdminUserActions['createUser'] = React.useCallback((params) =>
    run('create', async () => {
      const result = await requireClient().createAuthAdminUser(params);
      const user = mapAuthUserToManagementUser(result.user);
      data.setUsers((current) => data.pageOffset === 0
        ? [user, ...current].slice(0, data.pageSize) : current);
      data.setPage((current) => current ? incrementPage(current, data.pageOffset, data.pageSize) : current);
      return { user, setupEmailSent: result.setupEmailSent };
    }), [data.pageOffset, data.pageSize, data.setPage, data.setUsers, requireClient, run]);

  const updateUser: AdminUserActions['updateUser'] = React.useCallback((userId, params) =>
    run('update', async () => {
      const user = mapAuthUserToManagementUser(await requireClient().updateAuthAdminUser(userId, params));
      data.replaceUser(user);
      return user;
    }, userId), [data.replaceUser, requireClient, run]);

  const deleteUserProperty: AdminUserActions['deleteUserProperty'] = React.useCallback((userId, key) =>
    run('deleteProperty', async () => {
      await requireClient().deleteAuthAdminUserProperty(userId, key);
      return refreshUser(userId);
    }, userId), [refreshUser, requireClient, run]);

  const deleteUser: AdminUserActions['deleteUser'] = React.useCallback((userId) =>
    run('delete', async () => {
      await requireClient().deleteAuthAdminUser(userId);
      data.setUsers((current) => current.filter((user) => user.id !== userId));
      data.setPage((current) => current ? decrementPage(current) : current);
    }, userId), [data.setPage, data.setUsers, requireClient, run]);

  const replace = React.useCallback((
    action: string,
    targetUserId: string,
    task: () => Promise<Parameters<typeof mapAuthUserToManagementUser>[0]>,
  ) =>
    run(action, async () => {
      const user = mapAuthUserToManagementUser(await task());
      data.replaceUser(user);
      return user;
    }, targetUserId), [data.replaceUser, run]);

  return {
    error: authorizationBoundary.ready
      && loadedBoundaryKey === authorizationBoundary.key
      ? error
      : null,
    createUser,
    updateUser,
    deleteUserProperty,
    deleteUser,
    suspendUser: (id) => replace('suspend', id, () => requireClient().suspendAuthAdminUser(id)),
    activateUser: (id) => replace('activate', id, () => requireClient().activateAuthAdminUser(id)),
    sendSetupEmail: (id) => run('sendSetupEmail', async () => {
      const sent = await requireClient().sendAuthAdminSetupEmail(id); await refreshUser(id); return sent;
    }, id),
    sendPasswordReset: (id) => run('sendPasswordReset', async () => {
      await requireClient().sendAuthAdminPasswordReset(id); await refreshUser(id);
    }, id),
    clearPasswordChangeRequirement: (id) => replace(
      'clearPasswordChangeRequirement', id,
      () => requireClient().clearAuthAdminPasswordChangeRequirement(id),
    ),
    resetPassword: (id, password) => run('resetPassword', async () => {
      await requireClient().resetAuthAdminPassword(id, password); await refreshUser(id);
    }, id),
    revokeSessions: (id) => run(
      'revokeSessions', () => requireClient().revokeAuthAdminUserSessions(id), id,
    ),
    getMfaStatus: (id) => run('getMfaStatus', () => requireClient().getAuthAdminUserMfa(id), id),
    requireMfa: (id) => replace('requireMfa', id, () => requireClient().requireAuthAdminUserMfa(id)),
    clearMfaRequirement: (id) => replace(
      'clearMfaRequirement', id, () => requireClient().clearAuthAdminUserMfaRequirement(id),
    ),
    resetMfa: (id) => run('resetMfa', () => requireClient().resetAuthAdminUserMfa(id), id),
    sendVerificationEmail: (id) => run(
      'sendVerificationEmail', () => requireClient().sendAuthAdminVerificationEmail(id), id,
    ),
    verifyEmail: (id) => replace('verifyEmail', id, () => requireClient().verifyAuthAdminUserEmail(id)),
  };
}

function staleAdminAction(): Error {
  return new Error('The authorization scope changed before the admin user action completed.');
}

function incrementPage(page: NonNullable<UseAdminUsersResult['page']>, offset: number, size: number) {
  const added = offset === 0 ? 1 : 0;
  const hasMore = page.hasMore || added > 0 && page.count + 1 > size;
  return {
    ...page,
    count: Math.min(page.count + added, size),
    total: page.total + 1,
    hasMore,
    nextOffset: page.nextOffset ?? (hasMore ? size : null),
  };
}

function decrementPage(page: NonNullable<UseAdminUsersResult['page']>) {
  const total = Math.max(0, page.total - 1);
  return {
    ...page,
    count: Math.max(0, page.count - 1),
    total,
    hasMore: page.nextOffset !== null && page.nextOffset < total,
  };
}
