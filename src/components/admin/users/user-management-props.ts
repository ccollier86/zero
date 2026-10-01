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
import type { AuthTenantMember } from '../../../frontend/client/auth-types';
import type { ReactNode } from 'react';
import type {
  UserManagementCreateResult,
  UserManagementUser,
  UserRoleOption,
} from './user-management-types';
import type { NavigationAction } from '../../ui/record-navigation-bar';

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
  /** Identity-scope information rendered after the standard global account detail. */
  additionalDetailContent?: (user: UserManagementUser) => ReactNode;
  /** Identity-scope commands appended to the standard global account action bar. */
  additionalNavigationActions?: (user: UserManagementUser | null) => NavigationAction[];
  /** Reports the selected global account in identity-backed management modes. */
  onSelectedUserChange?: (user: UserManagementUser | null) => void;
  /** Tenant-scope information rendered after membership and account-access details. */
  additionalTenantMemberDetailContent?: (member: AuthTenantMember) => ReactNode;
  /** Tenant-scope commands appended to the membership/account action bar. */
  additionalTenantMemberNavigationActions?: (
    member: AuthTenantMember | null,
  ) => NavigationAction[];
  /** Reports the selected membership in organization-backed management modes. */
  onSelectedTenantMemberChange?: (member: AuthTenantMember | null) => void;
  /** Initial resource view when multi-tenant platform controls are available. */
  defaultManagementView?: 'people' | 'workspaces';
  /** Initial people scope inside the Administration Organization. */
  defaultPeopleScope?: 'administration' | 'identities';
  /** Runs when a membership mutation intentionally invalidates the actor session. */
  onActorSessionInvalidated?: () => void;
  /** Runs when an advanced single-app mutation changes the actor's own authority. */
  onActorAuthorizationChanged?: () => void;
  className?: string;
}
