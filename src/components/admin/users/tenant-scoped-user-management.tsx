'use client';

import * as React from 'react';
import type { AuthTenantMember } from '../../../frontend/client/auth-types';
import {
  TenantMemberManagement,
  type TenantMemberManagementProps,
} from '../../auth/tenant-member-management';
import { useTenantInvitationAction } from '../../auth/use-tenant-invitation-action';
import { TenantMemberAccountDetail } from './tenant-member-account-detail';
import { useTenantMemberAccountAdministration } from './use-tenant-member-account-administration';

export type TenantScopedUserManagementProps = TenantMemberManagementProps;

/**
 * Adaptive member manager that enriches tenant access with global account
 * controls only when the current actor has application-user authority.
 */
export function TenantScopedUserManagement({
  detailContent,
  navigationActions,
  onSelectedMemberChange,
  secondaryPrimaryAction,
  ...props
}: TenantScopedUserManagementProps) {
  const [selectedMember, setSelectedMember] = React.useState<AuthTenantMember | null>(null);
  const account = useTenantMemberAccountAdministration(selectedMember);
  const invitation = useTenantInvitationAction();
  const handleSelection = React.useCallback((member: AuthTenantMember | null) => {
    setSelectedMember(member);
    onSelectedMemberChange?.(member);
  }, [onSelectedMemberChange]);
  const renderDetail = React.useCallback((member: AuthTenantMember): React.ReactNode => {
    const accountDetail = account.access.canReadAccounts ? (
      <TenantMemberAccountDetail
        user={account.user?.userId === member.identity.userId ? account.user : null}
        config={account.config}
        loading={account.loading}
        error={account.error}
        mfaStatus={account.mfa.status}
        mfaLoading={account.mfa.loading}
        mfaError={account.mfa.error}
        canManage={account.canManageTarget}
        onRetry={() => { void account.retry().catch(() => {}); }}
        onUpdateProperties={account.updateProperties}
        onDeleteProperty={account.canManageTarget ? account.deleteProperty : undefined}
      />
    ) : null;
    const additional = detailContent?.(member) ?? null;
    if (!accountDetail && !additional) return null;
    return <>{accountDetail}{additional}</>;
  }, [account, detailContent]);
  const renderActions = React.useCallback((member: AuthTenantMember | null) => [
    ...account.navigationActions(member),
    ...(navigationActions?.(member) ?? []),
  ], [account.navigationActions, navigationActions]);

  return (
    <>
      <TenantMemberManagement
        {...props}
        detailContent={renderDetail}
        navigationActions={renderActions}
        secondaryPrimaryAction={secondaryPrimaryAction ?? invitation.secondaryPrimaryAction}
        onSelectedMemberChange={handleSelection}
      />
      {invitation.dialog}
    </>
  );
}
