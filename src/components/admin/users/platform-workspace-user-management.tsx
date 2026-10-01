'use client';

import * as React from 'react';
import type { AuthTenantMember } from '../../../frontend/client/auth-types';
import {
  PlatformWorkspaceManagement,
  type PlatformWorkspaceManagementProps,
} from '../../auth/platform-workspace-management';
import { TenantMemberAccountDetail } from './tenant-member-account-detail';
import { useTenantMemberAccountAdministration } from './use-tenant-member-account-administration';

/** Add platform-only global account controls to customer-workspace membership management. */
export function PlatformWorkspaceUserManagement({
  memberDetailContent,
  memberNavigationActions,
  onSelectedMemberChange,
  ...props
}: PlatformWorkspaceManagementProps) {
  const [selectedMember, setSelectedMember] = React.useState<AuthTenantMember | null>(null);
  const account = useTenantMemberAccountAdministration(selectedMember);
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
    const additional = memberDetailContent?.(member) ?? null;
    if (!accountDetail && !additional) return null;
    return <>{accountDetail}{additional}</>;
  }, [account, memberDetailContent]);
  const renderActions = React.useCallback((member: AuthTenantMember | null) => [
    ...account.navigationActions(member),
    ...(memberNavigationActions?.(member) ?? []),
  ], [account.navigationActions, memberNavigationActions]);

  return (
    <PlatformWorkspaceManagement
      {...props}
      memberDetailContent={renderDetail}
      memberNavigationActions={renderActions}
      onSelectedMemberChange={handleSelection}
    />
  );
}
