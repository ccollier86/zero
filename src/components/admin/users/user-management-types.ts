/**
 * user-management-types.ts
 *
 * Defines the browser-facing contracts for Zero's reusable admin user
 * management organism. This file owns component/hook types only; it does not
 * fetch data, render UI, or mutate auth state.
 */

import type {
  AuthAdminConfig,
  AuthAdminCreateUserParams,
  AuthAdminMfaResetResult,
  AuthAdminUpdateUserParams,
  AuthAdminUserMfaStatus,
  AuthAdminUserPage,
  AuthUser,
} from '../../../frontend/client/auth-client';
import type { Row } from '../../../sync/types';
import type {
  UserManagementFilters,
  UserManagementStatusFilter,
} from './user-management-pagination';

/** Row shape rendered by the reusable admin user-management component. */
export interface UserManagementUser extends Row {
  id: string;
  userId: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: AuthUser['status'];
  passwordChangeRequired: boolean;
  emailVerifiedAt: number | null;
  emailVerificationRequired: boolean;
  mfaRequired: boolean;
  properties: Record<string, string>;
  createdAt: number;
  updatedAt: number | null;
}

/** Role option shown by admin user-management forms. */
export interface UserRoleOption {
  value: string;
  label: string;
}

/** Result returned by admin user creation actions. */
export interface UserManagementCreateResult {
  user: UserManagementUser;
  setupEmailSent: boolean;
}

/** Options accepted by the live admin user-management hook. */
export interface UseAdminUsersOptions {
  enabled?: boolean;
  /** Load the user list. Set false when only omitted admin config is needed. */
  loadUsers?: boolean;
  pageSize?: number;
  initialSearch?: string;
  initialRole?: string;
  initialStatus?: UserManagementStatusFilter;
}

/** Live admin user-management state and mutations. */
export interface UseAdminUsersResult {
  users: UserManagementUser[];
  config: AuthAdminConfig | null;
  page: AuthAdminUserPage | null;
  filters: UserManagementFilters;
  isLoading: boolean;
  error: string | null;
  setSearch: (search: string) => void;
  setRole: (role: string) => void;
  setStatus: (status: UserManagementStatusFilter) => void;
  reload: () => Promise<void>;
  loadPage: (offset: number) => Promise<void>;
  createUser: (params: AuthAdminCreateUserParams) => Promise<UserManagementCreateResult>;
  updateUser: (userId: string, params: AuthAdminUpdateUserParams) => Promise<UserManagementUser>;
  deleteUserProperty: (userId: string, key: string) => Promise<UserManagementUser>;
  deleteUser: (userId: string) => Promise<void>;
  suspendUser: (userId: string) => Promise<UserManagementUser>;
  activateUser: (userId: string) => Promise<UserManagementUser>;
  sendSetupEmail: (userId: string) => Promise<boolean>;
  sendPasswordReset: (userId: string) => Promise<void>;
  clearPasswordChangeRequirement: (userId: string) => Promise<UserManagementUser>;
  resetPassword: (userId: string, password: string) => Promise<void>;
  revokeSessions: (userId: string) => Promise<void>;
  getMfaStatus: (userId: string) => Promise<AuthAdminUserMfaStatus>;
  requireMfa: (userId: string) => Promise<UserManagementUser>;
  clearMfaRequirement: (userId: string) => Promise<UserManagementUser>;
  resetMfa: (userId: string) => Promise<AuthAdminMfaResetResult>;
  sendVerificationEmail: (userId: string) => Promise<void>;
  verifyEmail: (userId: string) => Promise<UserManagementUser>;
}
