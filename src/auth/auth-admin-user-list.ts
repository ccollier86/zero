/** Admin user-list query normalization with bounded pagination. */

import {
  USER_LIST_DEFAULT_LIMIT,
  USER_LIST_MAX_LIMIT,
  type UserListOptions,
} from './user-store';

export type NormalizedUserListOptions = Required<Pick<UserListOptions, 'limit' | 'offset'>> &
  Omit<UserListOptions, 'limit' | 'offset'>;

/** Normalize untrusted list query values and enforce the hard result cap. */
export function normalizeUserListQuery(query: Record<string, unknown>): NormalizedUserListOptions {
  return {
    limit: normalizeLimit(typeof query.limit === 'number' ? query.limit : undefined),
    offset: normalizeOffset(typeof query.offset === 'number' ? query.offset : undefined),
    search: typeof query.search === 'string' ? query.search : undefined,
    role: typeof query.role === 'string' ? query.role : undefined,
    status: query.status === 'active' || query.status === 'suspended' ? query.status : undefined,
  };
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return USER_LIST_DEFAULT_LIMIT;
  return Math.max(1, Math.min(USER_LIST_MAX_LIMIT, Math.floor(limit)));
}

function normalizeOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset)) return 0;
  return Math.max(0, Math.floor(offset));
}
