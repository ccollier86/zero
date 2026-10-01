import { Ban, Crown, RotateCcw, Trash2 } from 'lucide-react';
import type { AuthTenantMember } from '../../frontend/client/auth-types';
import type { NavigationAction } from '#zero/components/ui/record-navigation-bar';
import type { ConfirmationAction } from './tenant-member-management-parts';

export function buildTenantMemberNavigationActions({
  member,
  actorMembershipId,
  canManageMembers,
  canTransferOwnership,
  busy,
  onReactivate,
  onConfirm,
}: {
  member: AuthTenantMember | null;
  actorMembershipId?: string;
  canManageMembers: boolean;
  canTransferOwnership: boolean;
  busy: boolean;
  onReactivate(member: AuthTenantMember): Promise<void>;
  onConfirm(action: ConfirmationAction, member: AuthTenantMember): void;
}): NavigationAction[] {
  if (!member) return [];
  const policy = resolveTenantMemberOperationPolicy({
    member,
    actorMembershipId,
    canManageMembers,
    canTransferOwnership,
  });
  const actions: NavigationAction[] = [];
  if (policy.suspend) actions.push({
    icon: <Ban size={18} />, label: 'Suspend Access', variant: 'warning', disabled: busy,
    onClick: () => onConfirm('suspend', member),
  });
  if (policy.reactivate) actions.push({
    icon: <RotateCcw size={18} />, label: 'Reactivate Access', variant: 'success', disabled: busy,
    onClick: () => { void onReactivate(member); },
  });
  if (policy.remove) actions.push({
    icon: <Trash2 size={18} />, label: 'Remove Access', variant: 'destructive', disabled: busy,
    onClick: () => onConfirm('remove', member),
  });
  if (policy.transferOwnership) actions.push({
    icon: <Crown size={18} />, label: 'Transfer ownership', disabled: busy,
    onClick: () => onConfirm('transfer', member),
  });
  return actions;
}

/** @internal Capability projection shared by bottom-bar rendering and policy tests. */
export function resolveTenantMemberOperationPolicy({
  member,
  actorMembershipId,
  canManageMembers,
  canTransferOwnership,
}: {
  member: AuthTenantMember;
  actorMembershipId?: string;
  canManageMembers: boolean;
  canTransferOwnership: boolean;
}) {
  const isActor = member.membershipId === actorMembershipId;
  const isOwner = member.roles.includes('owner');
  return {
    suspend: canManageMembers && member.status === 'active' && !isOwner,
    reactivate: canManageMembers && member.status === 'suspended',
    remove: canManageMembers && member.status !== 'removed' && !isOwner,
    transferOwnership: canTransferOwnership
      && !isActor
      && !isOwner
      && member.status === 'active',
  };
}
