/**
 * user-management-verification-actions.tsx
 *
 * Builds email-verification actions for a pending user. Capability policy is
 * resolved by the caller and mutations stay in the live admin-user hook.
 */

import { BadgeCheck, MailCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { NavigationAction } from '../../ui/record-navigation-bar';
import type { UserManagementActionPolicy } from './user-management-action-policy';
import type { UseAdminUsersResult, UserManagementUser } from './user-management-types';
import { startUserAction, type UserActionRunner } from './use-user-action-runner';

type VerificationOperations = Pick<UseAdminUsersResult, 'sendVerificationEmail' | 'verifyEmail'>;

/** Build send-link and explicit admin-override verification actions. */
export function buildUserVerificationActions(params: {
  user: UserManagementUser;
  policy: UserManagementActionPolicy;
  operations: VerificationOperations;
  runner: UserActionRunner;
}): NavigationAction[] {
  const { user, policy, operations, runner } = params;
  const disabled = runner.pending !== null;
  const actions: NavigationAction[] = [];
  if (policy.sendVerification) actions.push({
    icon: <MailCheck size={20} />, label: 'Verify Email Link', disabled,
    onClick: () => startUserAction(runner.run('verification-email', async () => {
      await operations.sendVerificationEmail(user.userId);
      toast.success('Verification email sent');
    })),
  });
  if (policy.verifyEmail) actions.push({
    icon: <BadgeCheck size={20} />, label: 'Mark Email Verified', variant: 'warning', disabled,
    onClick: () => startUserAction(runner.confirmAndRun('verify-email', {
      title: 'Mark email verified?',
      description: `This bypasses proof of inbox ownership for ${user.email}.`,
      confirmLabel: 'Mark verified',
    }, async () => {
      await operations.verifyEmail(user.userId);
      toast.success('Email marked verified');
    })),
  });
  return actions;
}
