'use client';

import * as React from 'react';
import { useAuth, useAuthConfig } from './auth-hooks';
import { useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import { useClientMaybe } from './client-context';
import { usePlatformAdministrationConfigSlice } from './platform-administration-config-slice';
import { usePlatformAdministrationInvitationSlice } from './platform-administration-invitation-slice';
import { usePlatformAdministrationMemberSlice } from './platform-administration-member-slice';
import {
  resolvePlatformAdministrationInvitationPolicy,
  type UsePlatformAdministrationOptions,
  type UsePlatformAdministrationResult,
} from './platform-administration-state';
import type { PlatformAdministrationSliceScope } from './platform-administration-slice-utils';
import type { InternalClient } from './sdk';
import {
  TenantAdministrationBoundaryFence,
  tenantAdministrationBoundaryKey,
} from './tenant-administration-boundary';

export {
  usePlatformTenants,
  type UsePlatformTenantsOptions,
  type UsePlatformTenantsResult,
} from './platform-tenant-directory-hooks';
export {
  assertPlatformAdministrationInvitationsEnabled,
  resolvePlatformAdministrationInvitationPolicy,
  type PlatformAdministrationInvitationDelivery,
  type PlatformAdministrationInvitationPolicy,
  type PlatformAdministrationInvitationPolicyStatus,
  type UsePlatformAdministrationOptions,
  type UsePlatformAdministrationResult,
} from './platform-administration-state';

/**
 * Protected administration-organization state composed from independently
 * fenced config, member, and invitation slices.
 */
export function usePlatformAdministration(
  options: UsePlatformAdministrationOptions = {},
): UsePlatformAdministrationResult {
  const client = useClientMaybe() as InternalClient | null;
  const authClient = client?.auth ?? null;
  const auth = useAuth();
  const publicConfig = useAuthConfig();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const isAvailable = auth.activeTenant?.kind === 'administration';
  const enabled = options.enabled !== false && Boolean(
    authClient
      && auth.isAuthenticated
      && isAvailable
      && authorizationBoundary.ready,
  );
  const boundaryKey = tenantAdministrationBoundaryKey(
    auth.user?.userId,
    auth.activeTenant?.tenantId,
    enabled,
    authorizationBoundary.key,
  );
  const fenceRef = React.useRef<TenantAdministrationBoundaryFence | null>(null);
  if (!fenceRef.current) fenceRef.current = new TenantAdministrationBoundaryFence();
  const scope: PlatformAdministrationSliceScope = {
    enabled,
    boundaryRevision: fenceRef.current.update(boundaryKey),
    fence: fenceRef.current,
    platform: authClient?.platformAdmin,
  };

  const config = usePlatformAdministrationConfigSlice(scope);
  const invitationPolicy = React.useMemo(
    () => resolvePlatformAdministrationInvitationPolicy(
      publicConfig.status,
      publicConfig.config,
      publicConfig.error,
    ),
    [publicConfig.config, publicConfig.error, publicConfig.status],
  );
  const members = usePlatformAdministrationMemberSlice(
    scope,
    config.config,
    config.hasCurrentConfig,
    config.isLoading,
    options,
  );
  const invitations = usePlatformAdministrationInvitationSlice(
    scope,
    config.config,
    config.hasCurrentConfig,
    config.isLoading,
    invitationPolicy,
    publicConfig.reload,
    options,
  );

  const reload = React.useCallback(() => {
    config.reload();
    members.reload();
    invitations.reload();
  }, [config.reload, invitations.reload, members.reload]);

  return {
    isAvailable,
    config: config.config,
    members: members.members,
    memberPage: members.page,
    invitations: invitations.invitations,
    invitationPage: invitations.page,
    isLoadingConfig: config.isLoading,
    configError: config.error,
    reloadConfig: config.reload,
    isLoadingMembers: members.isLoading,
    isMutatingMembers: members.isMutating,
    membersError: members.error,
    reloadMembers: members.reload,
    invitationPolicyStatus: invitationPolicy.status,
    invitationsEnabled: invitationPolicy.enabled,
    invitationDelivery: invitationPolicy.delivery,
    invitationConfigError: invitationPolicy.error,
    isLoadingInvitations: invitations.isLoading,
    isMutatingInvitations: invitations.isMutating,
    invitationsError: invitations.error,
    reloadInvitations: invitations.reload,
    isLoading: config.isLoading || members.isLoading || invitations.isLoading,
    isLoadingMoreMembers: members.isLoadingMore,
    isLoadingMoreInvitations: invitations.isLoadingMore,
    isMutating: members.isMutating || invitations.isMutating,
    error: config.error ?? members.error ?? invitationPolicy.error ?? invitations.error,
    reload,
    loadMoreMembers: members.loadMore,
    loadMoreInvitations: invitations.loadMore,
    addMember: members.add,
    updateMember: members.update,
    removeMember: members.remove,
    transferOwnership: members.transferOwnership,
    issueInvitation: invitations.issue,
    revokeInvitation: invitations.revoke,
  };
}
