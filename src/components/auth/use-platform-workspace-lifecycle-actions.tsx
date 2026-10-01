'use client';

import * as React from 'react';
import { PauseCircle, PlayCircle } from 'lucide-react';
import type {
  AuthPlatformMutableTenantStatus,
  AuthPlatformTenant,
} from '../../frontend/client/auth-platform-administration-types';
import type { UsePlatformTenantsResult } from '../../frontend/client/platform-administration-hooks';
import { modals } from '../../modals';
import type { NavigationAction } from '../ui/record-navigation-bar';
import { toast } from 'sonner';
import type { PlatformWorkspaceRow } from './platform-workspace-schema';

export interface PlatformWorkspaceLifecycleSnapshot {
  canManage: boolean;
  isMutating: boolean;
  tenants: readonly AuthPlatformTenant[];
}

/** Keep lifecycle confirmations capability- and revision-safe while they are open. */
export function usePlatformWorkspaceLifecycleActions(params: {
  singular: string;
  directory: UsePlatformTenantsResult;
}) {
  const canManage = params.directory.config?.capabilities.canManageTenants === true;
  const isMutating = params.directory.isMutating;
  const snapshotRef = React.useRef<PlatformWorkspaceLifecycleSnapshot>({
    canManage: false,
    isMutating: false,
    tenants: [],
  });
  snapshotRef.current = {
    canManage,
    isMutating,
    tenants: params.directory.tenants,
  };

  const changeStatus = React.useCallback(async (
    workspace: PlatformWorkspaceRow,
    nextStatus: AuthPlatformMutableTenantStatus,
  ) => {
    const activating = nextStatus === 'active';
    const confirmed = await modals.confirm({
      title: `${activating ? 'Reactivate' : 'Suspend'} ${params.singular}?`,
      description: activating
        ? `${workspace.name} can resume customer access after this change.`
        : `${workspace.name} will lose customer data-plane access until reactivated.`,
      confirmLabel: `${activating ? 'Reactivate' : 'Suspend'} ${params.singular}`,
      variant: activating ? 'default' : 'destructive',
    });
    if (!confirmed) return;

    const target = resolvePlatformWorkspaceLifecycleTarget(
      snapshotRef.current,
      workspace.tenantId,
    );
    if (!target) {
      toast.error(`This ${params.singular} can no longer be changed from the current scope.`);
      return;
    }
    if (target.status === nextStatus) return;

    try {
      const result = await params.directory.setTenantStatus(target, nextStatus);
      toast.success(`${activating ? 'Reactivated' : 'Suspended'} ${result.tenant.name}`);
    } catch {
      // The fenced directory hook owns the single visible error and emits the
      // standardized frontend auth failure code.
    }
  }, [params.directory.setTenantStatus, params.singular]);

  return React.useCallback((workspace: PlatformWorkspaceRow | null): NavigationAction[] => {
    if (!workspace
      || workspace.status === 'archived'
      || !canManage) return [];

    const activating = workspace.status !== 'active';
    return [{
      icon: activating ? <PlayCircle /> : <PauseCircle />,
      label: `${activating ? 'Reactivate' : 'Suspend'} ${params.singular}`,
      variant: activating ? 'success' : 'destructive',
      disabled: isMutating,
      onClick: () => {
        void changeStatus(workspace, activating ? 'active' : 'suspended');
      },
    }];
  }, [canManage, changeStatus, isMutating, params.singular]);
}

/** Resolve the current SDK projection only while the actor still has authority. */
export function resolvePlatformWorkspaceLifecycleTarget(
  snapshot: PlatformWorkspaceLifecycleSnapshot,
  tenantId: string,
): AuthPlatformTenant | null {
  if (!snapshot.canManage || snapshot.isMutating) return null;
  const tenant = snapshot.tenants.find((candidate) => candidate.tenantId === tenantId) ?? null;
  return tenant?.status === 'archived' ? null : tenant;
}
