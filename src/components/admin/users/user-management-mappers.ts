/**
 * user-management-mappers.ts
 *
 * Converts auth API records into the row and mutation shapes used by the admin
 * user-management organism. This file owns pure data mapping only; it does not
 * render UI or perform network requests.
 */

import type {
  AuthAdminCreateUserParams,
  AuthAdminUpdateUserParams,
  AuthUser,
} from '../../../frontend/client/auth-client';
import type {
  UserManagementUser,
  UserRoleOption,
} from './user-management-types';

/** Default role options shown when an app has not provided custom roles. */
export const DEFAULT_USER_ROLE_OPTIONS: readonly UserRoleOption[] = [
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
];

/** Multi-tenant installations keep these global roles separate from tenant roles. */
export const MULTI_TENANT_USER_ROLE_OPTIONS: readonly UserRoleOption[] = [
  { value: 'user', label: 'Standard identity' },
  { value: 'admin', label: 'Platform administrator' },
];

/** Convert an API auth user into the row shape consumed by admin components. */
export function mapAuthUserToManagementUser(user: AuthUser): UserManagementUser {
  return {
    id: user.userId,
    userId: user.userId,
    username: user.username,
    email: user.email,
    firstName: user.firstName ?? '',
    lastName: user.lastName ?? '',
    role: user.role,
    status: user.status,
    passwordChangeRequired: user.passwordChangeRequired,
    emailVerifiedAt: user.emailVerifiedAt,
    emailVerificationRequired: user.emailVerificationRequired,
    mfaRequired: user.mfaRequired,
    properties: { ...user.properties },
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/** Build role options from defaults, caller-provided roles, and loaded users. */
export function normalizeRoleOptions(
  users: readonly UserManagementUser[],
  configured: readonly UserRoleOption[] | undefined,
  tenancyMode: 'single' | 'multi' = 'single',
): UserRoleOption[] {
  const byValue = new Map<string, UserRoleOption>();
  const defaults = tenancyMode === 'multi'
    ? MULTI_TENANT_USER_ROLE_OPTIONS
    : DEFAULT_USER_ROLE_OPTIONS;
  for (const option of defaults) byValue.set(option.value, option);
  for (const option of configured ?? []) byValue.set(option.value, option);
  for (const user of users) {
    if (!byValue.has(user.role)) {
      byValue.set(user.role, { value: user.role, label: formatRoleLabel(user.role) });
    }
  }
  return [...byValue.values()];
}

/** Convert editable row values from the detail form into admin update params. */
export function toAdminUserUpdateParams(
  changes: Partial<UserManagementUser>,
): AuthAdminUpdateUserParams {
  return {
    username: changes.username,
    email: changes.email,
    firstName: changes.firstName,
    lastName: changes.lastName,
    role: changes.role,
    status: changes.status,
    mfaRequired: changes.mfaRequired,
  };
}

/** Normalize create-form values before sending them to the admin API. */
export function toAdminUserCreateParams(
  params: AuthAdminCreateUserParams,
): AuthAdminCreateUserParams {
  return {
    username: params.username.trim(),
    email: params.email.trim(),
    password: params.password?.trim() || undefined,
    firstName: params.firstName?.trim() || undefined,
    lastName: params.lastName?.trim() || undefined,
    role: params.role || 'user',
    passwordChangeRequired: params.passwordChangeRequired,
    mfaRequired: params.mfaRequired,
    sendSetupEmail: params.sendSetupEmail,
    properties: params.properties,
  };
}

function formatRoleLabel(role: string): string {
  return role
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
