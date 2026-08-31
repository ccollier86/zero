/**
 * user-management-props.ts
 *
 * Defines the public controlled and self-wired contracts for UserManagement.
 * Rendering and transport remain in the component and admin-user hook.
 */

import type {
  AuthAdminConfig,
  AuthAdminCreateUserParams,
  AuthAdminUpdateUserParams,
} from '../../../frontend/client/auth-client';
import type {
  UserManagementCreateResult,
  UserManagementUser,
  UserRoleOption,
} from './user-management-types';

/** Configure self-wired data or explicit controlled handlers for UserManagement. */
export interface UserManagementProps {
  data?: UserManagementUser[];
  config?: AuthAdminConfig | null;
  roleOptions?: readonly UserRoleOption[];
  pageSize?: number;
  onCreate?: (params: AuthAdminCreateUserParams) => void | Promise<void | UserManagementCreateResult>;
  onUpdate?: (
    userId: string,
    changes: AuthAdminUpdateUserParams,
  ) => void | Promise<void | UserManagementUser>;
  onDeleteProperty?: (
    userId: string,
    key: string,
  ) => void | Promise<void | UserManagementUser>;
  onDelete?: (userId: string) => void | Promise<void>;
  className?: string;
}
