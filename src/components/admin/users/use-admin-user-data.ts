'use client';

/**
 * use-admin-user-data.ts
 *
 * Owns admin config/list/filter loading and latest-request reconciliation. It
 * does not define mutations or render the user-management interface.
 */

import * as React from 'react';
import type { Client } from '../../../frontend/client/sdk';
import { mapAuthUserToManagementUser } from './user-management-mappers';
import {
  DEFAULT_USER_MANAGEMENT_FILTERS,
  buildAdminUserListParams,
} from './user-management-pagination';
import type { UserManagementStatusFilter } from './user-management-pagination';
import type {
  UseAdminUsersOptions,
  UseAdminUsersResult,
  UserManagementUser,
} from './user-management-types';
import { reportAdminUserError } from './admin-user-error';

export interface AdminUserDataState {
  users: UserManagementUser[];
  config: UseAdminUsersResult['config'];
  page: UseAdminUsersResult['page'];
  filters: UseAdminUsersResult['filters'];
  pageOffset: number;
  pageSize: number;
  isLoading: boolean;
  error: string | null;
  setUsers: React.Dispatch<React.SetStateAction<UserManagementUser[]>>;
  setPage: React.Dispatch<React.SetStateAction<UseAdminUsersResult['page']>>;
  replaceUser: (user: UserManagementUser) => void;
  setSearch: (value: string) => void;
  setRole: (value: string) => void;
  setStatus: (value: UserManagementStatusFilter) => void;
  loadPage: (offset: number) => Promise<void>;
  reload: () => Promise<void>;
}

/** Load admin config and a paginated list while ignoring superseded results. */
export function useAdminUserData(
  client: Client | null,
  options: UseAdminUsersOptions,
): AdminUserDataState {
  const enabled = options.enabled ?? true;
  const loadUsers = options.loadUsers ?? true;
  const pageSize = Math.max(1, options.pageSize ?? 100);
  const [users, setUsers] = React.useState<UserManagementUser[]>([]);
  const [config, setConfig] = React.useState<UseAdminUsersResult['config']>(null);
  const [page, setPage] = React.useState<UseAdminUsersResult['page']>(null);
  const [pageOffset, setPageOffset] = React.useState(0);
  const [filters, setFilters] = React.useState({
    search: options.initialSearch ?? DEFAULT_USER_MANAGEMENT_FILTERS.search,
    role: options.initialRole ?? DEFAULT_USER_MANAGEMENT_FILTERS.role,
    status: options.initialStatus ?? DEFAULT_USER_MANAGEMENT_FILTERS.status,
  });
  const [loading, setLoading] = React.useState({ config: false, list: false });
  const [errors, setErrors] = React.useState({ config: null, list: null } as {
    config: string | null;
    list: string | null;
  });
  const requests = React.useRef({ config: 0, list: 0 });

  const replaceUser = React.useCallback((user: UserManagementUser) => {
    setUsers((current) => current.map((item) => item.id === user.id ? user : item));
  }, []);

  const loadConfig = React.useCallback(async () => {
    if (!enabled || !client) return;
    const id = ++requests.current.config;
    setLoading((state) => ({ ...state, config: true }));
    setErrors((state) => ({ ...state, config: null }));
    try {
      const next = await client.getAuthAdminConfig();
      if (id === requests.current.config) setConfig(next);
    } catch (value) {
      if (id !== requests.current.config) return;
      const error = reportAdminUserError('loadConfig', value);
      setErrors((state) => ({ ...state, config: error.message }));
      throw error;
    } finally {
      if (id === requests.current.config) {
        setLoading((state) => ({ ...state, config: false }));
      }
    }
  }, [client, enabled]);

  const loadPage = React.useCallback(async (offset: number) => {
    if (!enabled || !loadUsers || !client) return;
    const id = ++requests.current.list;
    setLoading((state) => ({ ...state, list: true }));
    setErrors((state) => ({ ...state, list: null }));
    try {
      const result = await client.listAuthAdminUsers(
        buildAdminUserListParams(filters, pageSize, Math.max(0, offset)),
      );
      if (id !== requests.current.list) return;
      setUsers(result.users.map(mapAuthUserToManagementUser));
      setPage(result.page);
      setPageOffset(result.page.offset);
    } catch (value) {
      if (id !== requests.current.list) return;
      const error = reportAdminUserError('load', value);
      setErrors((state) => ({ ...state, list: error.message }));
      throw error;
    } finally {
      if (id === requests.current.list) {
        setLoading((state) => ({ ...state, list: false }));
      }
    }
  }, [client, enabled, filters, loadUsers, pageSize]);

  const reload = React.useCallback(async () => {
    await Promise.all([loadConfig(), loadUsers ? loadPage(pageOffset) : Promise.resolve()]);
  }, [loadConfig, loadPage, loadUsers, pageOffset]);

  React.useEffect(() => {
    if (!enabled) return;
    if (!client) {
      setErrors((state) => ({
        ...state,
        config: 'Zero ClientProvider is required for admin user management.',
      }));
      return;
    }
    void loadConfig().catch(() => {});
  }, [client, enabled, loadConfig]);

  React.useEffect(() => {
    if (enabled && loadUsers && client) void loadPage(0).catch(() => {});
  }, [client, enabled, loadPage, loadUsers]);

  React.useEffect(() => () => {
    requests.current.config += 1;
    requests.current.list += 1;
  }, []);

  return {
    users, config, page, filters, pageOffset, pageSize,
    isLoading: loading.config || loading.list,
    error: errors.config ?? errors.list,
    setUsers, setPage, replaceUser,
    setSearch: (search) => setFilters((state) => state.search === search ? state : { ...state, search }),
    setRole: (role) => setFilters((state) => state.role === role ? state : { ...state, role }),
    setStatus: (status) => setFilters((state) => state.status === status ? state : { ...state, status }),
    loadPage, reload,
  };
}
