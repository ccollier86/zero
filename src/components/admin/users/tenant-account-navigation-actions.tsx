import { Pencil } from 'lucide-react';
import type { NavigationAction } from '../../ui/record-navigation-bar';
import type { UserManagementUser } from './user-management-types';

const ACCOUNT_ACTION_LABELS: Readonly<Record<string, string>> = Object.freeze({
  Suspend: 'Suspend Account',
  Activate: 'Reactivate Account',
  Delete: 'Delete Account',
});

/** Clarify lifecycle actions when account and membership controls share a bar. */
export function qualifyAccountNavigationActions(
  actions: readonly NavigationAction[],
): NavigationAction[] {
  return actions.map((action) => ({
    ...action,
    label: ACCOUNT_ACTION_LABELS[action.label] ?? action.label,
  }));
}

/** Prepend the standard profile edit command to established account actions. */
export function buildTenantAccountNavigationActions({
  user,
  canEdit,
  accountActions,
  onEdit,
}: {
  user: UserManagementUser | null;
  canEdit: boolean;
  accountActions: readonly NavigationAction[];
  onEdit(user: UserManagementUser): void;
}): NavigationAction[] {
  if (!user) return [];
  const actions = qualifyAccountNavigationActions(accountActions);
  if (!canEdit) return actions;
  return [{
    icon: <Pencil size={18} />,
    label: 'Edit Account',
    onClick: () => onEdit(user),
  }, ...actions];
}
