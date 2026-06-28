'use client';

/**
 * use-admin-users.ts
 *
 * React hook for live admin user-management state and mutations. This file
 * owns UI-facing loading/error state and calls the public SDK only; it does not
 * render components or perform raw fetches.
 */

import * as React from 'react';
import { useClientMaybe } from '../../../frontend/client/hooks';
import { emitFrontendCode } from '../../../frontend/client/observability';
import type {
  AuthAdminCreateUserParams,
  AuthAdminUpdateUserParams,
} from '../../../frontend/client/auth-client';
import { OBS_CODES } from '../../../observability/codes';
import {
  mapAuthUserToManagementUser,
} from './user-management-mappers';
import {
  DEFAULT_USER_MANAGEMENT_FILTERS,
  buildAdminUserListParams,
} from './user-management-pagination';
import type { UserManagementStatusFilter } from './user-management-pagination';
import type {
  UseAdminUsersOptions,
  UseAdminUsersResult,
  UserManagementCreateResult,
  UserManagementUser,
} from './user-management-types';

/** Load and mutate admin users through the shared Zero client. */
export function useAdminUsers(options: UseAdminUsersOptions = {}): UseAdminUsersResult {
  const {
    enabled = true,
    pageSize = 100,
    initialSearch = DEFAULT_USER_MANAGEMENT_FILTERS.search,
    initialRole = DEFAULT_USER_MANAGEMENT_FILTERS.role,
    initialStatus = DEFAULT_USER_MANAGEMENT_FILTERS.status,
  } = options;
  const client = useClientMaybe();
  const normalizedPageSize = Math.max(1, pageSize);
  const [users, setUsers] = React.useState<UserManagementUser[]>([]);
  const [config, setConfig] = React.useState<UseAdminUsersResult['config']>(null);
  const [page, setPage] = React.useState<UseAdminUsersResult['page']>(null);
  const [filters, setFilters] = React.useState({
    search: initialSearch,
    role: initialRole,
    status: initialStatus,
  });
  const [pageOffset, setPageOffset] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reportError = React.useCallback((action: string, err: unknown): Error => {
    const errorObject = err instanceof Error ? err : new Error(String(err));
    emitFrontendCode(OBS_CODES.FRONTEND_ADMIN_USER_ACTION_FAILED, {
      error: errorObject,
      metadata: { action },
    });
    setError(errorObject.message);
    return errorObject;
  }, []);

  const replaceUser = React.useCallback((user: UserManagementUser) => {
    setUsers((current) => current.map((item) => item.id === user.id ? user : item));
  }, []);

  const loadPage = React.useCallback(async (offset: number) => {
    if (!enabled || !client) return;

    const safeOffset = Math.max(0, offset);
    setIsLoading(true);
    setError(null);
    try {
      const [adminConfig, list] = await Promise.all([
        client.getAuthAdminConfig(),
        client.listAuthAdminUsers(buildAdminUserListParams(filters, normalizedPageSize, safeOffset)),
      ]);
      setConfig(adminConfig);
      setUsers(list.users.map(mapAuthUserToManagementUser));
      setPage(list.page);
      setPageOffset(list.page.offset);
    } catch (err) {
      const errorObject = reportError('load', err);
      setUsers([]);
      setPage(null);
      throw errorObject;
    } finally {
      setIsLoading(false);
    }
  }, [client, enabled, filters, normalizedPageSize, reportError]);

  const reload = React.useCallback(async () => {
    await loadPage(pageOffset);
  }, [loadPage, pageOffset]);

  React.useEffect(() => {
    if (!enabled || !client) return;
    void loadPage(0).catch(() => {});
  }, [client, enabled, filters, loadPage, normalizedPageSize]);

  const setSearch = React.useCallback((search: string) => {
    setFilters((current) => current.search === search ? current : { ...current, search });
  }, []);

  const setRole = React.useCallback((role: string) => {
    setFilters((current) => current.role === role ? current : { ...current, role });
  }, []);

  const setStatus = React.useCallback((status: UserManagementStatusFilter) => {
    setFilters((current) => current.status === status ? current : { ...current, status });
  }, []);

  const createUser = React.useCallback(
    async (params: AuthAdminCreateUserParams): Promise<UserManagementCreateResult> => {
      if (!client) throw reportError('create', new Error('Client is not available'));
      try {
        const result = await client.createAuthAdminUser(params);
        const user = mapAuthUserToManagementUser(result.user);
        setUsers((current) => pageOffset === 0
          ? [user, ...current].slice(0, normalizedPageSize)
          : current);
        setPage((current) => current
          ? {
              ...current,
              count: pageOffset === 0 ? Math.min(current.count + 1, normalizedPageSize) : current.count,
              total: current.total + 1,
              hasMore: current.hasMore || pageOffset === 0 && current.count + 1 > normalizedPageSize,
              nextOffset: current.hasMore
                ? current.nextOffset
                : pageOffset === 0 && current.count + 1 > normalizedPageSize
                  ? normalizedPageSize
                  : current.nextOffset,
            }
          : current);
        return { user, setupEmailSent: result.setupEmailSent };
      } catch (err) {
        throw reportError('create', err);
      }
    },
    [client, normalizedPageSize, pageOffset, reportError],
  );

  const updateUser = React.useCallback(
    async (userId: string, params: AuthAdminUpdateUserParams): Promise<UserManagementUser> => {
      if (!client) throw reportError('update', new Error('Client is not available'));
      try {
        const user = mapAuthUserToManagementUser(await client.updateAuthAdminUser(userId, params));
        replaceUser(user);
        return user;
      } catch (err) {
        throw reportError('update', err);
      }
    },
    [client, replaceUser, reportError],
  );

  const deleteUser = React.useCallback(
    async (userId: string): Promise<void> => {
      if (!client) throw reportError('delete', new Error('Client is not available'));
      try {
        await client.deleteAuthAdminUser(userId);
        setUsers((current) => current.filter((user) => user.id !== userId));
        setPage((current) => current
          ? {
              ...current,
              count: Math.max(0, current.count - 1),
              total: Math.max(0, current.total - 1),
              hasMore: current.nextOffset !== null && current.nextOffset < Math.max(0, current.total - 1),
            }
          : current);
      } catch (err) {
        throw reportError('delete', err);
      }
    },
    [client, reportError],
  );

  const suspendUser = React.useCallback(
    async (userId: string): Promise<UserManagementUser> => {
      if (!client) throw reportError('suspend', new Error('Client is not available'));
      try {
        const user = mapAuthUserToManagementUser(await client.suspendAuthAdminUser(userId));
        replaceUser(user);
        return user;
      } catch (err) {
        throw reportError('suspend', err);
      }
    },
    [client, replaceUser, reportError],
  );

  const activateUser = React.useCallback(
    async (userId: string): Promise<UserManagementUser> => {
      if (!client) throw reportError('activate', new Error('Client is not available'));
      try {
        const user = mapAuthUserToManagementUser(await client.activateAuthAdminUser(userId));
        replaceUser(user);
        return user;
      } catch (err) {
        throw reportError('activate', err);
      }
    },
    [client, replaceUser, reportError],
  );

  const sendSetupEmail = React.useCallback(
    async (userId: string): Promise<boolean> => {
      if (!client) throw reportError('sendSetupEmail', new Error('Client is not available'));
      try {
        return await client.sendAuthAdminSetupEmail(userId);
      } catch (err) {
        throw reportError('sendSetupEmail', err);
      }
    },
    [client, reportError],
  );

  const sendPasswordReset = React.useCallback(
    async (userId: string): Promise<void> => {
      if (!client) throw reportError('sendPasswordReset', new Error('Client is not available'));
      try {
        await client.sendAuthAdminPasswordReset(userId);
        await reload();
      } catch (err) {
        throw reportError('sendPasswordReset', err);
      }
    },
    [client, reload, reportError],
  );

  const resetPassword = React.useCallback(
    async (userId: string, password: string): Promise<void> => {
      if (!client) throw reportError('resetPassword', new Error('Client is not available'));
      try {
        await client.resetAuthAdminPassword(userId, password);
        await reload();
      } catch (err) {
        throw reportError('resetPassword', err);
      }
    },
    [client, reload, reportError],
  );

  const revokeSessions = React.useCallback(
    async (userId: string): Promise<void> => {
      if (!client) throw reportError('revokeSessions', new Error('Client is not available'));
      try {
        await client.revokeAuthAdminUserSessions(userId);
      } catch (err) {
        throw reportError('revokeSessions', err);
      }
    },
    [client, reportError],
  );

  return {
    users,
    config,
    page,
    filters,
    isLoading,
    error,
    setSearch,
    setRole,
    setStatus,
    reload,
    loadPage,
    createUser,
    updateUser,
    deleteUser,
    suspendUser,
    activateUser,
    sendSetupEmail,
    sendPasswordReset,
    resetPassword,
    revokeSessions,
  };
}
