/**
 * user-management-schema.ts
 *
 * Defines the generated form/table schema for the reusable admin user detail
 * editor. This file owns UI schema metadata only; auth persistence and
 * lifecycle actions stay behind the admin SDK.
 */

import { defineSchema, field } from '../../../schema';
import type { AuthAdminConfig } from '../../../frontend/client/auth-client';
import type { UserRoleOption } from './user-management-types';

/** Build the admin user schema from the role options available to the app. */
export function createUserManagementSchema(
  roleOptions: readonly UserRoleOption[],
  roleFieldLabel = 'Role',
) {
  return defineSchema({
    username: field.text({ label: 'Username', required: true, placeholder: 'jdoe' }),
    email: field.email({ label: 'Email', required: true }),
    firstName: field.text({ label: 'First name', placeholder: 'Jane' }),
    lastName: field.text({ label: 'Last name', placeholder: 'Doe' }),
    role: field.select(
      roleOptions.map((option) => ({ value: option.value, label: option.label })),
      { label: roleFieldLabel, required: true, defaultValue: 'user' },
    ),
    status: field.select(
      [
        { value: 'active', label: 'Active' },
        { value: 'suspended', label: 'Suspended' },
      ],
      { label: 'Status', required: true, defaultValue: 'active' },
    ),
  });
}

/** Columns displayed in the admin user list. */
export const userManagementListColumns = ['username', 'email', 'role', 'status'];

/** Fields editable in the admin user detail form. */
export const userManagementEditableFields = [
  'username',
  'email',
  'firstName',
  'lastName',
  'role',
];

/** Resolve fields that are safe to expose for the selected user and auth policy. */
export function getUserManagementEditableFields(
  config: AuthAdminConfig | null,
  options: { isSelf?: boolean; canUpdate?: boolean; enforceCapabilities?: boolean } = {},
): string[] {
  if (options.canUpdate === false
    || (options.enforceCapabilities !== false
      && config?.capabilities.canManageUsers !== true)) return [];

  const fields = userManagementEditableFields.filter((fieldName) => {
    if (fieldName === 'role') return Boolean(config?.capabilities.promoteAdmins) && !options.isSelf;
    return true;
  });
  return fields;
}
