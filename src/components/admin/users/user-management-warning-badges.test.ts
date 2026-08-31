/** Dark-mode contrast regressions for admin-user warning badges. */

import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AuthAdminConfig } from '../../../frontend/client/auth-client';
import { badgeVariants } from '../../ui/badge';
import { UserManagementReadiness } from './user-management-readiness';
import { UserManagementSecurityPanel } from './user-management-security-panel';
import type { UserManagementUser } from './user-management-types';

const user = {
  id: 'target', userId: 'target', username: 'target', email: 'target@example.com',
  firstName: '', lastName: '', role: 'user', status: 'active',
  passwordChangeRequired: true, emailVerifiedAt: null,
  emailVerificationRequired: false, mfaRequired: false, properties: {},
  createdAt: 1, updatedAt: null,
} satisfies UserManagementUser;

const unavailableEmailConfig = {
  email: { enabled: true, hasPublicUrl: false },
  account: { requireEmailVerification: false, emailVerificationReady: true },
  mfa: { enabled: false, ready: true },
  capabilities: {
    setupEmail: true,
    passwordResetEmail: false,
    emailVerification: false,
  },
} as AuthAdminConfig;

describe('admin user warning badges', () => {
  test('shared warning variant uses readable theme colors in both modes', () => {
    const classes = badgeVariants({ variant: 'warning' });

    expect(classes).toContain('text-warning-foreground');
    expect(classes).toContain('dark:text-warning');
    expect(classes).toContain('bg-warning/10');
    expect(classes).toContain('dark:bg-warning/15');
  });

  test('security notices use the warning variant above Properties', () => {
    const markup = renderToStaticMarkup(createElement(UserManagementSecurityPanel, {
      user, mfaStatus: null, loading: false, error: null,
    }));

    expect(markup).toContain('Password setup required');
    expect(markup).toContain('dark:text-warning');
  });

  test('readiness heading and badge both override the dark warning foreground', () => {
    const markup = renderToStaticMarkup(createElement(UserManagementReadiness, {
      config: unavailableEmailConfig, loading: false,
    }));

    expect(markup).toContain('Email actions need a public URL');
    expect(markup.match(/dark:text-warning/g)).toHaveLength(2);
  });
});
