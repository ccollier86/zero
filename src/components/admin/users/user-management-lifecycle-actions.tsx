/**
 * user-management-lifecycle-actions.tsx
 *
 * Builds account session, suspension, activation, and deletion actions. It owns
 * confirmation copy only; server routes continue to enforce account invariants.
 */

import { Ban, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { NavigationAction } from '../../ui/record-navigation-bar';
import type { UserManagementActionPolicy } from './user-management-action-policy';
import type { UseAdminUsersResult, UserManagementUser } from './user-management-types';
import { startUserAction, type UserActionRunner } from './use-user-action-runner';

type LifecycleOperations = Pick<UseAdminUsersResult, 'revokeSessions' | 'suspendUser' | 'activateUser'>;

/** Build only lifecycle actions currently allowed for the selected user. */
export function buildUserLifecycleActions(params: {
  user: UserManagementUser;
  policy: UserManagementActionPolicy;
  operations: LifecycleOperations;
  deleteUser: (userId: string) => Promise<void>;
  runner: UserActionRunner;
}): NavigationAction[] {
  const { user, policy, operations, deleteUser, runner } = params;
  const disabled = runner.pending !== null;
  const actions: NavigationAction[] = [];
  if (policy.revokeSessions) actions.push({
    icon: <RotateCcw size={20} />, label: 'Revoke Sessions', variant: 'warning', disabled,
    onClick: () => startUserAction(runner.confirmAndRun('revoke-sessions', {
      title: 'Revoke all sessions?',
      description: `${user.username} will be signed out on every device.`,
      confirmLabel: 'Revoke sessions',
    }, async () => { await operations.revokeSessions(user.userId); toast.success('Sessions revoked'); })),
  });
  if (policy.suspend) actions.push({
    icon: <Ban size={20} />, label: 'Suspend', variant: 'warning', disabled,
    onClick: () => startUserAction(runner.confirmAndRun('suspend', {
      title: 'Suspend user?',
      description: `${user.username} will be blocked from signing in and signed out everywhere.`,
      confirmLabel: 'Suspend', destructive: true,
    }, async () => { await operations.suspendUser(user.userId); toast.success('User suspended'); })),
  });
  if (policy.activate) actions.push({
    icon: <ShieldCheck size={20} />, label: 'Activate', variant: 'success', disabled,
    onClick: () => startUserAction(runner.run('activate', async () => {
      await operations.activateUser(user.userId); toast.success('User activated');
    })),
  });
  if (policy.deleteUser) actions.push({
    icon: <Trash2 size={20} />, label: 'Delete', variant: 'destructive', disabled,
    onClick: () => startUserAction(runner.confirmAndRun('delete', {
      title: 'Delete user?', description: `${user.username} will no longer be able to sign in.`,
      confirmLabel: 'Delete', destructive: true, holdToConfirm: true,
    }, async () => { await deleteUser(user.userId); })),
  });
  return actions;
}
