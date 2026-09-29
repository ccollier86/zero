import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AuthAdminConfig } from '../../../frontend/client/auth-client';
import { UserDetailHeader } from './user-detail-header';
import { UserManagementCreateForm } from './user-management-create-form';
import { normalizeRoleOptions } from './user-management-mappers';
import { createUserManagementSchema } from './user-management-schema';
import type { UserManagementUser } from './user-management-types';

const user = {
  id: 'user-1',
  userId: 'user-1',
  username: 'alex',
  email: 'alex@example.test',
  firstName: 'Alex',
  lastName: 'Rivera',
  role: 'admin',
  status: 'active',
  passwordChangeRequired: false,
  emailVerifiedAt: 1,
  emailVerificationRequired: false,
  mfaRequired: false,
  properties: {},
  createdAt: 1,
  updatedAt: null,
} satisfies UserManagementUser;

const multiConfig = {
  tenancy: {
    mode: 'multi',
    terminology: { singular: 'workspace', plural: 'workspaces' },
  },
  capabilities: {
    setupEmail: false,
    mfa: false,
    canManageGlobalAdmins: true,
  },
  accountEmails: { adminCreatedUser: false },
} as unknown as AuthAdminConfig;

describe('global-role presentation', () => {
  test('makes platform scope explicit in multi-tenant mode without changing role values', () => {
    const options = normalizeRoleOptions([user], undefined, 'multi');

    expect(options).toEqual([
      { value: 'user', label: 'Standard identity' },
      { value: 'admin', label: 'Platform administrator' },
    ]);
  });

  test('keeps caller-provided labels authoritative', () => {
    expect(normalizeRoleOptions([user], [
      { value: 'admin', label: 'Operations administrator' },
    ], 'multi')).toContainEqual({ value: 'admin', label: 'Operations administrator' });
  });

  test('uses an explicit platform-role label in generated forms and detail headers', () => {
    const schema = createUserManagementSchema(
      normalizeRoleOptions([user], undefined, 'multi'),
      'Global identity role',
    );
    const header = renderToStaticMarkup(createElement(UserDetailHeader, {
      user,
      roleLabel: 'Platform administrator',
    }));
    const createForm = renderToStaticMarkup(createElement(UserManagementCreateForm, {
      config: multiConfig,
      roleOptions: normalizeRoleOptions([], undefined, 'multi'),
      onSubmit: async () => {},
    }));

    expect(schema.fields.get('role')?.label).toBe('Global identity role');
    expect(header).toContain('Platform administrator');
    expect(createForm).toContain('Global identity role');
    expect(createForm).toContain('Workspace access is managed separately.');
  });
});
