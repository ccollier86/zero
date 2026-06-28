import { defineSchema, field } from '../../schema';

export const userSchema = defineSchema({
  username: field.text({ label: 'Username', required: true, placeholder: 'jdoe' }),
  email: field.email({ label: 'Email', required: true }),
  firstName: field.text({ label: 'First Name', placeholder: 'John' }),
  lastName: field.text({ label: 'Last Name', placeholder: 'Doe' }),
  role: field.select(
    [
      { value: 'admin', label: 'Admin' },
      { value: 'provider', label: 'Provider' },
      { value: 'staff', label: 'Staff' },
      { value: 'viewer', label: 'Viewer' },
    ],
    { label: 'Role', required: true, defaultValue: 'viewer' },
  ),
  status: field.select(
    [
      { value: 'active', label: 'Active' },
      { value: 'inactive', label: 'Inactive' },
      { value: 'suspended', label: 'Suspended' },
    ],
    { label: 'Status', defaultValue: 'active' },
  ),
});

/** Columns displayed in the list table */
export const userListColumns = ['username', 'email', 'role', 'status'];

/** Fields editable in the detail panel */
export const userEditableFields = ['firstName', 'lastName', 'email', 'role', 'status'];
