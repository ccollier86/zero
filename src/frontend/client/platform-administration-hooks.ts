'use client';

import * as React from 'react';
import { reportAuthClientActionFailure } from './auth-action-observability';
import { AuthClientError } from './auth-errors';
import type {
  AuthPlatformAddMemberParams,
  AuthPlatformAdministrationConfig,
  AuthPlatformIssueInvitationParams,
  AuthPlatformUpdateMemberInput,
} from './auth-platform-administration-types';
import type {
  AuthTenantInvitation,
  AuthTenantInvitationListParams,
  AuthTenantInvitationPage,
  AuthTenantIssueInvitationResult,
  AuthTenantMember,
  AuthTenantMemberListParams,
  AuthTenantMemberMutationResult,
  AuthTenantMemberPage,
  AuthTenantOwnershipTransferResult,
} from './auth-types';
import { useAuth } from './auth-hooks';
import { useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import { useClientMaybe } from './client-context';
import type { InternalClient } from './sdk';
import {
  isTenantAdministrationScopeStable,
  TenantAdministrationBoundaryFence,
  tenantAdministrationBoundaryKey,
} from './tenant-administration-hooks';

export {
  usePlatformTenants,
  type UsePlatformTenantsOptions,
  type UsePlatformTenantsResult,
} from './platform-tenant-directory-hooks';

export interface UsePlatformAdministrationOptions {
  enabled?: boolean;
  memberLimit?: number;
  memberSearch?: string;
  memberStatus?: AuthTenantMemberListParams['status'];
  invitationLimit?: number;
  invitationStatus?: AuthTenantInvitationListParams['status'];
}

export interface UsePlatformAdministrationResult {
  isAvailable: boolean;
  config: AuthPlatformAdministrationConfig | null;
  members: AuthTenantMember[];
  memberPage: AuthTenantMemberPage['page'] | null;
  invitations: AuthTenantInvitation[];
  invitationPage: AuthTenantInvitationPage['page'] | null;
  isLoading: boolean;
  isLoadingMoreMembers: boolean;
  isLoadingMoreInvitations: boolean;
  isMutating: boolean;
  error: string | null;
  reload(): void;
  loadMoreMembers(): Promise<void>;
  loadMoreInvitations(): Promise<void>;
  addMember(params: AuthPlatformAddMemberParams): Promise<AuthTenantMemberMutationResult>;
  updateMember(
    membershipId: string,
    params: AuthPlatformUpdateMemberInput,
  ): Promise<AuthTenantMemberMutationResult>;
  removeMember(membershipId: string): Promise<AuthTenantMemberMutationResult>;
  transferOwnership(membershipId: string): Promise<AuthTenantOwnershipTransferResult>;
  issueInvitation(
    params: AuthPlatformIssueInvitationParams,
  ): Promise<AuthTenantIssueInvitationResult>;
  revokeInvitation(invitationId: string): Promise<AuthTenantInvitation>;
}

/** Protected administration-organization membership and invitation state. */
export function usePlatformAdministration(
  options: UsePlatformAdministrationOptions = {},
): UsePlatformAdministrationResult {
  const client = useClientMaybe() as InternalClient | null;
  const authClient = client?.auth ?? null;
  const auth = useAuth();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const scopeStable = isTenantAdministrationScopeStable(auth.sessionTransition);
  const isAvailable = auth.activeTenant?.kind === 'administration';
  const enabled = options.enabled !== false && Boolean(
    authClient && auth.isAuthenticated && isAvailable && scopeStable,
  );
  const boundaryKey = tenantAdministrationBoundaryKey(
    auth.user?.userId,
    auth.activeTenant?.tenantId,
    enabled,
    authorizationBoundary.key,
  );
  const fenceRef = React.useRef<TenantAdministrationBoundaryFence | null>(null);
  if (!fenceRef.current) fenceRef.current = new TenantAdministrationBoundaryFence();
  const fence = fenceRef.current;
  const boundaryRevision = fence.update(boundaryKey);
  const [config, setConfig] = React.useState<AuthPlatformAdministrationConfig | null>(null);
  const [members, setMembers] = React.useState<AuthTenantMember[]>([]);
  const [memberPage, setMemberPage] = React.useState<AuthTenantMemberPage['page'] | null>(null);
  const [invitations, setInvitations] = React.useState<AuthTenantInvitation[]>([]);
  const [invitationPage, setInvitationPage] = React.useState<
    AuthTenantInvitationPage['page'] | null
  >(null);
  const [loadedBoundaryRevision, setLoadedBoundaryRevision] = React.useState(-1);
  const [isLoading, setLoading] = React.useState(enabled);
  const [isLoadingMoreMembers, setLoadingMoreMembers] = React.useState(false);
  const [isLoadingMoreInvitations, setLoadingMoreInvitations] = React.useState(false);
  const [isMutating, setMutating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadRevision, setReloadRevision] = React.useState(0);
  const queryRevision = React.useRef(0);
  const activeMutationCount = React.useRef(0);

  React.useEffect(() => {
    activeMutationCount.current = 0;
    setMutating(false);
  }, [boundaryRevision]);

  React.useEffect(() => {
    const requestRevision = ++queryRevision.current;
    const requestBoundary = boundaryRevision;
    setLoadedBoundaryRevision(requestBoundary);
    setConfig(null);
    setMembers([]);
    setMemberPage(null);
    setInvitations([]);
    setInvitationPage(null);
    setLoadingMoreMembers(false);
    setLoadingMoreInvitations(false);
    if (!enabled || !authClient) {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    void authClient.platformAdmin.getConfig().then(async (nextConfig) => {
      if (!fence.isCurrent(requestBoundary)
        || requestRevision !== queryRevision.current) return;
      setConfig(nextConfig);
      const [nextMembers, nextInvitations] = await Promise.all([
        nextConfig.capabilities.canReadMembers
          ? authClient.platformAdmin.listMembers({
              limit: boundedLimit(options.memberLimit),
              search: options.memberSearch,
              status: options.memberStatus,
            })
          : Promise.resolve(null),
        nextConfig.capabilities.canReadInvitations
          ? authClient.platformAdmin.listInvitations({
              limit: boundedLimit(options.invitationLimit),
              status: options.invitationStatus,
            })
          : Promise.resolve(null),
      ]);
      if (!fence.isCurrent(requestBoundary)
        || requestRevision !== queryRevision.current) return;
      setMembers(nextMembers?.members ?? []);
      setMemberPage(nextMembers?.page ?? null);
      setInvitations(nextInvitations?.invitations ?? []);
      setInvitationPage(nextInvitations?.page ?? null);
    }).catch((cause) => {
      if (fence.isCurrent(requestBoundary)
        && requestRevision === queryRevision.current) setError(errorMessage(cause));
    }).finally(() => {
      if (fence.isCurrent(requestBoundary)
        && requestRevision === queryRevision.current) setLoading(false);
    });
  }, [
    authClient, boundaryRevision, enabled, fence, options.invitationLimit,
    options.invitationStatus, options.memberLimit, options.memberSearch,
    options.memberStatus, reloadRevision,
  ]);

  const reload = React.useCallback(() => {
    if (fence.isCurrent(boundaryRevision)) setReloadRevision((value) => value + 1);
  }, [boundaryRevision, fence]);

  const mutate = React.useCallback(async <T,>(
    operation: () => Promise<T>,
    ownsScopeReplacement: (result: T) => boolean = () => false,
  ): Promise<T> => {
    const requestBoundary = boundaryRevision;
    if (!fence.isCurrent(requestBoundary)) throw stalePlatformOperation();
    activeMutationCount.current += 1;
    setMutating(true);
    setError(null);
    try {
      const result = await operation();
      const current = fence.isCurrent(requestBoundary);
      if (!current && !ownsScopeReplacement(result)) throw stalePlatformOperation();
      if (current) reload();
      return result;
    } catch (cause) {
      if (!fence.isCurrent(requestBoundary)) throw stalePlatformOperation();
      setError(errorMessage(cause));
      if (cause instanceof AuthClientError
        && cause.code === 'TENANT_ROLE_REVISION_CONFLICT') reload();
      throw cause;
    } finally {
      if (fence.isCurrent(requestBoundary)) {
        activeMutationCount.current = Math.max(0, activeMutationCount.current - 1);
        if (activeMutationCount.current === 0) setMutating(false);
      }
    }
  }, [boundaryRevision, fence, reload]);

  const hasCurrentData = enabled && loadedBoundaryRevision === boundaryRevision;
  const platform = authClient?.platformAdmin;

  return {
    isAvailable,
    config: hasCurrentData ? config : null,
    members: hasCurrentData ? members : [],
    memberPage: hasCurrentData ? memberPage : null,
    invitations: hasCurrentData ? invitations : [],
    invitationPage: hasCurrentData ? invitationPage : null,
    isLoading: enabled && (!hasCurrentData || isLoading),
    isLoadingMoreMembers: hasCurrentData && isLoadingMoreMembers,
    isLoadingMoreInvitations: hasCurrentData && isLoadingMoreInvitations,
    isMutating: hasCurrentData && isMutating,
    error: hasCurrentData ? error : null,
    reload,
    loadMoreMembers: React.useCallback(async () => {
      if (!platform || !memberPage?.nextCursor || isLoadingMoreMembers
        || !hasCurrentData || !fence.isCurrent(boundaryRevision)) return;
      const requestBoundary = boundaryRevision;
      const requestRevision = queryRevision.current;
      setLoadingMoreMembers(true);
      setError(null);
      try {
        const result = await platform.listMembers({
          limit: boundedLimit(options.memberLimit), search: options.memberSearch,
          status: options.memberStatus, cursor: memberPage.nextCursor,
        });
        if (!fence.isCurrent(requestBoundary)
          || requestRevision !== queryRevision.current) return;
        setMembers((current) => mergeBy(current, result.members, 'membershipId'));
        setMemberPage(result.page);
      } catch (cause) {
        if (fence.isCurrent(requestBoundary)
          && requestRevision === queryRevision.current) setError(errorMessage(cause));
      } finally {
        if (fence.isCurrent(requestBoundary)
          && requestRevision === queryRevision.current) setLoadingMoreMembers(false);
      }
    }, [
      boundaryRevision, fence, hasCurrentData, isLoadingMoreMembers,
      memberPage?.nextCursor, options.memberLimit, options.memberSearch,
      options.memberStatus, platform,
    ]),
    loadMoreInvitations: React.useCallback(async () => {
      if (!platform || !invitationPage?.nextCursor || isLoadingMoreInvitations
        || !hasCurrentData || !fence.isCurrent(boundaryRevision)) return;
      const requestBoundary = boundaryRevision;
      const requestRevision = queryRevision.current;
      setLoadingMoreInvitations(true);
      setError(null);
      try {
        const result = await platform.listInvitations({
          limit: boundedLimit(options.invitationLimit), status: options.invitationStatus,
          cursor: invitationPage.nextCursor,
        });
        if (!fence.isCurrent(requestBoundary)
          || requestRevision !== queryRevision.current) return;
        setInvitations((current) => mergeBy(current, result.invitations, 'invitationId'));
        setInvitationPage(result.page);
      } catch (cause) {
        if (fence.isCurrent(requestBoundary)
          && requestRevision === queryRevision.current) setError(errorMessage(cause));
      } finally {
        if (fence.isCurrent(requestBoundary)
          && requestRevision === queryRevision.current) setLoadingMoreInvitations(false);
      }
    }, [
      boundaryRevision, fence, hasCurrentData, invitationPage?.nextCursor,
      isLoadingMoreInvitations, options.invitationLimit, options.invitationStatus,
      platform,
    ]),
    addMember: React.useCallback((params) => {
      if (!platform) return Promise.reject(platformUnavailable());
      return mutate(() => platform.addMember(params), actorInvalidated);
    }, [mutate, platform]),
    updateMember: React.useCallback((membershipId, params) => {
      if (!platform) return Promise.reject(platformUnavailable());
      if (params.roles === undefined) {
        return mutate(() => platform.updateMember(membershipId, params), actorInvalidated);
      }
      if (!hasCurrentData) return Promise.reject(stalePlatformTarget());
      const target = members.find((member) => member.membershipId === membershipId);
      if (!target) return Promise.reject(stalePlatformTarget());
      return mutate(() => platform.updateMember(membershipId, {
        ...params,
        expectedRoleRevision: target.roleRevision,
      }), actorInvalidated);
    }, [hasCurrentData, members, mutate, platform]),
    removeMember: React.useCallback((membershipId) => {
      if (!platform) return Promise.reject(platformUnavailable());
      return mutate(() => platform.removeMember(membershipId), actorInvalidated);
    }, [mutate, platform]),
    transferOwnership: React.useCallback((membershipId) => {
      if (!platform) return Promise.reject(platformUnavailable());
      return mutate(() => platform.transferOwnership(membershipId), actorInvalidated);
    }, [mutate, platform]),
    issueInvitation: React.useCallback((params) => {
      if (!platform) return Promise.reject(platformUnavailable());
      return mutate(() => platform.issueInvitation(params));
    }, [mutate, platform]),
    revokeInvitation: React.useCallback(async (invitationId) => {
      if (!platform) throw platformUnavailable();
      return (await mutate(() => platform.revokeInvitation(invitationId))).invitation;
    }, [mutate, platform]),
  };
}

function actorInvalidated(value: { actorSessionInvalidated: boolean }): boolean {
  return value.actorSessionInvalidated;
}

function boundedLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(1, Math.trunc(value!)));
}

function mergeBy<T, K extends keyof T>(current: T[], incoming: T[], key: K): T[] {
  const values = new Map(current.map((entry) => [entry[key], entry]));
  for (const entry of incoming) values.set(entry[key], entry);
  return [...values.values()];
}

function errorMessage(cause: unknown): string {
  reportAuthClientActionFailure('platformAdministration', cause);
  return cause instanceof Error ? cause.message : 'Platform administration request failed';
}

function platformUnavailable(): Error {
  return new Error('Platform administration requires an active administration scope');
}

function stalePlatformTarget(): Error {
  return new Error('Reload administration members before changing this role set');
}

function stalePlatformOperation(): Error {
  return new Error('The administration scope changed before this request completed');
}
