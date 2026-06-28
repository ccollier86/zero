/**
 * user-management-schema.ts
 *
 * Defines the generated form/table schema for the reusable admin user detail
 * editor. This file owns UI schema metadata only; auth persistence and
 * lifecycle actions stay behind the admin SDK.
 */

import { defineSchema, field } from '../../../schema';
import type { UserRoleOption } from './user-management-types';

/** Build the admin user schema from the role options available to the app. */
export function createUserManagementSchema(roleOptions: readonly UserRoleOption[]) {
  return defineSchema({
    username: field.text({ label: 'Username', required: true, placeholder: 'jdoe' }),
    email: field.email({ label: 'Email', required: true }),
    firstName: field.text({ label: 'First name', placeholder: 'Jane' }),
    lastName: field.text({ label: 'Last name', placeholder: 'Doe' }),
    role: field.select(
      roleOptions.map((option) => ({ value: option.value, label: option.label })),
      { label: 'Role', required: true, defaultValue: 'user' },
    ),
    status: field.select(
      [
        { value: 'active', label: 'Active' },
        { value: 'suspended', label: 'Suspended' },
      ],
      { label: 'Status', required: true, defaultValue: 'active' },
    ),
    passwordChangeRequired: field.boolean({
      label: 'Require password change',
      description: 'Blocks normal token use until the user completes password setup or reset.',
      defaultValue: false,
    }),
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
  'status',
  'passwordChangeRequired',
];
