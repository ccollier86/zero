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
  AuthPlatformTenantOwnershipTransferResult,
  AuthPlatformTenantPage,
  AuthPlatformTenantUpdateResult,
} from './auth-platform-administration-types';
import type {
  AuthTenantAddMemberParams,
  AuthTenantMember,
  AuthTenantMemberListParams,
  AuthTenantMemberPage,
  AuthTenantUpdateMemberParams,
} from './auth-types';
import { useAuth } from './auth-hooks';
import { useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import { useClientMaybe } from './client-context';
import {
  EMPTY_PLATFORM_TENANT_DIRECTORY_ERRORS,
  platformTenantDirectoryAggregateError,
  reducePlatformTenantDirectoryErrors,
} from './platform-tenant-directory-errors';
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
  /** Config and customer-workspace directory read failure. */
  directoryError: string | null;
  /** Selected customer-workspace member read failure. */
  selectedTenantMembersError: string | null;
  /** Most recent customer-workspace or member mutation failure. */
  mutationError: string | null;
  /** Compatibility aggregate; prefer the slice-specific errors above. */
  error: string | null;
  /** Reload both directory and selected-member read slices. */
  reload(): void;
  reloadDirectory(): void;
  reloadSelectedTenantMembers(): void;
  clearMutationError(): void;
  loadMore(): Promise<void>;
  loadMoreMembers(): Promise<void>;
  createTenant(params: AuthPlatformTenantCreateParams): Promise<AuthPlatformTenantCreateResult>;
  setTenantStatus(
    tenant: AuthPlatformTenant,
    status: AuthPlatformMutableTenantStatus,
  ): Promise<AuthPlatformTenantUpdateResult>;
  addTenantMember(
    tenantId: string,
    params: AuthTenantAddMemberParams,
  ): Promise<AuthTenantMember>;
  updateTenantMember(
    tenantId: string,
    membershipId: string,
    params: AuthTenantUpdateMemberParams,
  ): Promise<AuthTenantMember>;
  removeTenantMember(tenantId: string, membershipId: string): Promise<AuthTenantMember>;
  transferTenantOwnership(
    tenantId: string,
    membershipId: string,
  ): Promise<AuthPlatformTenantOwnershipTransferResult>;
}

/** Customer-organization directory and capability-fenced member control plane. */
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
  const [errors, dispatchError] = React.useReducer(
    reducePlatformTenantDirectoryErrors,
    EMPTY_PLATFORM_TENANT_DIRECTORY_ERRORS,
  );
  const [directoryReloadRevision, setDirectoryReloadRevision] = React.useState(0);
  const [memberReloadRevision, setMemberReloadRevision] = React.useState(0);
  const queryRevision = React.useRef(0);
  const memberQueryRevision = React.useRef(0);
  const directoryProjectionKeyRef = React.useRef<string | null>(null);
  const memberProjectionKeyRef = React.useRef<string | null>(null);
  const committedTenantOverlays = React.useRef(new Map<string, AuthPlatformTenant>());
  const activeMutationCount = React.useRef(0);
  const platform = authClient?.platformAdmin;
  const directoryProjectionKey = enabled
    ? platformTenantDirectoryProjectionKey(boundaryRevision, options)
    : null;

  React.useEffect(() => {
    committedTenantOverlays.current.clear();
    activeMutationCount.current = 0;
    setMutating(false);
    dispatchError({ type: 'clear-all' });
  }, [boundaryRevision]);

  React.useEffect(() => {
    const requestRevision = ++queryRevision.current;
    const requestBoundary = boundaryRevision;
    const preserveProjection = directoryProjectionKey !== null
      && directoryProjectionKeyRef.current === directoryProjectionKey;
    directoryProjectionKeyRef.current = directoryProjectionKey;
    setLoadedBoundary(requestBoundary);
    if (!preserveProjection) {
      setConfig(null);
      setTenants([]);
      setPage(null);
    }
    setLoadingMore(false);
    if (!enabled || !platform) {
      setLoading(false);
      dispatchError({ type: 'clear-directory' });
      return;
    }
    setLoading(!preserveProjection);
    dispatchError({ type: 'clear-directory' });
    void platform.getConfig().then(async (nextConfig) => {
      if (!fence.isCurrent(requestBoundary)
        || requestRevision !== queryRevision.current) return;
      setConfig(nextConfig);
      if (!nextConfig.capabilities.canReadTenants) {
        setTenants([]);
        setPage(null);
        return null;
      }
      return platform.listTenants({
        limit: boundedLimit(options.limit),
        search: options.search,
        status: options.status,
      });
    }).then((result) => {
      if (!fence.isCurrent(requestBoundary)
        || requestRevision !== queryRevision.current || !result) return;
      retireObservedTenantOverlays(committedTenantOverlays.current, result.tenants);
      setTenants(reconcilePlatformTenantProjection(
        result.tenants,
        committedTenantOverlays.current.values(),
        options,
      ));
      setPage(result.page);
    }).catch((cause) => {
      if (fence.isCurrent(requestBoundary)
        && requestRevision === queryRevision.current) {
        dispatchError({ type: 'fail-directory', error: errorMessage('directory', cause) });
      }
    }).finally(() => {
      if (fence.isCurrent(requestBoundary)
        && requestRevision === queryRevision.current) setLoading(false);
    });
  }, [
    boundaryRevision, directoryProjectionKey, enabled, fence, options.limit,
    options.search, options.status, platform, directoryReloadRevision,
  ]);

  const currentMemberKey = enabled && options.selectedTenantId
    ? platformTenantMemberProjectionKey(boundaryRevision, options)
    : null;

  React.useEffect(() => {
    const requestRevision = ++memberQueryRevision.current;
    const requestBoundary = boundaryRevision;
    const preserveProjection = currentMemberKey !== null
      && memberProjectionKeyRef.current === currentMemberKey;
    memberProjectionKeyRef.current = currentMemberKey;
    setLoadedMemberKey(currentMemberKey);
    if (!preserveProjection) {
      setMembers([]);
      setMemberPage(null);
    }
    setLoadingMoreMembers(false);
    dispatchError({ type: 'clear-selected-members' });
    if (!currentMemberKey || !platform || !options.selectedTenantId
      || config?.capabilities.canReadTenantMembers !== true) {
      if (config && !config.capabilities.canReadTenantMembers) {
        setMembers([]);
        setMemberPage(null);
      }
      setLoadingMembers(false);
      return;
    }
    setLoadingMembers(!preserveProjection);
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
        && requestRevision === memberQueryRevision.current) {
        dispatchError({
          type: 'fail-selected-members',
          error: errorMessage('selectedMembers', cause),
        });
      }
    }).finally(() => {
      if (fence.isCurrent(requestBoundary)
        && requestRevision === memberQueryRevision.current) setLoadingMembers(false);
    });
  }, [
    boundaryRevision, config?.capabilities.canReadTenantMembers, currentMemberKey,
    fence, options.memberLimit, options.memberSearch, options.memberStatus,
    options.selectedTenantId, platform, memberReloadRevision,
  ]);

  const reloadDirectory = React.useCallback(() => {
    if (fence.isCurrent(boundaryRevision)) {
      setDirectoryReloadRevision((value) => value + 1);
    }
  }, [boundaryRevision, fence]);

  const reloadSelectedTenantMembers = React.useCallback(() => {
    if (fence.isCurrent(boundaryRevision)) {
      setMemberReloadRevision((value) => value + 1);
    }
  }, [boundaryRevision, fence]);

  const reload = React.useCallback(() => {
    if (fence.isCurrent(boundaryRevision)) dispatchError({ type: 'clear-mutation' });
    reloadDirectory();
    reloadSelectedTenantMembers();
  }, [boundaryRevision, fence, reloadDirectory, reloadSelectedTenantMembers]);

  const clearMutationError = React.useCallback(() => {
    if (fence.isCurrent(boundaryRevision)) dispatchError({ type: 'clear-mutation' });
  }, [boundaryRevision, fence]);

  const reconcileCommittedTenant = React.useCallback((tenant: AuthPlatformTenant) => {
    committedTenantOverlays.current.set(tenant.tenantId, tenant);
    setTenants((current) => reconcilePlatformTenantProjection(
      current,
      committedTenantOverlays.current.values(),
      options,
    ));
  }, [options.search, options.status]);

  const mutate = React.useCallback(async <T,>(
    operation: () => Promise<T>,
    options: {
      reconcile?: (result: T) => void;
      refresh: 'directory' | 'directory-and-members';
    },
  ): Promise<T> => {
    const requestBoundary = boundaryRevision;
    if (!fence.isCurrent(requestBoundary)) throw stalePlatformOperation();
    activeMutationCount.current += 1;
    setMutating(true);
    dispatchError({ type: 'clear-mutation' });
    try {
      const result = await operation();
      if (!fence.isCurrent(requestBoundary)) throw stalePlatformOperation();
      options.reconcile?.(result);
      reloadDirectory();
      if (options.refresh === 'directory-and-members') reloadSelectedTenantMembers();
      return result;
    } catch (cause) {
      if (!fence.isCurrent(requestBoundary)) throw stalePlatformOperation();
      dispatchError({ type: 'fail-mutation', error: errorMessage('mutation', cause) });
      if (cause instanceof AuthClientError) {
        if (cause.code === 'TENANT_AUTHORIZATION_GENERATION_CONFLICT') reloadDirectory();
        if (cause.code === 'TENANT_ROLE_REVISION_CONFLICT') {
          reloadDirectory();
          reloadSelectedTenantMembers();
        }
      }
      throw cause;
    } finally {
      if (fence.isCurrent(requestBoundary)) {
        activeMutationCount.current = Math.max(0, activeMutationCount.current - 1);
        if (activeMutationCount.current === 0) setMutating(false);
      }
    }
  }, [boundaryRevision, fence, reloadDirectory, reloadSelectedTenantMembers]);

  const hasCurrentData = enabled && loadedBoundary === boundaryRevision;
  const hasCurrentMembers = hasCurrentData && currentMemberKey !== null
    && loadedMemberKey === currentMemberKey;
  const selectedTenant = hasCurrentData
    ? tenants.find((tenant) => tenant.tenantId === options.selectedTenantId) ?? null
    : null;
  const visibleErrors = {
    directoryError: hasCurrentData ? errors.directoryError : null,
    selectedTenantMembersError: hasCurrentMembers
      ? errors.selectedTenantMembersError
      : null,
    mutationError: hasCurrentData ? errors.mutationError : null,
  };

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
    ...visibleErrors,
    error: platformTenantDirectoryAggregateError(visibleErrors),
    reload,
    reloadDirectory,
    reloadSelectedTenantMembers,
    clearMutationError,
    loadMore: React.useCallback(async () => {
      if (!platform || !page?.nextCursor || isLoadingMore || !hasCurrentData
        || !fence.isCurrent(boundaryRevision)) return;
      const requestBoundary = boundaryRevision;
      const requestRevision = queryRevision.current;
      setLoadingMore(true);
      dispatchError({ type: 'clear-directory' });
      try {
        const result = await platform.listTenants({
          limit: boundedLimit(options.limit), search: options.search,
          status: options.status, cursor: page.nextCursor,
        });
        if (!fence.isCurrent(requestBoundary)
          || requestRevision !== queryRevision.current) return;
        retireObservedTenantOverlays(committedTenantOverlays.current, result.tenants);
        setTenants((current) => reconcilePlatformTenantProjection(
          mergeBy(current, result.tenants, 'tenantId'),
          committedTenantOverlays.current.values(),
          options,
        ));
        setPage(result.page);
      } catch (cause) {
        if (fence.isCurrent(requestBoundary)
          && requestRevision === queryRevision.current) {
          dispatchError({ type: 'fail-directory', error: errorMessage('directory', cause) });
        }
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
      dispatchError({ type: 'clear-selected-members' });
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
          && requestRevision === memberQueryRevision.current) {
          dispatchError({
            type: 'fail-selected-members',
            error: errorMessage('selectedMembers', cause),
          });
        }
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
      return mutate(
        () => platform.createTenant(params),
        {
          reconcile: (result) => reconcileCommittedTenant(result.tenant),
          refresh: 'directory',
        },
      );
    }, [mutate, platform, reconcileCommittedTenant]),
    setTenantStatus: React.useCallback((tenant, status) => {
      if (!platform) return Promise.reject(platformUnavailable());
      return mutate(
        () => platform.updateTenant(tenant.tenantId, {
          status,
          expectedAuthorizationGeneration: tenant.authorizationGeneration,
        }),
        {
          reconcile: (result) => reconcileCommittedTenant(result.tenant),
          refresh: 'directory',
        },
      );
    }, [mutate, platform, reconcileCommittedTenant]),
    addTenantMember: React.useCallback(async (tenantId, params) => {
      if (!platform) throw platformUnavailable();
      return (await mutate(
        () => platform.addTenantMember(tenantId, params),
        { refresh: 'directory-and-members' },
      )).member;
    }, [mutate, platform]),
    updateTenantMember: React.useCallback(async (tenantId, membershipId, params) => {
      if (!platform) throw platformUnavailable();
      if (params.roles === undefined) {
        return (await mutate(
          () => platform.updateTenantMember(tenantId, membershipId, params),
          { refresh: 'directory-and-members' },
        )).member;
      }
      if (!hasCurrentMembers || tenantId !== options.selectedTenantId) {
        throw staleTenantMemberTarget();
      }
      const target = members.find((member) => member.membershipId === membershipId);
      if (!target) throw staleTenantMemberTarget();
      return (await mutate(
        () => platform.updateTenantMember(tenantId, membershipId, {
          ...params,
          expectedRoleRevision: target.roleRevision,
        }),
        { refresh: 'directory-and-members' },
      )).member;
    }, [
      hasCurrentMembers, members, mutate, options.selectedTenantId, platform,
    ]),
    removeTenantMember: React.useCallback(async (tenantId, membershipId) => {
      if (!platform) throw platformUnavailable();
      return (await mutate(
        () => platform.removeTenantMember(tenantId, membershipId),
        { refresh: 'directory-and-members' },
      )).member;
    }, [mutate, platform]),
    transferTenantOwnership: React.useCallback((tenantId, membershipId) => {
      if (!platform) return Promise.reject(platformUnavailable());
      return mutate(
        () => platform.transferTenantOwnership(tenantId, membershipId),
        { refresh: 'directory-and-members' },
      );
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

function errorMessage(
  slice: 'directory' | 'selectedMembers' | 'mutation',
  cause: unknown,
): string {
  const action = slice === 'directory'
    ? 'platformTenantDirectory'
    : slice === 'selectedMembers'
      ? 'platformTenantMembers'
      : 'platformTenantMutation';
  reportAuthClientActionFailure(action, cause);
  return cause instanceof Error ? cause.message : 'Platform administration request failed';
}

function platformUnavailable(): Error {
  return new Error('Platform administration requires an active administration scope');
}

function stalePlatformOperation(): Error {
  return new Error('The administration scope changed before this request completed');
}

function staleTenantMemberTarget(): Error {
  return new Error('Reload customer organization members before changing this member\'s roles');
}

/** @internal Stable identity for a visible directory projection; refreshes do not change it. */
export function platformTenantDirectoryProjectionKey(
  boundaryRevision: number,
  options: Pick<UsePlatformTenantsOptions, 'limit' | 'search' | 'status'>,
): string {
  return JSON.stringify([
    boundaryRevision,
    options.limit ?? null,
    options.search ?? null,
    options.status ?? null,
  ]);
}

/** @internal Stable identity for the selected workspace's visible member projection. */
export function platformTenantMemberProjectionKey(
  boundaryRevision: number,
  options: Pick<
    UsePlatformTenantsOptions,
    'selectedTenantId' | 'memberLimit' | 'memberSearch' | 'memberStatus'
  >,
): string {
  return JSON.stringify([
    boundaryRevision,
    options.selectedTenantId ?? null,
    options.memberLimit ?? null,
    options.memberSearch ?? null,
    options.memberStatus ?? null,
  ]);
}

/**
 * Keep exact committed create/lifecycle receipts visible until the cursor page
 * which owns them is observed. Overlay IDs replace stale page rows and remain
 * subject to the active server-backed filters.
 */
export function reconcilePlatformTenantProjection(
  serverTenants: readonly AuthPlatformTenant[],
  overlays: Iterable<AuthPlatformTenant>,
  options: Pick<UsePlatformTenantsOptions, 'search' | 'status'>,
): AuthPlatformTenant[] {
  const overlayList = [...overlays];
  const overlayIds = new Set(overlayList.map((tenant) => tenant.tenantId));
  const values = serverTenants.filter((tenant) => !overlayIds.has(tenant.tenantId));
  for (const tenant of overlayList) {
    if (matchesPlatformTenantProjection(tenant, options)) values.push(tenant);
  }
  return values.sort((left, right) => (
    right.createdAt - left.createdAt || right.tenantId.localeCompare(left.tenantId)
  ));
}

function matchesPlatformTenantProjection(
  tenant: AuthPlatformTenant,
  options: Pick<UsePlatformTenantsOptions, 'search' | 'status'>,
): boolean {
  if (options.status && tenant.status !== options.status) return false;
  const search = options.search?.trim().toLocaleLowerCase();
  return !search
    || tenant.name.toLocaleLowerCase().includes(search)
    || tenant.slug.toLocaleLowerCase().includes(search);
}

function retireObservedTenantOverlays(
  overlays: Map<string, AuthPlatformTenant>,
  serverTenants: readonly AuthPlatformTenant[],
): void {
  for (const tenant of serverTenants) {
    const overlay = overlays.get(tenant.tenantId);
    if (overlay
      && tenant.authorizationGeneration >= overlay.authorizationGeneration
      && tenant.updatedAt >= overlay.updatedAt) overlays.delete(tenant.tenantId);
  }
}
