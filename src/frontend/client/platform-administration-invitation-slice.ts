'use client';

import * as React from 'react';
import type {
  AuthPlatformAdministrationConfig,
  AuthPlatformIssueInvitationParams,
} from './auth-platform-administration-types';
import type {
  AuthTenantInvitation,
  AuthTenantInvitationPage,
  AuthTenantIssueInvitationResult,
} from './auth-types';
import {
  assertPlatformAdministrationInvitationsEnabled,
  type PlatformAdministrationInvitationPolicy,
  type UsePlatformAdministrationOptions,
} from './platform-administration-state';
import {
  boundedPlatformPageLimit,
  isCurrentPlatformRequest,
  mergePlatformPageBy,
  platformAdministrationErrorMessage,
  platformAdministrationPermissionDenied,
  platformAdministrationUnavailable,
  stalePlatformAdministrationOperation,
  type PlatformAdministrationSliceScope,
} from './platform-administration-slice-utils';

export interface PlatformAdministrationInvitationSlice {
  invitations: AuthTenantInvitation[];
  page: AuthTenantInvitationPage['page'] | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  isMutating: boolean;
  error: string | null;
  reload(): void;
  loadMore(): Promise<void>;
  issue(params: AuthPlatformIssueInvitationParams): Promise<AuthTenantIssueInvitationResult>;
  revoke(invitationId: string): Promise<AuthTenantInvitation>;
}

/** Owns invitation reads, writes, paging, public-policy gating, and retries. */
export function usePlatformAdministrationInvitationSlice(
  scope: PlatformAdministrationSliceScope,
  config: AuthPlatformAdministrationConfig | null,
  hasCurrentConfig: boolean,
  configLoading: boolean,
  policy: PlatformAdministrationInvitationPolicy,
  reloadPublicConfig: () => Promise<void>,
  options: UsePlatformAdministrationOptions,
): PlatformAdministrationInvitationSlice {
  const [invitations, setInvitations] = React.useState<AuthTenantInvitation[]>([]);
  const [page, setPage] = React.useState<AuthTenantInvitationPage['page'] | null>(null);
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
    policy,
  });
  const key = scope.enabled
    && hasCurrentConfig
    && config?.capabilities.canReadInvitations
    && policy.enabled === true
    ? JSON.stringify([
        scope.boundaryRevision,
        options.invitationLimit ?? null,
        options.invitationStatus ?? null,
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
    setInvitations([]);
    setPage(null);
    setLoadingMore(false);
    setError(null);
    if (!key || !scope.platform) {
      setLoading(false);
      return;
    }

    setLoading(true);
    void scope.platform.listInvitations({
      limit: boundedPlatformPageLimit(options.invitationLimit),
      status: options.invitationStatus,
    }).then((result) => {
      if (!isCurrentPlatformRequest(scope, requestGeneration, generation)) return;
      setInvitations(result.invitations);
      setPage(result.page);
    }).catch((cause) => {
      if (isCurrentPlatformRequest(scope, requestGeneration, generation)) {
        setError(invitationError(cause));
      }
    }).finally(() => {
      if (isCurrentPlatformRequest(scope, requestGeneration, generation)) setLoading(false);
    });
  }, [
    key,
    options.invitationLimit,
    options.invitationStatus,
    scope.boundaryRevision,
    scope.fence,
    scope.platform,
  ]);

  const reload = React.useCallback(() => {
    if (!scope.fence.isCurrent(scope.boundaryRevision)) return;
    setReloadRevision((value) => value + 1);
    if (policy.status === 'error') void reloadPublicConfig();
  }, [
    policy.status,
    reloadPublicConfig,
    scope.boundaryRevision,
    scope.fence,
  ]);

  const mutate = React.useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    assertPlatformAdministrationInvitationsEnabled(authorityRef.current.policy);
    if (!scope.fence.isCurrent(scope.boundaryRevision)) {
      throw stalePlatformAdministrationOperation();
    }
    activeMutations.current += 1;
    setMutating(true);
    setError(null);
    try {
      const result = await operation();
      if (!scope.fence.isCurrent(scope.boundaryRevision)) {
        throw stalePlatformAdministrationOperation();
      }
      reload();
      return result;
    } catch (cause) {
      if (!scope.fence.isCurrent(scope.boundaryRevision)) {
        throw stalePlatformAdministrationOperation();
      }
      setError(invitationError(cause));
      throw cause;
    } finally {
      if (scope.fence.isCurrent(scope.boundaryRevision)) {
        activeMutations.current = Math.max(0, activeMutations.current - 1);
        if (activeMutations.current === 0) setMutating(false);
      }
    }
  }, [reload, scope.boundaryRevision, scope.fence]);

  const hasCurrentData = Boolean(key) && loadedKey === key;
  const visiblePage = hasCurrentData ? page : null;
  authorityRef.current = {
    enabled: scope.enabled,
    platform: scope.platform,
    config: hasCurrentConfig ? config : null,
    policy,
  };

  return {
    invitations: hasCurrentData ? invitations : [],
    page: visiblePage,
    isLoading: scope.enabled && (
      configLoading
      || policy.status === 'unresolved'
      || Boolean(key && (!hasCurrentData || loading))
    ),
    isLoadingMore: hasCurrentData && loadingMore,
    isMutating: hasCurrentConfig && mutating,
    error: hasCurrentData ? error : null,
    reload,
    loadMore: React.useCallback(async () => {
      if (!scope.platform || policy.enabled !== true || !visiblePage?.nextCursor
        || loadingMore || !hasCurrentData
        || !scope.fence.isCurrent(scope.boundaryRevision)) return;
      const generation = requestGeneration.current;
      setLoadingMore(true);
      setError(null);
      try {
        const result = await scope.platform.listInvitations({
          limit: boundedPlatformPageLimit(options.invitationLimit),
          status: options.invitationStatus,
          cursor: visiblePage.nextCursor,
        });
        if (!isCurrentPlatformRequest(scope, requestGeneration, generation)) return;
        setInvitations((current) => mergePlatformPageBy(
          current,
          result.invitations,
          'invitationId',
        ));
        setPage(result.page);
      } catch (cause) {
        if (isCurrentPlatformRequest(scope, requestGeneration, generation)) {
          setError(invitationError(cause));
        }
      } finally {
        if (isCurrentPlatformRequest(scope, requestGeneration, generation)) {
          setLoadingMore(false);
        }
      }
    }, [
      hasCurrentData,
      loadingMore,
      options.invitationLimit,
      options.invitationStatus,
      policy.enabled,
      scope.boundaryRevision,
      scope.fence,
      scope.platform,
      visiblePage?.nextCursor,
    ]),
    issue: React.useCallback((params) => {
      const current = authorityRef.current;
      if (!current.enabled || !current.platform || !current.config) {
        return Promise.reject(platformAdministrationUnavailable());
      }
      try {
        assertPlatformAdministrationInvitationsEnabled(current.policy);
      } catch (cause) {
        return Promise.reject(cause);
      }
      if (!current.config.capabilities.canManageInvitations) {
        return Promise.reject(platformAdministrationPermissionDenied());
      }
      return mutate(() => current.platform!.issueInvitation(params));
    }, [mutate]),
    revoke: React.useCallback(async (invitationId) => {
      const current = authorityRef.current;
      if (!current.enabled || !current.platform || !current.config) {
        throw platformAdministrationUnavailable();
      }
      assertPlatformAdministrationInvitationsEnabled(current.policy);
      if (!current.config.capabilities.canManageInvitations) {
        throw platformAdministrationPermissionDenied();
      }
      return (await mutate(
        () => current.platform!.revokeInvitation(invitationId),
      )).invitation;
    }, [mutate]),
  };
}

function invitationError(cause: unknown): string {
  return platformAdministrationErrorMessage(
    'platformAdministrationInvitations',
    cause,
    true,
  );
}
