/**
 * user-management-pagination.ts
 *
 * Defines small pagination and filter helpers for the admin user-management
 * organism. This file owns UI query normalization only; it does not fetch
 * auth data, render controls, or mutate user records.
 */

import type {
  AuthAdminUserListParams,
  AuthAdminUserPage,
  AuthUser,
} from '../../../frontend/client/auth-client';

export type UserManagementStatusFilter = 'all' | AuthUser['status'];

export interface UserManagementFilters {
  search: string;
  role: string;
  status: UserManagementStatusFilter;
}

export interface UserManagementPageWindow {
  start: number;
  end: number;
  label: string;
  canPrevious: boolean;
  canNext: boolean;
  previousOffset: number;
  nextOffset: number | null;
}

export const DEFAULT_USER_MANAGEMENT_FILTERS: UserManagementFilters = {
  search: '',
  role: '',
  status: 'all',
};

/** Build backend list params from UI filters and the requested page window. */
export function buildAdminUserListParams(
  filters: UserManagementFilters,
  limit: number,
  offset: number,
): AuthAdminUserListParams {
  const search = filters.search.trim();
  return {
    limit,
    offset,
    ...(search ? { search } : {}),
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.status !== 'all' ? { status: filters.status } : {}),
  };
}

/** Return display and navigation metadata for a backend user page. */
export function getAdminUserPageWindow(
  page: AuthAdminUserPage | null,
): UserManagementPageWindow {
  if (!page || page.total <= 0) {
    return {
      start: 0,
      end: 0,
      label: 'No users',
      canPrevious: false,
      canNext: false,
      previousOffset: 0,
      nextOffset: null,
    };
  }

  const start = page.offset + 1;
  const end = page.offset + page.count;
  const previousOffset = Math.max(0, page.offset - page.limit);

  return {
    start,
    end,
    label: `Showing ${start}-${end} of ${page.total}`,
    canPrevious: page.offset > 0,
    canNext: page.hasMore && page.nextOffset !== null,
    previousOffset,
    nextOffset: page.nextOffset,
  };
}
