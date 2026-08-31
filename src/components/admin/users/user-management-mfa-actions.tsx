/**
 * user-management-mfa-actions.tsx
 *
 * Builds per-user MFA requirement and enrollment-reset action descriptors. It
 * delegates transport and single-flight interaction state to injected collaborators.
 */

import { ShieldMinus, ShieldPlus, ShieldX } from 'lucide-react';
import { toast } from 'sonner';
import type { NavigationAction } from '../../ui/record-navigation-bar';
import type { UserManagementActionPolicy } from './user-management-action-policy';
import type { UseAdminUsersResult, UserManagementUser } from './user-management-types';
import { startUserAction, type UserActionRunner } from './use-user-action-runner';

type MfaOperations = Pick<UseAdminUsersResult, 'requireMfa' | 'clearMfaRequirement' | 'resetMfa'>;

/** Build require, clear-requirement, and reset-enrollment MFA actions. */
export function buildUserMfaActions(params: {
  user: UserManagementUser;
  policy: UserManagementActionPolicy;
  operations: MfaOperations;
  runner: UserActionRunner;
  onChanged: () => void;
}): NavigationAction[] {
  const { user, policy, operations, runner, onChanged } = params;
  const disabled = runner.pending !== null;
  const actions: NavigationAction[] = [];
  if (policy.requireMfa) actions.push({
    icon: <ShieldPlus size={20} />, label: 'Require MFA', variant: 'warning', disabled,
    onClick: () => startUserAction(runner.run('require-mfa', async () => {
      await operations.requireMfa(user.userId);
      onChanged();
      toast.success('MFA required; existing sessions were revoked');
    })),
  });
  if (policy.clearMfa) actions.push({
    icon: <ShieldMinus size={20} />, label: 'Clear MFA Requirement', disabled,
    onClick: () => startUserAction(runner.run('clear-mfa', async () => {
      await operations.clearMfaRequirement(user.userId);
      onChanged();
      toast.success('Per-user MFA requirement cleared');
    })),
  });
  if (policy.resetMfa) actions.push({
    icon: <ShieldX size={20} />, label: 'Reset MFA', variant: 'warning', disabled,
    onClick: () => startUserAction(runner.confirmAndRun('reset-mfa', {
      title: 'Reset enrolled MFA?',
      description: `${user.username} will lose enrolled MFA methods and be signed out.`,
      confirmLabel: 'Reset MFA',
      destructive: true,
    }, async () => {
      const result = await operations.resetMfa(user.userId);
      onChanged();
      toast.success(`MFA reset; ${result.deletedMethods} method(s) removed`);
    })),
  });
  return actions;
}
