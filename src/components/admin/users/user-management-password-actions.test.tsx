/** Focused action-descriptor regression for password-gate recovery. */

import { describe, expect, test } from 'bun:test';
import { buildUserPasswordActions } from './user-management-password-actions';
import type { UserManagementActionPolicy } from './user-management-action-policy';
import type { UserManagementUser } from './user-management-types';

const user = {
  id: 'target', userId: 'target', username: 'target', email: 'target@test.com',
  firstName: '', lastName: '', role: 'user', status: 'active',
  passwordChangeRequired: true, emailVerifiedAt: 1,
  emailVerificationRequired: false, mfaRequired: false, properties: {},
  createdAt: 1, updatedAt: 2,
} satisfies UserManagementUser;

const policy: UserManagementActionPolicy = {
  setupEmail: false,
  setPassword: false,
  resetEmail: false,
  clearPasswordRequirement: true,
  sendVerification: false,
  verifyEmail: false,
  revokeSessions: false,
  suspend: false,
  activate: false,
  deleteUser: false,
  requireMfa: false,
  clearMfa: false,
  resetMfa: false,
};

describe('password management actions', () => {
  test('requires confirmation before clearing an existing reset requirement', () => {
    let confirmation: { title: string; confirmLabel: string } | undefined;
    const actions = buildUserPasswordActions({
      user,
      policy,
      operations: {
        sendSetupEmail: async () => true,
        sendPasswordReset: async () => {},
        clearPasswordChangeRequirement: async () => user,
        resetPassword: async () => {},
      },
      runner: {
        pending: null,
        run: async () => true,
        confirmAndRun: async (_key, details) => {
          confirmation = details;
          return true;
        },
      },
    });

    const action = actions.find((candidate) => candidate.label === 'Clear reset requirement');
    expect(action).toBeDefined();
    action!.onClick();
    expect(confirmation).toMatchObject({
      title: 'Clear password reset requirement?',
      confirmLabel: 'Clear requirement',
    });
  });
});
