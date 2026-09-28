'use client';

/**
 * use-admin-user-data.ts
 *
 * Owns admin config/list/filter loading and latest-request reconciliation. It
 * does not define mutations or render the user-management interface.
 */

import * as React from 'react';
import type { Client } from '../../../frontend/client/sdk';
import {
  isAuthorizationScopeCallbackCurrent,
  useAuthorizationScopeBoundary,
} from '../../../frontend/client/authorization-scope-hooks';
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
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
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

  const replaceUser = React.useCallback((user: UserManagementUser) => {
    if (!isCurrentScope()) return;
    setUsers((current) => current.map((item) => item.id === user.id ? user : item));
  }, [isCurrentScope]);

  const setScopedUsers = React.useCallback<AdminUserDataState['setUsers']>((next) => {
    if (isCurrentScope()) setUsers(next);
  }, [isCurrentScope]);

  const setScopedPage = React.useCallback<AdminUserDataState['setPage']>((next) => {
    if (isCurrentScope()) setPage(next);
  }, [isCurrentScope]);

  const loadConfig = React.useCallback(async () => {
    if (!enabled || !client || !isCurrentScope()) return;
    const requestBoundaryKey = callbackBoundaryKey;
    const id = ++requests.current.config;
    setLoading((state) => ({ ...state, config: true }));
    setErrors((state) => ({ ...state, config: null }));
    try {
      const next = await client.getAuthAdminConfig();
      if (!boundaryReadyRef.current
        || boundaryKeyRef.current !== requestBoundaryKey) throw staleAdminOperation();
      if (id === requests.current.config) {
        setConfig(next);
        setLoadedBoundaryKey(requestBoundaryKey);
      }
    } catch (value) {
      if (!boundaryReadyRef.current
        || boundaryKeyRef.current !== requestBoundaryKey) throw staleAdminOperation();
      if (id !== requests.current.config) return;
      const error = reportAdminUserError('loadConfig', value);
      setErrors((state) => ({ ...state, config: error.message }));
      setLoadedBoundaryKey(requestBoundaryKey);
      throw error;
    } finally {
      if (id === requests.current.config) {
        setLoading((state) => ({ ...state, config: false }));
      }
    }
  }, [callbackBoundaryKey, client, enabled, isCurrentScope]);

  const loadPage = React.useCallback(async (offset: number) => {
    if (!enabled || !loadUsers || !client || !isCurrentScope()) return;
    const requestBoundaryKey = callbackBoundaryKey;
    const id = ++requests.current.list;
    setLoading((state) => ({ ...state, list: true }));
    setErrors((state) => ({ ...state, list: null }));
    try {
      const result = await client.listAuthAdminUsers(
        buildAdminUserListParams(filters, pageSize, Math.max(0, offset)),
      );
      if (!boundaryReadyRef.current
        || boundaryKeyRef.current !== requestBoundaryKey) throw staleAdminOperation();
      if (id !== requests.current.list) return;
      setUsers(result.users.map(mapAuthUserToManagementUser));
      setPage(result.page);
      setPageOffset(result.page.offset);
      setLoadedBoundaryKey(requestBoundaryKey);
    } catch (value) {
      if (!boundaryReadyRef.current
        || boundaryKeyRef.current !== requestBoundaryKey) throw staleAdminOperation();
      if (id !== requests.current.list) return;
      const error = reportAdminUserError('load', value);
      setErrors((state) => ({ ...state, list: error.message }));
      setLoadedBoundaryKey(requestBoundaryKey);
      throw error;
    } finally {
      if (id === requests.current.list) {
        setLoading((state) => ({ ...state, list: false }));
      }
    }
  }, [callbackBoundaryKey, client, enabled, filters, isCurrentScope, loadUsers, pageSize]);

  const reload = React.useCallback(async () => {
    if (!isCurrentScope()) return;
    await Promise.all([loadConfig(), loadUsers ? loadPage(pageOffset) : Promise.resolve()]);
  }, [isCurrentScope, loadConfig, loadPage, loadUsers, pageOffset]);

  React.useEffect(() => {
    requests.current.config += 1;
    requests.current.list += 1;
    setLoadedBoundaryKey(authorizationBoundary.key);
    setUsers([]);
    setConfig(null);
    setPage(null);
    setPageOffset(0);
    setFilters({
      search: options.initialSearch ?? DEFAULT_USER_MANAGEMENT_FILTERS.search,
      role: options.initialRole ?? DEFAULT_USER_MANAGEMENT_FILTERS.role,
      status: options.initialStatus ?? DEFAULT_USER_MANAGEMENT_FILTERS.status,
    });
    setLoading({ config: false, list: false });
    setErrors({ config: null, list: null });
  }, [authorizationBoundary.key]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!enabled || !authorizationBoundary.ready) return;
    if (!client) {
      setErrors((state) => ({
        ...state,
        config: 'Zero ClientProvider is required for admin user management.',
      }));
      return;
    }
    void loadConfig().catch(() => {});
  }, [authorizationBoundary.ready, client, enabled, loadConfig]);

  React.useEffect(() => {
    if (authorizationBoundary.ready && enabled && loadUsers && client) {
      void loadPage(0).catch(() => {});
    }
  }, [authorizationBoundary.ready, client, enabled, loadPage, loadUsers]);

  React.useEffect(() => () => {
    requests.current.config += 1;
    requests.current.list += 1;
  }, []);

  const visible = authorizationBoundary.ready
    && loadedBoundaryKey === authorizationBoundary.key;
  const visibleFilters = visible ? filters : {
    search: options.initialSearch ?? DEFAULT_USER_MANAGEMENT_FILTERS.search,
    role: options.initialRole ?? DEFAULT_USER_MANAGEMENT_FILTERS.role,
    status: options.initialStatus ?? DEFAULT_USER_MANAGEMENT_FILTERS.status,
  };

  return {
    users: visible ? users : [],
    config: visible ? config : null,
    page: visible ? page : null,
    filters: visibleFilters,
    pageOffset: visible ? pageOffset : 0,
    pageSize,
    isLoading: authorizationBoundary.ready && (!visible || loading.config || loading.list),
    error: visible ? errors.config ?? errors.list : null,
    setUsers: setScopedUsers,
    setPage: setScopedPage,
    replaceUser,
    setSearch: (search) => {
      if (isCurrentScope()) {
        setFilters((state) => state.search === search ? state : { ...state, search });
      }
    },
    setRole: (role) => {
      if (isCurrentScope()) {
        setFilters((state) => state.role === role ? state : { ...state, role });
      }
    },
    setStatus: (status) => {
      if (isCurrentScope()) {
        setFilters((state) => state.status === status ? state : { ...state, status });
      }
    },
    loadPage, reload,
  };
}

function staleAdminOperation(): Error {
  return new Error('The authorization scope changed before the admin user request completed.');
}
