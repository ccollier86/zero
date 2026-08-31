'use client';

/**
 * use-user-management-navigation-actions.tsx
 *
 * Composes focused action builders into the selected-user navigation contract.
 * It owns action grouping only; policy, transport, and dialogs stay delegated.
 */

import * as React from 'react';
import type { AuthAdminConfig, AuthAdminUserMfaStatus } from '../../../frontend/client/auth-client';
import type { NavigationAction } from '../../ui/record-navigation-bar';
import { resolveUserManagementActionPolicy } from './user-management-action-policy';
import { buildUserLifecycleActions } from './user-management-lifecycle-actions';
import { buildUserMfaActions } from './user-management-mfa-actions';
import { buildUserPasswordActions } from './user-management-password-actions';
import { buildUserVerificationActions } from './user-management-verification-actions';
import type { UseAdminUsersResult, UserManagementUser } from './user-management-types';
import { useUserActionRunner } from './use-user-action-runner';

type Operations = Pick<UseAdminUsersResult,
  'sendSetupEmail' | 'sendPasswordReset' | 'clearPasswordChangeRequirement'
  | 'resetPassword' | 'sendVerificationEmail'
  | 'verifyEmail' | 'requireMfa' | 'clearMfaRequirement' | 'resetMfa'
  | 'revokeSessions' | 'suspendUser' | 'activateUser'>;

/** Return policy-filtered, single-flight actions for MasterDetail navigation. */
export function useUserManagementNavigationActions(params: {
  config: AuthAdminConfig | null;
  mfaStatus: AuthAdminUserMfaStatus | null;
  currentUserId: string | null;
  controlled: boolean;
  controlledDelete: boolean;
  operations: Operations;
  deleteUser: (userId: string) => Promise<void>;
  onSecurityChanged: () => void;
}) {
  const runner = useUserActionRunner();
  const { operations } = params;
  const navigationActions = React.useCallback((user: UserManagementUser | null): NavigationAction[] => {
    if (!user) return [];
    const policy = resolveUserManagementActionPolicy({
      user,
      config: params.config,
      mfaStatus: params.mfaStatus,
      currentUserId: params.currentUserId,
      controlled: params.controlled,
      controlledDelete: params.controlledDelete,
    });
    const shared = { user, policy, runner };
    return [
      ...buildUserPasswordActions({ ...shared, operations }),
      ...buildUserVerificationActions({ ...shared, operations }),
      ...buildUserMfaActions({ ...shared, operations, onChanged: params.onSecurityChanged }),
      ...buildUserLifecycleActions({ ...shared, operations, deleteUser: params.deleteUser }),
    ];
  }, [
    operations, params.config, params.controlled, params.controlledDelete,
    params.currentUserId, params.deleteUser, params.mfaStatus,
    params.onSecurityChanged, runner,
  ]);

  return { navigationActions, pendingAction: runner.pending };
}
