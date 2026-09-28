/**
 * index.ts
 *
 * Public exports for the reusable admin user-management component family.
 * This barrel owns import ergonomics only; behavior remains in sibling files.
 */

// `UserManagement` remains the compatibility name. The explicit alias makes
// its platform/global identity authority unambiguous beside tenant member UI.
export {
  UserManagement,
  UserManagement as PlatformUserManagement,
} from './user-management';
export type { UserManagementProps } from './user-management';
export type {
  UserManagementProps as PlatformUserManagementProps,
} from './user-management';
export { useAdminUsers } from './use-admin-users';
export type {
  UseAdminUsersOptions,
  UseAdminUsersResult,
  UserManagementCreateResult,
  UserManagementUser,
  UserRoleOption,
} from './user-management-types';
export type {
  UserManagementFilters,
  UserManagementStatusFilter,
} from './user-management-pagination';
