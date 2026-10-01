import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  AuthAdminConfig,
} from '../../../frontend/client/auth-client';
import type { AuthAuthorizationSnapshot } from '../../../frontend/client/auth-authorization-types';
import { buildTenantMemberNavigationActions } from '../../auth/tenant-member-management-actions';
import { resolveTenantAccountAdministrationAccess } from './tenant-account-access';
import { TenantMemberAccountDetail } from './tenant-member-account-detail';
import {
  buildTenantAccountNavigationActions,
  qualifyAccountNavigationActions,
} from './tenant-account-navigation-actions';
import { TenantScopedUserManagement } from './tenant-scoped-user-management';
import type { UserManagementUser } from './user-management-types';

const account: UserManagementUser = {
  id: 'user-ada',
  userId: 'user-ada',
  username: 'ada',
  email: 'ada@example.test',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'user',
  status: 'active',
  passwordChangeRequired: true,
  emailVerifiedAt: null,
  emailVerificationRequired: true,
  mfaRequired: false,
  properties: {},
  createdAt: Date.UTC(2026, 0, 2),
  updatedAt: Date.UTC(2026, 0, 3),
};

describe('tenant member account augmentation', () => {
  test('fails closed before authorization is ready and for tenant-only managers', () => {
    expect(resolveTenantAccountAdministrationAccess({
      ready: false,
      authorization: authorization(['application.users:read', 'application.users:manage']),
    })).toEqual({ canReadAccounts: false, canManageAccounts: false });
    expect(resolveTenantAccountAdministrationAccess({
      ready: true,
      authorization: authorization([], ['tenant.members:manage']),
    })).toEqual({ canReadAccounts: false, canManageAccounts: false });
  });

  test('separates read-only account projection from account mutation authority', () => {
    expect(resolveTenantAccountAdministrationAccess({
      ready: true,
      authorization: authorization(['application.users:read']),
    })).toEqual({ canReadAccounts: true, canManageAccounts: false });
    expect(resolveTenantAccountAdministrationAccess({
      ready: true,
      authorization: authorization(['application.users:read', 'application.users:manage']),
    })).toEqual({ canReadAccounts: true, canManageAccounts: true });
  });

  test('makes account and membership lifecycle commands unambiguous in one bar', () => {
    expect(qualifyAccountNavigationActions([
      { icon: null, label: 'Suspend', onClick() {} },
      { icon: null, label: 'Activate', onClick() {} },
      { icon: null, label: 'Revoke Sessions', onClick() {} },
    ]).map((action) => action.label)).toEqual([
      'Suspend Account',
      'Reactivate Account',
      'Revoke Sessions',
    ]);

    const accountActions = buildTenantAccountNavigationActions({
      user: account,
      canEdit: true,
      accountActions: [{ icon: null, label: 'Suspend', onClick() {} }],
      onEdit() {},
    });
    expect(accountActions.map((action) => action.label)).toEqual([
      'Edit Account',
      'Suspend Account',
    ]);

    const membershipActions = buildTenantMemberNavigationActions({
      member: {
        membershipId: 'membership-ada',
        identity: {
          userId: account.userId,
          username: account.username,
          email: account.email,
          firstName: account.firstName,
          lastName: account.lastName,
        },
        status: 'active',
        roles: ['member'],
        roleRevision: 'revision-1',
        joinedAt: 1,
        updatedAt: 1,
      },
      canManageMembers: true,
      canTransferOwnership: false,
      busy: false,
      onReactivate: async () => {},
      onConfirm() {},
    });
    expect(membershipActions.map((action) => action.label)).toEqual([
      'Suspend Access',
      'Remove Access',
    ]);
  });

  test('renders account status and established security notices in the member detail pane', () => {
    const markup = renderToStaticMarkup(createElement(TenantMemberAccountDetail, {
      user: account,
      config: adminConfig(),
      loading: false,
      error: null,
      mfaStatus: null,
      mfaLoading: false,
      mfaError: null,
      canManage: false,
      onRetry() {},
      onUpdateProperties: async () => {},
    }));

    expect(markup).toContain('Account');
    expect(markup).toContain('Global identity role');
    expect(markup).toContain('Password setup required');
    expect(markup).toContain('Email verification pending');
    expect(markup).not.toContain('Save properties');
  });

  test('keeps the tenant-only surface usable without a provider or account probe', () => {
    const markup = renderToStaticMarkup(createElement(TenantScopedUserManagement));
    expect(markup).toContain('Organization members');
    expect(markup).toContain('data-slot="record-navigation-bar"');
    expect(markup).not.toContain('Global identity role');
    expect(markup).not.toContain('Edit Account');
  });
});

function authorization(
  applicationPermissions: string[],
  tenantPermissions: string[] = [],
): AuthAuthorizationSnapshot {
  return {
    version: 1,
    identity: { userId: 'actor', platformRole: 'user' },
    profile: { tenancy: 'multi', authorization: 'advanced' },
    scope: {
      kind: 'tenant',
      scopeId: 'tenant-1',
      tenantId: 'tenant-1',
      membershipId: 'membership-actor',
      roles: ['manager'],
      permissions: tenantPermissions,
      allPermissions: false,
      revision: 'tenant-revision',
    },
    applicationScope: applicationPermissions.length > 0 ? {
      kind: 'tenant',
      scopeId: 'administration-tenant',
      tenantId: 'administration-tenant',
      membershipId: 'administration-membership',
      roles: ['administrator'],
      permissions: applicationPermissions,
      allPermissions: false,
      revision: 'application-revision',
    } : null,
    revision: 'authorization-revision',
  };
}

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
      requireEmailVerification: true,
      emailVerificationPath: '/verify-email',
      emailVerificationReady: false,
      allowAdminMarkEmailVerified: false,
    },
    capabilities: {
      canManageUsers: false,
      canManageGlobalAdmins: false,
      manualPasswordReset: false,
      setupEmail: false,
      passwordResetEmail: false,
      emailVerification: false,
      adminMarkEmailVerified: false,
      mfa: false,
      suspendUsers: false,
      promoteAdmins: false,
      userProperties: false,
    },
    userProperties: {},
    strictUserProperties: true,
  } as AuthAdminConfig;
}
