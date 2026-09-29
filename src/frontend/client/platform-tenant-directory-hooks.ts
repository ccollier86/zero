'use client';

import * as React from 'react';
import { reportAuthClientActionFailure } from './auth-action-observability';
import { AuthClientError } from './auth-errors';
import type {
  AuthPlatformAdministrationConfig,
  AuthPlatformMutableTenantStatus,
  AuthPlatformTenant,
  AuthPlatformTenantCreateParams,
  AuthPlatformTenantCreateResult,
  AuthPlatformTenantListParams,
  AuthPlatformTenantPage,
  AuthPlatformTenantUpdateResult,
} from './auth-platform-administration-types';
import type {
  AuthTenantMember,
  AuthTenantMemberListParams,
  AuthTenantMemberPage,
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

export interface UsePlatformTenantsOptions
  extends Omit<AuthPlatformTenantListParams, 'cursor'> {
  enabled?: boolean;
  selectedTenantId?: string | null;
  memberLimit?: number;
  memberSearch?: string;
  memberStatus?: AuthTenantMemberListParams['status'];
}

export interface UsePlatformTenantsResult {
  isAvailable: boolean;
  config: AuthPlatformAdministrationConfig | null;
  tenants: AuthPlatformTenant[];
  page: AuthPlatformTenantPage['page'] | null;
  selectedTenant: AuthPlatformTenant | null;
  selectedTenantMembers: AuthTenantMember[];
  selectedTenantMemberPage: AuthTenantMemberPage['page'] | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  isLoadingMembers: boolean;
  isLoadingMoreMembers: boolean;
  isMutating: boolean;
  error: string | null;
  reload(): void;
  loadMore(): Promise<void>;
  loadMoreMembers(): Promise<void>;
  createTenant(params: AuthPlatformTenantCreateParams): Promise<AuthPlatformTenantCreateResult>;
  setTenantStatus(
    tenant: AuthPlatformTenant,
    status: AuthPlatformMutableTenantStatus,
  ): Promise<AuthPlatformTenantUpdateResult>;
}

/** Customer-organization directory and read-only member drill-in. */
export function usePlatformTenants(
  options: UsePlatformTenantsOptions = {},
): UsePlatformTenantsResult {
  const client = useClientMaybe() as InternalClient | null;
  const authClient = client?.auth ?? null;
  const auth = useAuth();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const stable = isTenantAdministrationScopeStable(auth.sessionTransition);
  const isAvailable = auth.activeTenant?.kind === 'administration';
  const enabled = options.enabled !== false && Boolean(
    authClient && auth.isAuthenticated && isAvailable && stable,
  );
  const key = tenantAdministrationBoundaryKey(
    auth.user?.userId,
    auth.activeTenant?.tenantId,
    enabled,
    authorizationBoundary.key,
  );
  const fenceRef = React.useRef<TenantAdministrationBoundaryFence | null>(null);
  if (!fenceRef.current) fenceRef.current = new TenantAdministrationBoundaryFence();
  const fence = fenceRef.current;
  const boundaryRevision = fence.update(key);
  const [config, setConfig] = React.useState<AuthPlatformAdministrationConfig | null>(null);
  const [tenants, setTenants] = React.useState<AuthPlatformTenant[]>([]);
  const [page, setPage] = React.useState<AuthPlatformTenantPage['page'] | null>(null);
  const [members, setMembers] = React.useState<AuthTenantMember[]>([]);
  const [memberPage, setMemberPage] = React.useState<AuthTenantMemberPage['page'] | null>(null);
  const [loadedBoundary, setLoadedBoundary] = React.useState(-1);
  const [loadedMemberKey, setLoadedMemberKey] = React.useState<string | null>(null);
  const [isLoading, setLoading] = React.useState(enabled);
  const [isLoadingMore, setLoadingMore] = React.useState(false);
  const [isLoadingMembers, setLoadingMembers] = React.useState(false);
  const [isLoadingMoreMembers, setLoadingMoreMembers] = React.useState(false);
  const [isMutating, setMutating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadRevision, setReloadRevision] = React.useState(0);
  const queryRevision = React.useRef(0);
  const memberQueryRevision = React.useRef(0);
  const activeMutationCount = React.useRef(0);
  const platform = authClient?.platformAdmin;

  React.useEffect(() => {
    activeMutationCount.current = 0;
    setMutating(false);
  }, [boundaryRevision]);

  React.useEffect(() => {
    const requestRevision = ++queryRevision.current;
    const requestBoundary = boundaryRevision;
    setLoadedBoundary(requestBoundary);
    setConfig(null);
    setTenants([]);
    setPage(null);
    setLoadingMore(false);
    if (!enabled || !platform) {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    void platform.getConfig().then(async (nextConfig) => {
      if (!fence.isCurrent(requestBoundary)
        || requestRevision !== queryRevision.current) return;
      setConfig(nextConfig);
      if (!nextConfig.capabilities.canReadTenants) return null;
      return platform.listTenants({
        limit: boundedLimit(options.limit),
        search: options.search,
        status: options.status,
      });
    }).then((result) => {
      if (!fence.isCurrent(requestBoundary)
        || requestRevision !== queryRevision.current || !result) return;
      setTenants(result.tenants);
      setPage(result.page);
    }).catch((cause) => {
      if (fence.isCurrent(requestBoundary)
        && requestRevision === queryRevision.current) setError(errorMessage(cause));
    }).finally(() => {
      if (fence.isCurrent(requestBoundary)
        && requestRevision === queryRevision.current) setLoading(false);
    });
  }, [
    boundaryRevision, enabled, fence, options.limit, options.search,
    options.status, platform, reloadRevision,
  ]);

  const currentMemberKey = enabled && options.selectedTenantId
    ? JSON.stringify([
        boundaryRevision, options.selectedTenantId, options.memberLimit ?? null,
        options.memberSearch ?? null, options.memberStatus ?? null, reloadRevision,
      ])
    : null;

  React.useEffect(() => {
    const requestRevision = ++memberQueryRevision.current;
    const requestBoundary = boundaryRevision;
    setLoadedMemberKey(currentMemberKey);
    setMembers([]);
    setMemberPage(null);
    setLoadingMoreMembers(false);
    if (!currentMemberKey || !platform || !options.selectedTenantId
      || config?.capabilities.canReadTenantMembers !== true) {
      setLoadingMembers(false);
      return;
    }
    setLoadingMembers(true);
    setError(null);
    void platform.listTenantMembers(options.selectedTenantId, {
      limit: boundedLimit(options.memberLimit),
      search: options.memberSearch,
      status: options.memberStatus,
    }).then((result) => {
      if (!fence.isCurrent(requestBoundary)
        || requestRevision !== memberQueryRevision.current) return;
      setMembers(result.members);
      setMemberPage(result.page);
    }).catch((cause) => {
      if (fence.isCurrent(requestBoundary)
        && requestRevision === memberQueryRevision.current) setError(errorMessage(cause));
    }).finally(() => {
      if (fence.isCurrent(requestBoundary)
        && requestRevision === memberQueryRevision.current) setLoadingMembers(false);
    });
  }, [
    boundaryRevision, config?.capabilities.canReadTenantMembers, currentMemberKey,
    fence, options.memberLimit, options.memberSearch, options.memberStatus,
    options.selectedTenantId, platform,
  ]);

  const reload = React.useCallback(() => {
    if (fence.isCurrent(boundaryRevision)) setReloadRevision((value) => value + 1);
  }, [boundaryRevision, fence]);

  const mutate = React.useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    const requestBoundary = boundaryRevision;
    if (!fence.isCurrent(requestBoundary)) throw stalePlatformOperation();
    activeMutationCount.current += 1;
    setMutating(true);
    setError(null);
    try {
      const result = await operation();
      if (!fence.isCurrent(requestBoundary)) throw stalePlatformOperation();
      reload();
      return result;
    } catch (cause) {
      if (!fence.isCurrent(requestBoundary)) throw stalePlatformOperation();
      setError(errorMessage(cause));
      if (cause instanceof AuthClientError
        && cause.code === 'TENANT_AUTHORIZATION_GENERATION_CONFLICT') reload();
      throw cause;
    } finally {
      if (fence.isCurrent(requestBoundary)) {
        activeMutationCount.current = Math.max(0, activeMutationCount.current - 1);
        if (activeMutationCount.current === 0) setMutating(false);
      }
    }
  }, [boundaryRevision, fence, reload]);

  const hasCurrentData = enabled && loadedBoundary === boundaryRevision;
  const hasCurrentMembers = hasCurrentData && currentMemberKey !== null
    && loadedMemberKey === currentMemberKey;
  const selectedTenant = hasCurrentData
    ? tenants.find((tenant) => tenant.tenantId === options.selectedTenantId) ?? null
    : null;

  return {
    isAvailable,
    config: hasCurrentData ? config : null,
    tenants: hasCurrentData ? tenants : [],
    page: hasCurrentData ? page : null,
    selectedTenant,
    selectedTenantMembers: hasCurrentMembers ? members : [],
    selectedTenantMemberPage: hasCurrentMembers ? memberPage : null,
    isLoading: enabled && (!hasCurrentData || isLoading),
    isLoadingMore: hasCurrentData && isLoadingMore,
    isLoadingMembers: Boolean(currentMemberKey) && (!hasCurrentMembers || isLoadingMembers),
    isLoadingMoreMembers: hasCurrentMembers && isLoadingMoreMembers,
    isMutating: hasCurrentData && isMutating,
    error: hasCurrentData ? error : null,
    reload,
    loadMore: React.useCallback(async () => {
      if (!platform || !page?.nextCursor || isLoadingMore || !hasCurrentData
        || !fence.isCurrent(boundaryRevision)) return;
      const requestBoundary = boundaryRevision;
      const requestRevision = queryRevision.current;
      setLoadingMore(true);
      setError(null);
      try {
        const result = await platform.listTenants({
          limit: boundedLimit(options.limit), search: options.search,
          status: options.status, cursor: page.nextCursor,
        });
        if (!fence.isCurrent(requestBoundary)
          || requestRevision !== queryRevision.current) return;
        setTenants((current) => mergeBy(current, result.tenants, 'tenantId'));
        setPage(result.page);
      } catch (cause) {
        if (fence.isCurrent(requestBoundary)
          && requestRevision === queryRevision.current) setError(errorMessage(cause));
      } finally {
        if (fence.isCurrent(requestBoundary)
          && requestRevision === queryRevision.current) setLoadingMore(false);
      }
    }, [
      boundaryRevision, fence, hasCurrentData, isLoadingMore, options.limit,
      options.search, options.status, page?.nextCursor, platform,
    ]),
    loadMoreMembers: React.useCallback(async () => {
      if (!platform || !options.selectedTenantId || !memberPage?.nextCursor
        || isLoadingMoreMembers || !hasCurrentMembers
        || !fence.isCurrent(boundaryRevision)) return;
      const requestBoundary = boundaryRevision;
      const requestRevision = memberQueryRevision.current;
      setLoadingMoreMembers(true);
      setError(null);
      try {
        const result = await platform.listTenantMembers(options.selectedTenantId, {
          limit: boundedLimit(options.memberLimit), search: options.memberSearch,
          status: options.memberStatus, cursor: memberPage.nextCursor,
        });
        if (!fence.isCurrent(requestBoundary)
          || requestRevision !== memberQueryRevision.current) return;
        setMembers((current) => mergeBy(current, result.members, 'membershipId'));
        setMemberPage(result.page);
      } catch (cause) {
        if (fence.isCurrent(requestBoundary)
          && requestRevision === memberQueryRevision.current) setError(errorMessage(cause));
      } finally {
        if (fence.isCurrent(requestBoundary)
          && requestRevision === memberQueryRevision.current) setLoadingMoreMembers(false);
      }
    }, [
      boundaryRevision, fence, hasCurrentMembers, isLoadingMoreMembers,
      memberPage?.nextCursor, options.memberLimit, options.memberSearch,
      options.memberStatus, options.selectedTenantId, platform,
    ]),
    createTenant: React.useCallback((params) => {
      if (!platform) return Promise.reject(platformUnavailable());
      return mutate(() => platform.createTenant(params));
    }, [mutate, platform]),
    setTenantStatus: React.useCallback((tenant, status) => {
      if (!platform) return Promise.reject(platformUnavailable());
      return mutate(() => platform.updateTenant(tenant.tenantId, {
        status,
        expectedAuthorizationGeneration: tenant.authorizationGeneration,
      }));
    }, [mutate, platform]),
  };
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
  reportAuthClientActionFailure('platformTenantDirectory', cause);
  return cause instanceof Error ? cause.message : 'Platform administration request failed';
}

function platformUnavailable(): Error {
  return new Error('Platform administration requires an active administration scope');
}

function stalePlatformOperation(): Error {
  return new Error('The administration scope changed before this request completed');
}
