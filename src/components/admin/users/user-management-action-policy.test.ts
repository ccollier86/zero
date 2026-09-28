/** Pure policy regressions for the admin-user management surface. */

import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AuthAdminConfig, AuthAdminUserMfaStatus } from '../../../frontend/client/auth-client';
import {
  canCreateManagedUser,
  resolveUserManagementActionPolicy,
} from './user-management-action-policy';
import { getUserManagementEditableFields } from './user-management-schema';
import { getAuthReadinessWarnings } from './user-management-readiness';
import { UserManagementSecurityPanel } from './user-management-security-panel';
import { UserDetailHeader } from './user-detail-header';
import { UserManagementCreateForm } from './user-management-create-form';
import type { UserManagementUser } from './user-management-types';

const user = {
  id: 'target', userId: 'target', username: 'target', email: 'target@test.com',
  firstName: '', lastName: '', role: 'user', status: 'active',
  passwordChangeRequired: false, emailVerifiedAt: null,
  emailVerificationRequired: true, mfaRequired: false, properties: {},
  createdAt: 1, updatedAt: null,
} satisfies UserManagementUser;

function config(overrides: Partial<AuthAdminConfig['capabilities']> = {}): AuthAdminConfig {
  return {
    registration: { mode: 'admin-only' },
    email: { enabled: true, provider: 'memory', hasPublicUrl: true },
    accountEmails: {
      adminCreatedUser: true,
      passwordReset: true,
      passwordChangedNotice: true,
      emailVerification: true,
      manualPasswordReset: true,
      actionTokenTTL: '1h',
      requestCooldown: '5m',
      resetPath: '/reset-password',
      setupPath: '/setup-password',
    },
    account: {
      requireEmailVerification: false,
      emailVerificationPath: '/verify-email',
      emailVerificationReady: true,
      allowAdminMarkEmailVerified: true,
    },
    mfa: { enabled: false, ready: false },
    capabilities: {
      setupEmail: true, manualPasswordReset: true, passwordResetEmail: true,
      emailVerification: true, adminMarkEmailVerified: true, mfa: true,
      suspendUsers: true, promoteAdmins: true, userProperties: true, ...overrides,
    },
  } as unknown as AuthAdminConfig;
}

const mfaStatus = {
  required: false,
  requirement: 'none',
  methods: [{ methodId: 'm1', type: 'totp', status: 'active' }],
} as AuthAdminUserMfaStatus;

describe('admin user UI policy', () => {
  test('disables admin creation when registration is disabled', () => {
    const disabled = config();
    disabled.registration.mode = 'disabled';
    expect(canCreateManagedUser(disabled)).toBe(false);
    expect(canCreateManagedUser(config())).toBe(true);
  });

  test('hides every destructive action for the current user', () => {
    const policy = resolveUserManagementActionPolicy({
      user, config: config(), mfaStatus, currentUserId: user.userId,
      controlled: false, controlledDelete: false,
    });
    expect(Object.values(policy).every((allowed) => !allowed)).toBe(true);
  });

  test('exposes ready verification and MFA actions for another user', () => {
    const policy = resolveUserManagementActionPolicy({
      user, config: config(), mfaStatus, currentUserId: 'admin',
      controlled: false, controlledDelete: false,
    });
    expect(policy.sendVerification).toBe(true);
    expect(policy.verifyEmail).toBe(true);
    expect(policy.requireMfa).toBe(true);
    expect(policy.resetMfa).toBe(true);
  });

  test('controlled mode exposes only an explicitly handled delete', () => {
    const policy = resolveUserManagementActionPolicy({
      user, config: config(), mfaStatus, currentUserId: 'admin',
      controlled: true, controlledDelete: true,
    });
    expect(policy.deleteUser).toBe(true);
    expect(Object.entries(policy).filter(([key]) => key !== 'deleteUser').every(([, value]) => !value)).toBe(true);
  });

  test('hides live hard deletion in multi-tenant mode and offers suspension', () => {
    const multi = config();
    multi.tenancy = {
      mode: 'multi',
      terminology: { singular: 'organization', plural: 'organizations' },
      creation: { mode: 'authenticated' },
    } as NonNullable<AuthAdminConfig['tenancy']>;
    const policy = resolveUserManagementActionPolicy({
      user, config: multi, mfaStatus, currentUserId: 'admin',
      controlled: false, controlledDelete: false,
    });

    expect(policy.deleteUser).toBe(false);
    expect(policy.suspend).toBe(true);
  });

  test('fails live deletion closed until admin config is loaded', () => {
    const policy = resolveUserManagementActionPolicy({
      user, config: null, mfaStatus, currentUserId: 'admin',
      controlled: false, controlledDelete: false,
    });
    expect(policy.deleteUser).toBe(false);
  });

  test('generic fields exclude status and policy-gate MFA', () => {
    const unavailable = config({ mfa: false });
    expect(getUserManagementEditableFields(unavailable)).not.toContain('status');
    expect(getUserManagementEditableFields(unavailable)).not.toContain('passwordChangeRequired');
    expect(getUserManagementEditableFields(unavailable)).not.toContain('mfaRequired');
    expect(getUserManagementEditableFields(config())).toContain('mfaRequired');
  });

  test('create form exposes only the deliverable setup-email gate', () => {
    const markup = renderToStaticMarkup(createElement(UserManagementCreateForm, {
      config: config(),
      roleOptions: [{ value: 'user', label: 'User' }],
      onSubmit: async () => {},
    }));

    expect(markup).toContain('Send account setup email');
    expect(markup).not.toContain('Require password change');
  });

  test('offers password-gate recovery only for another currently gated user', () => {
    const normal = resolveUserManagementActionPolicy({
      user, config: config(), mfaStatus: null, currentUserId: 'admin',
      controlled: false, controlledDelete: false,
    });
    const gated = resolveUserManagementActionPolicy({
      user: { ...user, passwordChangeRequired: true },
      config: config(), mfaStatus: null, currentUserId: 'admin',
      controlled: false, controlledDelete: false,
    });
    const self = resolveUserManagementActionPolicy({
      user: { ...user, passwordChangeRequired: true },
      config: config(), mfaStatus: null, currentUserId: user.userId,
      controlled: false, controlledDelete: false,
    });

    expect(normal.clearPasswordRequirement).toBe(false);
    expect(normal.setupEmail).toBe(false);
    expect(normal.resetEmail).toBe(true);
    expect(gated.clearPasswordRequirement).toBe(true);
    expect(gated.setupEmail).toBe(true);
    expect(self.clearPasswordRequirement).toBe(false);
  });

  test('self editing excludes role and access-gate fields', () => {
    const fields = getUserManagementEditableFields(config(), { isSelf: true });
    expect(fields).not.toContain('role');
    expect(fields).not.toContain('passwordChangeRequired');
    expect(fields).not.toContain('mfaRequired');
  });

  test('hides normal readiness and security diagnostics', () => {
    const normalUser = {
      ...user,
      emailVerifiedAt: 1,
      emailVerificationRequired: false,
    };
    const normalMfa = {
      required: false,
      requirement: 'none',
      methods: [],
    } as AuthAdminUserMfaStatus;

    expect(getAuthReadinessWarnings(config())).toEqual([]);
    expect(renderToStaticMarkup(createElement(UserManagementSecurityPanel, {
      user: normalUser,
      mfaStatus: normalMfa,
      loading: false,
      error: null,
    }))).toBe('');
  });

  test('keeps actionable readiness and user security warnings visible', () => {
    const unavailable = config();
    unavailable.email.hasPublicUrl = false;
    unavailable.account.requireEmailVerification = true;
    unavailable.account.emailVerificationReady = false;
    unavailable.mfa = { enabled: true, ready: false } as AuthAdminConfig['mfa'];

    expect(getAuthReadinessWarnings(unavailable)).toEqual([
      'Email actions need a public URL',
      'Email verification is not ready',
      'MFA is enabled but not ready',
    ]);

    const markup = renderToStaticMarkup(createElement(UserManagementSecurityPanel, {
      user: { ...user, passwordChangeRequired: true, mfaRequired: true },
      mfaStatus: { required: true, requirement: 'user', methods: [] },
      loading: false,
      error: null,
    }));
    expect(markup).toContain('Email verification pending');
    expect(markup).toContain('Password setup required');
    expect(markup).toContain('MFA enrollment required');
  });

  test('does not repeat an email-shaped username in the compact header', () => {
    const email = 'casey@example.com';
    const markup = renderToStaticMarkup(createElement(UserDetailHeader, {
      user: { ...user, username: email, email, firstName: 'Casey', lastName: 'Collier' },
    }));

    expect(markup.match(/casey@example\.com/g)).toHaveLength(1);
    expect(markup).not.toContain('Joined');
  });
});
