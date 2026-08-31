/**
 * user-management-password-actions.tsx
 *
 * Builds available setup and password actions for one managed user. It renders
 * action descriptors only and delegates execution to the shared single-flight runner.
 */

import { KeyRound, LockKeyhole, LockOpen, Mail } from 'lucide-react';
import { toast } from 'sonner';
import type { NavigationAction } from '../../ui/record-navigation-bar';
import { modals } from '../../../modals';
import { UserManagementPasswordResetForm } from './user-management-password-reset-form';
import type { UserManagementActionPolicy } from './user-management-action-policy';
import type { UseAdminUsersResult, UserManagementUser } from './user-management-types';
import { startUserAction, type UserActionRunner } from './use-user-action-runner';

type PasswordOperations = Pick<UseAdminUsersResult,
  'sendSetupEmail' | 'sendPasswordReset' | 'clearPasswordChangeRequirement' | 'resetPassword'>;

/** Build setup-email, manual-password, and reset-email actions. */
export function buildUserPasswordActions(params: {
  user: UserManagementUser;
  policy: UserManagementActionPolicy;
  operations: PasswordOperations;
  runner: UserActionRunner;
}): NavigationAction[] {
  const { user, policy, operations, runner } = params;
  const disabled = runner.pending !== null;
  const actions: NavigationAction[] = [];

  if (policy.setupEmail) actions.push({
    icon: <Mail size={20} />, label: 'Setup Email', disabled,
    onClick: () => startUserAction(runner.run('setup-email', async () => {
      const sent = await operations.sendSetupEmail(user.userId);
      toast.success(sent ? 'Setup email sent' : 'Setup email accepted');
    })),
  });
  if (policy.setPassword) actions.push({
    icon: <KeyRound size={20} />, label: 'Set Password', variant: 'warning', disabled,
    onClick: () => modals.open({
      title: 'Set password', size: 'md',
      content: <UserManagementPasswordResetForm username={user.username} onSubmit={async (password) => {
        const completed = await runner.run('set-password', async () => {
          await operations.resetPassword(user.userId, password);
          toast.success('Password reset; existing sessions were revoked');
        });
        if (completed) modals.closeLast();
      }} />,
    }),
  });
  if (policy.resetEmail) actions.push({
    icon: <LockKeyhole size={20} />, label: 'Reset Email', variant: 'warning', disabled,
    onClick: () => startUserAction(runner.run('reset-email', async () => {
      await operations.sendPasswordReset(user.userId);
      toast.success('Password reset email sent; existing sessions were revoked');
    })),
  });
  if (policy.clearPasswordRequirement) actions.push({
    icon: <LockOpen size={20} />, label: 'Clear reset requirement', variant: 'warning', disabled,
    onClick: () => startUserAction(runner.confirmAndRun('clear-password-requirement', {
      title: 'Clear password reset requirement?',
      description: `This restores ${user.username}'s normal login without changing their password. Existing sessions and outstanding reset links will be invalidated.`,
      confirmLabel: 'Clear requirement',
    }, async () => {
      await operations.clearPasswordChangeRequirement(user.userId);
      toast.success('Password reset requirement cleared');
    })),
  });
  return actions;
}
