/**
 * index.ts
 *
 * Public exports for the reusable admin user-management component family.
 * This barrel owns import ergonomics only; behavior remains in sibling files.
 */

export {
  UserManagement,
  PlatformUserManagement,
} from './adaptive-user-management';
export { IdentityUserManagement } from './user-management';
export {
  TenantScopedUserManagement,
  type TenantScopedUserManagementProps,
} from './tenant-scoped-user-management';
export type { UserManagementProps } from './adaptive-user-management';
export type {
  UserManagementProps as PlatformUserManagementProps,
} from './adaptive-user-management';
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
