'use client';

import * as React from 'react';
import { ArrowLeft } from 'lucide-react';
import type { AuthTenantMember, AuthTenantMembershipStatus } from '../../frontend/client/auth-types';
import type { UsePlatformTenantsResult } from '../../frontend/client/platform-administration-hooks';
import type { useAuthConfig } from '../../frontend/client/auth-hooks';
import { Button } from '#zero/components/ui/button';
import type { NavigationAction } from '#zero/components/ui/record-navigation-bar';
import type { PlatformWorkspaceRow } from './platform-workspace-schema';
import { TenantMemberManagementSurface } from './tenant-member-management-surface';
import { usePlatformWorkspaceMemberController } from './use-platform-workspace-member-controller';

export interface PlatformWorkspaceMemberManagementProps {
  workspace: PlatformWorkspaceRow;
  tenantSingular: string;
  directory: UsePlatformTenantsResult;
  configState: ReturnType<typeof useAuthConfig>;
  searchInput: string;
  setSearchInput: React.Dispatch<React.SetStateAction<string>>;
  status: AuthTenantMembershipStatus | 'all';
  setStatus: React.Dispatch<React.SetStateAction<AuthTenantMembershipStatus | 'all'>>;
  onBack(): void;
  detailContent?: (member: AuthTenantMember) => React.ReactNode;
  navigationActions?: (member: AuthTenantMember | null) => NavigationAction[];
  onSelectedMemberChange?: (member: AuthTenantMember | null) => void;
}

/** Full customer-workspace people manager within the adaptive platform control plane. */
export function PlatformWorkspaceMemberManagement({
  workspace,
  tenantSingular,
  directory,
  configState,
  searchInput,
  setSearchInput,
  status,
  setStatus,
  onBack,
  detailContent,
  navigationActions,
  onSelectedMemberChange,
}: PlatformWorkspaceMemberManagementProps) {
  const controller = usePlatformWorkspaceMemberController({
    directory,
    workspaceId: workspace.tenantId,
    workspaceStatus: workspace.status,
    tenantSingular,
    searchInput,
    setSearchInput,
    status,
    setStatus,
    onSelectedMemberChange,
  });

  return (
    <div className="min-h-0 flex-1 overflow-hidden p-3">
      <TenantMemberManagementSurface
        controller={controller}
        configState={configState}
        className="h-full min-h-0"
        title={`${workspace.name} people`}
        description={workspace.status === 'active'
          ? `Manage membership, roles, and effective permissions for this ${tenantSingular}.`
          : `View membership, roles, and effective permissions. This ${tenantSingular} is ${workspace.status}, so changes are unavailable.`}
        tenantSingular={tenantSingular}
        tenantKind="organization"
        headerLeading={(
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            autoFocus
            aria-label="Back to workspace directory"
            onClick={onBack}
          >
            <ArrowLeft />
          </Button>
        )}
        detailContent={detailContent}
        navigationActions={navigationActions}
        transferDescription={`The selected member becomes the owner of ${workspace.name}. Your platform administration session is unchanged.`}
      />
    </div>
  );
}
