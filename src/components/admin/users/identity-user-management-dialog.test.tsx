import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AuthAdminConfig } from '../../../frontend/client/auth-client';
import { IdentityUserManagement } from './user-management';
import type { UserManagementUser } from './user-management-types';

const user: UserManagementUser = {
  id: 'user-ada',
  userId: 'user-ada',
  username: 'ada',
  email: 'ada@example.test',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'user',
  status: 'active',
  passwordChangeRequired: false,
  emailVerifiedAt: Date.UTC(2026, 0, 1),
  emailVerificationRequired: false,
  mfaRequired: false,
  properties: {},
  createdAt: Date.UTC(2026, 0, 1),
  updatedAt: Date.UTC(2026, 0, 2),
};

describe('identity user management account editing', () => {
  test('keeps the public controlled identity manager inline by default', () => {
    const markup = renderToStaticMarkup(createElement(IdentityUserManagement, {
      data: [user],
      config: adminConfig(),
      onCreate: async () => {},
      onUpdate: async () => user,
    }));

    expect(markup).toContain('Save Changes');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).not.toContain('Edit Account');
    expect(markup).not.toContain('Account information');
  });

  test('moves profile editing into the standard action bar when requested', () => {
    const markup = renderToStaticMarkup(createElement(IdentityUserManagement, {
      data: [user],
      config: adminConfig(),
      onUpdate: async () => user,
      accountEditMode: 'dialog',
    }));

    expect(markup).toContain('Account information');
    expect(markup).toContain('Global identity role');
    expect(markup).toContain('aria-label="Edit Account"');
    expect(markup).not.toContain('Save Changes');
  });
});

function adminConfig(): AuthAdminConfig {
  return {
    tenancy: { mode: 'multi' },
    registration: {
      mode: 'public',
      bootstrapRequired: false,
      publicRegistrationEnabled: true,
    },
    email: { enabled: false, provider: 'none', hasPublicUrl: false },
    accountEmails: {
      adminCreatedUser: false,
      passwordReset: false,
      passwordChangedNotice: false,
      manualPasswordReset: false,
      actionTokenTTL: '15m',
      requestCooldown: '1m',
      resetPath: '/reset-password',
      setupPath: '/setup-account',
    },
    account: {
      requireEmailVerification: false,
      emailVerificationPath: '/verify-email',
      emailVerificationReady: false,
      allowAdminMarkEmailVerified: false,
    },
    capabilities: {
      canManageUsers: true,
      canManageGlobalAdmins: true,
      manualPasswordReset: false,
      setupEmail: false,
      passwordResetEmail: false,
      emailVerification: false,
      adminMarkEmailVerified: false,
      mfa: false,
      suspendUsers: false,
      promoteAdmins: true,
      userProperties: false,
    },
    userProperties: {},
    strictUserProperties: true,
  } as AuthAdminConfig;
}
