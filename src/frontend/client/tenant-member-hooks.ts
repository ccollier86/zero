'use client';

import * as React from 'react';
import { reportAuthClientActionFailure } from './auth-action-observability';
import { AuthClientError } from './auth-errors';
import type {
  AuthTenantAddMemberParams,
  AuthTenantAdministrationConfig,
  AuthTenantMember,
  AuthTenantMemberListParams,
  AuthTenantMemberPage,
  AuthTenantOwnershipTransferResult,
  AuthTenantUpdateMemberParams,
} from './auth-types';
import { useAuth } from './auth-hooks';
import { useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import { useClientMaybe } from './client-context';
import type { InternalClient } from './sdk';
import {
  isTenantAdministrationScopeStable,
  TenantAdministrationBoundaryFence,
  tenantAdministrationBoundaryKey,
} from './tenant-administration-boundary';

export interface UseTenantMembersOptions
  extends Omit<AuthTenantMemberListParams, 'cursor'> {
  enabled?: boolean;
}

export interface UseTenantMembersResult {
  config: AuthTenantAdministrationConfig | null;
  members: AuthTenantMember[];
  page: AuthTenantMemberPage['page'] | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  isMutating: boolean;
  error: string | null;
  reload(): void;
  loadMore(): Promise<void>;
  addMember(params: AuthTenantAddMemberParams): Promise<AuthTenantMember>;
  updateMember(
    membershipId: string,
    params: AuthTenantUpdateMemberParams,
  ): Promise<AuthTenantMember>;
  removeMember(membershipId: string): Promise<AuthTenantMember>;
  transferOwnership(membershipId: string): Promise<AuthTenantOwnershipTransferResult>;
}

/** Capability-aware active-tenant member state and mutations. */
export function useTenantMembers(
  options: UseTenantMembersOptions = {},
): UseTenantMembersResult {
  const client = useClientMaybe() as InternalClient | null;
  const authClient = client?.auth ?? null;
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const auth = useAuth();
  const scopeStable = isTenantAdministrationScopeStable(auth.sessionTransition);
  const enabled = options.enabled !== false && Boolean(
    authClient && auth.isAuthenticated && auth.activeTenant && scopeStable,
  );
  const boundaryKey = tenantAdministrationBoundaryKey(
    auth.user?.userId,
    auth.activeTenant?.tenantId,
    enabled,
    authorizationBoundary.key,
  );
  const boundaryFenceRef = React.useRef<TenantAdministrationBoundaryFence | null>(null);
  if (!boundaryFenceRef.current) {
    boundaryFenceRef.current = new TenantAdministrationBoundaryFence();
  }
  const boundaryFence = boundaryFenceRef.current;
  const boundaryRevision = boundaryFence.update(boundaryKey);
  const [config, setConfig] = React.useState<AuthTenantAdministrationConfig | null>(null);
  const [members, setMembers] = React.useState<AuthTenantMember[]>([]);
  const [page, setPage] = React.useState<AuthTenantMemberPage['page'] | null>(null);
  const [loadedBoundaryRevision, setLoadedBoundaryRevision] = React.useState(-1);
  const [isLoading, setLoading] = React.useState(enabled);
  const [isLoadingMore, setLoadingMore] = React.useState(false);
  const [isMutating, setMutating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [revision, setRevision] = React.useState(0);
  const queryRevision = React.useRef(0);
  const activeMutationCount = React.useRef(0);
  const search = options.search ?? '';
  const status = options.status;
  const limit = options.limit;

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
    setPage(null);
    setLoadingMore(false);
    if (!enabled || !authClient) {
      setConfig(null);
      setMembers([]);
      setPage(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    void authClient.getTenantAdministrationConfig().then(async (nextConfig) => {
      if (!boundaryFence.isCurrent(requestBoundary)
        || requestRevision !== queryRevision.current) return;
      setConfig(nextConfig);
      if (!nextConfig.capabilities.canReadMembers) {
        setMembers([]);
        setPage(null);
        return;
      }
      const result = await authClient.listTenantMembers({ limit, search, status });
      if (!boundaryFence.isCurrent(requestBoundary)
        || requestRevision !== queryRevision.current) return;
      setMembers(result.members);
      setPage(result.page);
    }).catch((cause) => {
      if (boundaryFence.isCurrent(requestBoundary)
        && requestRevision === queryRevision.current) setError(errorMessage(cause));
    }).finally(() => {
      if (boundaryFence.isCurrent(requestBoundary)
        && requestRevision === queryRevision.current) setLoading(false);
    });
  }, [
    authClient,
    boundaryFence,
    boundaryRevision,
    enabled,
    limit,
    revision,
    search,
    status,
  ]);

  const reload = React.useCallback(() => {
    if (boundaryFence.isCurrent(boundaryRevision)) {
      setRevision((value) => value + 1);
    }
  }, [boundaryFence, boundaryRevision]);

  const loadMore = React.useCallback(async () => {
    if (!boundaryFence.isCurrent(boundaryRevision)
      || !authClient || !page?.nextCursor || isLoadingMore
      || loadedBoundaryRevision !== boundaryRevision) return;
    const requestBoundary = boundaryRevision;
    const requestRevision = queryRevision.current;
    setLoadingMore(true);
    setError(null);
    try {
      const result = await authClient.listTenantMembers({
        limit,
        search,
        status,
        cursor: page.nextCursor,
      });
      if (!boundaryFence.isCurrent(requestBoundary)
        || requestRevision !== queryRevision.current) return;
      setMembers((current) => mergeMembers(current, result.members));
      setPage(result.page);
    } catch (cause) {
      if (boundaryFence.isCurrent(requestBoundary)
        && requestRevision === queryRevision.current) setError(errorMessage(cause));
    } finally {
      if (boundaryFence.isCurrent(requestBoundary)
        && requestRevision === queryRevision.current) setLoadingMore(false);
    }
  }, [
    authClient,
    boundaryFence,
    boundaryRevision,
    isLoadingMore,
    limit,
    loadedBoundaryRevision,
    page?.nextCursor,
    search,
    status,
  ]);

  const mutate = React.useCallback(async <T,>(
    operation: () => Promise<T>,
    allowsOwnedScopeReplacement: (result: T) => boolean = () => false,
  ): Promise<T> => {
    const operationBoundary = boundaryRevision;
    if (!boundaryFence.isCurrent(operationBoundary)) throw staleOperation();
    activeMutationCount.current += 1;
    setMutating(true);
    setError(null);
    try {
      const result = await operation();
      const scopeRemainsCurrent = boundaryFence.isCurrent(operationBoundary);
      if (!scopeRemainsCurrent && !allowsOwnedScopeReplacement(result)) {
        throw staleOperation();
      }
      if (scopeRemainsCurrent) reload();
      return result;
    } catch (cause) {
      if (!boundaryFence.isCurrent(operationBoundary)) throw staleOperation();
      setError(errorMessage(cause));
      if (cause instanceof AuthClientError
        && cause.code === 'TENANT_ROLE_REVISION_CONFLICT') reload();
      throw cause;
    } finally {
      if (boundaryFence.isCurrent(operationBoundary)) {
        activeMutationCount.current = Math.max(0, activeMutationCount.current - 1);
        if (activeMutationCount.current === 0) setMutating(false);
      }
    }
  }, [boundaryFence, boundaryRevision, reload]);

  const hasCurrentData = enabled && loadedBoundaryRevision === boundaryRevision;

  return {
    config: hasCurrentData ? config : null,
    members: hasCurrentData ? members : [],
    page: hasCurrentData ? page : null,
    isLoading: enabled && (!hasCurrentData || isLoading),
    isLoadingMore: hasCurrentData && isLoadingMore,
    isMutating: hasCurrentData && isMutating,
    error: hasCurrentData ? error : null,
    reload,
    loadMore,
    addMember: React.useCallback(async (params) => {
      if (!authClient) throw unavailable();
      return (await mutate(
        () => authClient.addTenantMember(params),
        (result) => result.actorSessionInvalidated,
      )).member;
    }, [authClient, mutate]),
    updateMember: React.useCallback(async (membershipId, params) => {
      if (!authClient) throw unavailable();
      if (params.roles === undefined) {
        return (await mutate(
          () => authClient.updateTenantMember(membershipId, params),
          (result) => result.actorSessionInvalidated,
        )).member;
      }
      if (!hasCurrentData) throw staleTarget();
      const target = members.find((member) => member.membershipId === membershipId);
      if (!target) throw staleTarget();
      return (await mutate(
        () => authClient.updateTenantMember(membershipId, {
          ...params,
          expectedRoleRevision: target.roleRevision,
        }),
        (result) => result.actorSessionInvalidated,
      )).member;
    }, [authClient, hasCurrentData, members, mutate]),
    removeMember: React.useCallback(async (membershipId) => {
      if (!authClient) throw unavailable();
      return (await mutate(
        () => authClient.removeTenantMember(membershipId),
        (result) => result.actorSessionInvalidated,
      )).member;
    }, [authClient, mutate]),
    transferOwnership: React.useCallback(async (membershipId) => {
      if (!authClient) throw unavailable();
      return mutate(
        () => authClient.transferTenantOwnership(membershipId),
        (result) => result.actorSessionInvalidated,
      );
    }, [authClient, mutate]),
  };
}

function mergeMembers(
  current: AuthTenantMember[],
  incoming: AuthTenantMember[],
): AuthTenantMember[] {
  const merged = new Map(current.map((member) => [member.membershipId, member]));
  for (const member of incoming) merged.set(member.membershipId, member);
  return [...merged.values()];
}

function errorMessage(cause: unknown): string {
  reportAuthClientActionFailure('tenantMembers', cause);
  return cause instanceof Error ? cause.message : 'Tenant request failed';
}

function unavailable(): Error {
  return new Error('Tenant administration requires an authenticated Zero client');
}

function staleTarget(): Error {
  return new Error('Reload tenant members before changing this member\'s roles');
}

function staleOperation(): Error {
  return new Error('The active tenant changed before this request completed');
}
