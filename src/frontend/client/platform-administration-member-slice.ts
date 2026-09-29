'use client';

import * as React from 'react';
import { AuthClientError } from './auth-errors';
import type {
  AuthPlatformAddMemberParams,
  AuthPlatformAdministrationConfig,
  AuthPlatformUpdateMemberInput,
} from './auth-platform-administration-types';
import type {
  AuthTenantMember,
  AuthTenantMemberMutationResult,
  AuthTenantMemberPage,
  AuthTenantOwnershipTransferResult,
} from './auth-types';
import type { UsePlatformAdministrationOptions } from './platform-administration-state';
import {
  boundedPlatformPageLimit,
  isCurrentPlatformRequest,
  mergePlatformPageBy,
  platformAdministrationErrorMessage,
  platformAdministrationPermissionDenied,
  platformAdministrationUnavailable,
  stalePlatformAdministrationOperation,
  stalePlatformAdministrationTarget,
  type PlatformAdministrationSliceScope,
} from './platform-administration-slice-utils';

export interface PlatformAdministrationMemberSlice {
  members: AuthTenantMember[];
  page: AuthTenantMemberPage['page'] | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  isMutating: boolean;
  error: string | null;
  reload(): void;
  loadMore(): Promise<void>;
  add(params: AuthPlatformAddMemberParams): Promise<AuthTenantMemberMutationResult>;
  update(
    membershipId: string,
    params: AuthPlatformUpdateMemberInput,
  ): Promise<AuthTenantMemberMutationResult>;
  remove(membershipId: string): Promise<AuthTenantMemberMutationResult>;
  transferOwnership(membershipId: string): Promise<AuthTenantOwnershipTransferResult>;
}

/** Owns member reads, paging, writes, and member-only retry state. */
export function usePlatformAdministrationMemberSlice(
  scope: PlatformAdministrationSliceScope,
  config: AuthPlatformAdministrationConfig | null,
  hasCurrentConfig: boolean,
  configLoading: boolean,
  options: UsePlatformAdministrationOptions,
): PlatformAdministrationMemberSlice {
  const [members, setMembers] = React.useState<AuthTenantMember[]>([]);
  const [page, setPage] = React.useState<AuthTenantMemberPage['page'] | null>(null);
  const [loadedKey, setLoadedKey] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [mutating, setMutating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadRevision, setReloadRevision] = React.useState(0);
  const requestGeneration = React.useRef(0);
  const activeMutations = React.useRef(0);
  const authorityRef = React.useRef({
    enabled: false,
    platform: scope.platform,
    config: null as AuthPlatformAdministrationConfig | null,
  });
  const key = scope.enabled && hasCurrentConfig && config?.capabilities.canReadMembers
    ? JSON.stringify([
        scope.boundaryRevision,
        options.memberLimit ?? null,
        options.memberSearch ?? null,
        options.memberStatus ?? null,
        reloadRevision,
      ])
    : null;

  React.useEffect(() => {
    activeMutations.current = 0;
    setMutating(false);
  }, [scope.boundaryRevision]);

  React.useEffect(() => {
    const generation = ++requestGeneration.current;
    setLoadedKey(key);
    setMembers([]);
    setPage(null);
    setLoadingMore(false);
    setError(null);
    if (!key || !scope.platform) {
      setLoading(false);
      return;
    }

    setLoading(true);
    void scope.platform.listMembers({
      limit: boundedPlatformPageLimit(options.memberLimit),
      search: options.memberSearch,
      status: options.memberStatus,
    }).then((result) => {
      if (!isCurrentPlatformRequest(scope, requestGeneration, generation)) return;
      setMembers(result.members);
      setPage(result.page);
    }).catch((cause) => {
      if (isCurrentPlatformRequest(scope, requestGeneration, generation)) {
        setError(memberError(cause));
      }
    }).finally(() => {
      if (isCurrentPlatformRequest(scope, requestGeneration, generation)) setLoading(false);
    });
  }, [
    key,
    options.memberLimit,
    options.memberSearch,
    options.memberStatus,
    scope.boundaryRevision,
    scope.fence,
    scope.platform,
  ]);

  const reload = React.useCallback(() => {
    if (scope.fence.isCurrent(scope.boundaryRevision)) {
      setReloadRevision((value) => value + 1);
    }
  }, [scope.boundaryRevision, scope.fence]);

  const mutate = React.useCallback(async <T,>(
    operation: () => Promise<T>,
    ownsScopeReplacement: (result: T) => boolean = () => false,
  ): Promise<T> => {
    if (!scope.fence.isCurrent(scope.boundaryRevision)) {
      throw stalePlatformAdministrationOperation();
    }
    activeMutations.current += 1;
    setMutating(true);
    setError(null);
    try {
      const result = await operation();
      const current = scope.fence.isCurrent(scope.boundaryRevision);
      if (!current && !ownsScopeReplacement(result)) {
        throw stalePlatformAdministrationOperation();
      }
      if (current) reload();
      return result;
    } catch (cause) {
      if (!scope.fence.isCurrent(scope.boundaryRevision)) {
        throw stalePlatformAdministrationOperation();
      }
      setError(memberError(cause));
      if (cause instanceof AuthClientError
        && cause.code === 'TENANT_ROLE_REVISION_CONFLICT') reload();
      throw cause;
    } finally {
      if (scope.fence.isCurrent(scope.boundaryRevision)) {
        activeMutations.current = Math.max(0, activeMutations.current - 1);
        if (activeMutations.current === 0) setMutating(false);
      }
    }
  }, [reload, scope.boundaryRevision, scope.fence]);

  const hasCurrentData = Boolean(key) && loadedKey === key;
  const visibleMembers = hasCurrentData ? members : [];
  const visiblePage = hasCurrentData ? page : null;
  authorityRef.current = {
    enabled: scope.enabled,
    platform: scope.platform,
    config: hasCurrentConfig ? config : null,
  };

  return {
    members: visibleMembers,
    page: visiblePage,
    isLoading: configLoading || Boolean(key && (!hasCurrentData || loading)),
    isLoadingMore: hasCurrentData && loadingMore,
    isMutating: hasCurrentConfig && mutating,
    error: hasCurrentData ? error : null,
    reload,
    loadMore: React.useCallback(async () => {
      if (!scope.platform || !visiblePage?.nextCursor || loadingMore
        || !hasCurrentData || !scope.fence.isCurrent(scope.boundaryRevision)) return;
      const generation = requestGeneration.current;
      setLoadingMore(true);
      setError(null);
      try {
        const result = await scope.platform.listMembers({
          limit: boundedPlatformPageLimit(options.memberLimit),
          search: options.memberSearch,
          status: options.memberStatus,
          cursor: visiblePage.nextCursor,
        });
        if (!isCurrentPlatformRequest(scope, requestGeneration, generation)) return;
        setMembers((current) => mergePlatformPageBy(
          current,
          result.members,
          'membershipId',
        ));
        setPage(result.page);
      } catch (cause) {
        if (isCurrentPlatformRequest(scope, requestGeneration, generation)) {
          setError(memberError(cause));
        }
      } finally {
        if (isCurrentPlatformRequest(scope, requestGeneration, generation)) {
          setLoadingMore(false);
        }
      }
    }, [
      hasCurrentData,
      loadingMore,
      options.memberLimit,
      options.memberSearch,
      options.memberStatus,
      scope.boundaryRevision,
      scope.fence,
      scope.platform,
      visiblePage?.nextCursor,
    ]),
    add: React.useCallback((params) => {
      const { enabled, platform, config: currentConfig } = authorityRef.current;
      if (!enabled || !platform || !currentConfig) {
        return Promise.reject(platformAdministrationUnavailable());
      }
      if (!currentConfig.capabilities.canManageMembers) {
        return Promise.reject(platformAdministrationPermissionDenied());
      }
      return mutate(() => platform.addMember(params), actorInvalidated);
    }, [mutate]),
    update: React.useCallback((membershipId, params) => {
      const { enabled, platform, config: currentConfig } = authorityRef.current;
      if (!enabled || !platform || !currentConfig) {
        return Promise.reject(platformAdministrationUnavailable());
      }
      if (!currentConfig.capabilities.canManageMembers) {
        return Promise.reject(platformAdministrationPermissionDenied());
      }
      if (params.roles === undefined) {
        return mutate(
          () => platform.updateMember(membershipId, params),
          actorInvalidated,
        );
      }
      if (!hasCurrentData) return Promise.reject(stalePlatformAdministrationTarget());
      const target = visibleMembers.find((member) => member.membershipId === membershipId);
      if (!target) return Promise.reject(stalePlatformAdministrationTarget());
      return mutate(() => platform.updateMember(membershipId, {
        ...params,
        expectedRoleRevision: target.roleRevision,
      }), actorInvalidated);
    }, [hasCurrentData, mutate, visibleMembers]),
    remove: React.useCallback((membershipId) => {
      const { enabled, platform, config: currentConfig } = authorityRef.current;
      if (!enabled || !platform || !currentConfig) {
        return Promise.reject(platformAdministrationUnavailable());
      }
      if (!currentConfig.capabilities.canManageMembers) {
        return Promise.reject(platformAdministrationPermissionDenied());
      }
      return mutate(() => platform.removeMember(membershipId), actorInvalidated);
    }, [mutate]),
    transferOwnership: React.useCallback((membershipId) => {
      const { enabled, platform, config: currentConfig } = authorityRef.current;
      if (!enabled || !platform || !currentConfig) {
        return Promise.reject(platformAdministrationUnavailable());
      }
      if (!currentConfig.capabilities.canTransferOwnership) {
        return Promise.reject(platformAdministrationPermissionDenied());
      }
      return mutate(
        () => platform.transferOwnership(membershipId),
        actorInvalidated,
      );
    }, [mutate]),
  };
}

function memberError(cause: unknown): string {
  return platformAdministrationErrorMessage(
    'platformAdministrationMembers',
    cause,
    true,
  );
}

function actorInvalidated(value: { actorSessionInvalidated: boolean }): boolean {
  return value.actorSessionInvalidated;
}
