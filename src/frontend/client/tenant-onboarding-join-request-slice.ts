'use client';

import * as React from 'react';
import type {
  AuthTenantAdministrationConfig,
  AuthTenantDenyJoinRequestParams,
  AuthTenantJoinRequest,
  AuthTenantJoinRequestPage,
  AuthTenantJoinRequestStatus,
  AuthTenantReviewJoinRequestParams,
} from './auth-types';
import type { InternalClient } from './sdk';
import type { TenantAdministrationBoundaryFence } from './tenant-administration-boundary';
import {
  assertTenantOnboardingMutationAllowed,
  canLoadTenantOnboardingFeature,
  isCurrentTenantOnboardingRequest,
  projectTenantOnboardingSliceSettlement,
  settleTenantOnboardingFailure,
  staleTenantOnboardingOperation,
  type TenantOnboardingConfigProjection,
  type TenantOnboardingSliceProjection,
} from './tenant-onboarding-slice-core';

type AuthSdk = NonNullable<InternalClient['auth']>;
type TenantKind = 'administration' | 'organization' | null;

export interface TenantOnboardingJoinRequestSliceOptions {
  authClient: AuthSdk | null;
  boundaryFence: TenantAdministrationBoundaryFence;
  boundaryRevision: number;
  scopeEnabled: boolean;
  featureEnabled: boolean | null;
  tenantKind: TenantKind;
  administrationConfig: AuthTenantAdministrationConfig | null;
  administrationConfigProjection: TenantOnboardingConfigProjection;
  limit?: number;
  status?: AuthTenantJoinRequestStatus;
}

export interface TenantOnboardingJoinRequestSlice {
  requests: AuthTenantJoinRequest[];
  page: AuthTenantJoinRequestPage['page'] | null;
  projection: TenantOnboardingSliceProjection;
  reload(): void;
  loadMore(): Promise<void>;
  approve(
    joinRequestId: string,
    params: AuthTenantReviewJoinRequestParams,
  ): Promise<AuthTenantJoinRequest>;
  deny(
    joinRequestId: string,
    params: AuthTenantDenyJoinRequestParams,
  ): Promise<AuthTenantJoinRequest>;
}

/** Owns join-request reads, pagination, review mutations, and settlement generation. */
export function useTenantOnboardingJoinRequestSlice({
  authClient,
  boundaryFence,
  boundaryRevision,
  scopeEnabled,
  featureEnabled,
  tenantKind,
  administrationConfig,
  administrationConfigProjection,
  limit,
  status,
}: TenantOnboardingJoinRequestSliceOptions): TenantOnboardingJoinRequestSlice {
  const [requests, setRequests] = React.useState<AuthTenantJoinRequest[]>([]);
  const [page, setPage] = React.useState<AuthTenantJoinRequestPage['page'] | null>(null);
  const [loadedBoundaryRevision, setLoadedBoundaryRevision] = React.useState(-1);
  const [isLoading, setLoading] = React.useState(false);
  const [isLoadingMore, setLoadingMore] = React.useState(false);
  const [isMutating, setMutating] = React.useState(false);
  const [isPermissionDenied, setPermissionDenied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [revision, setRevision] = React.useState(0);
  const generationRef = React.useRef(0);
  const activeMutationCount = React.useRef(0);
  const authClientRef = React.useRef(authClient);
  const policyRef = React.useRef(featureEnabled);
  const tenantKindRef = React.useRef(tenantKind);
  const authorityRef = React.useRef<JoinRequestAuthority>({
    config: null,
    projection: emptyConfigProjection(),
  });
  authClientRef.current = authClient;
  policyRef.current = featureEnabled;
  tenantKindRef.current = tenantKind;

  React.useEffect(() => {
    activeMutationCount.current = 0;
    setMutating(false);
  }, [boundaryRevision]);

  React.useEffect(() => {
    const generation = ++generationRef.current;
    const requestBoundary = boundaryRevision;
    setRequests([]);
    setPage(null);
    setLoadingMore(false);
    setPermissionDenied(false);
    setError(null);

    if (!canLoadTenantOnboardingFeature(
      scopeEnabled,
      featureEnabled,
      authClient !== null,
      administrationConfig !== null,
    )) {
      setLoadedBoundaryRevision(requestBoundary);
      setLoading(false);
      return;
    }
    if (!authClient || !administrationConfig) return;

    setLoadedBoundaryRevision(-1);
    setLoading(true);
    if (tenantKind === 'administration') {
      setLoadedBoundaryRevision(requestBoundary);
      setLoading(false);
      return;
    }
    if (!administrationConfig.capabilities.canReviewJoinRequests) {
      setPermissionDenied(true);
      setLoadedBoundaryRevision(requestBoundary);
      setLoading(false);
      return;
    }
    void authClient.listTenantJoinRequests({ limit, status }).then((result) => {
      if (!isCurrentTenantOnboardingRequest(
        boundaryFence,
        requestBoundary,
        generationRef,
        generation,
      )) return;
      setRequests(result.requests);
      setPage(result.page);
    }).catch((cause) => {
      if (!isCurrentTenantOnboardingRequest(
        boundaryFence,
        requestBoundary,
        generationRef,
        generation,
      )) return;
      settleTenantOnboardingFailure(
        cause,
        'tenantJoinRequests',
        setPermissionDenied,
        setError,
      );
    }).finally(() => {
      if (!isCurrentTenantOnboardingRequest(
        boundaryFence,
        requestBoundary,
        generationRef,
        generation,
      )) return;
      setLoadedBoundaryRevision(requestBoundary);
      setLoading(false);
    });
  }, [
    authClient,
    administrationConfig,
    boundaryFence,
    boundaryRevision,
    featureEnabled,
    limit,
    revision,
    scopeEnabled,
    status,
    tenantKind,
  ]);

  const projection = projectTenantOnboardingSliceSettlement(
    scopeEnabled && administrationConfig !== null,
    featureEnabled,
    boundaryRevision,
    loadedBoundaryRevision,
    { isLoading, isLoadingMore, isMutating, isPermissionDenied, error },
  );
  authorityRef.current = {
    config: administrationConfig,
    projection: administrationConfigProjection,
  };

  const reload = React.useCallback(() => {
    if (boundaryFence.isCurrent(boundaryRevision)) {
      setRevision((value) => value + 1);
    }
  }, [boundaryFence, boundaryRevision]);

  const loadMore = React.useCallback(async () => {
    if (!boundaryFence.isCurrent(boundaryRevision)
      || !authClient
      || authClientRef.current !== authClient
      || policyRef.current !== true
      || tenantKindRef.current === 'administration'
      || !authorityRef.current.projection.isCurrent
      || authorityRef.current.projection.isLoading
      || authorityRef.current.projection.isPermissionDenied
      || authorityRef.current.projection.error !== null
      || !authorityRef.current.config?.capabilities.canReviewJoinRequests
      || !page?.nextCursor
      || isLoadingMore) return;
    const requestBoundary = boundaryRevision;
    const generation = generationRef.current;
    setLoadingMore(true);
    setPermissionDenied(false);
    setError(null);
    try {
      const result = await authClient.listTenantJoinRequests({
        limit,
        status,
        cursor: page.nextCursor,
      });
      if (!isCurrentTenantOnboardingRequest(
        boundaryFence,
        requestBoundary,
        generationRef,
        generation,
      )) return;
      setRequests((current) => mergeJoinRequests(current, result.requests));
      setPage(result.page);
    } catch (cause) {
      if (!isCurrentTenantOnboardingRequest(
        boundaryFence,
        requestBoundary,
        generationRef,
        generation,
      )) return;
      settleTenantOnboardingFailure(
        cause,
        'tenantJoinRequests',
        setPermissionDenied,
        setError,
      );
    } finally {
      if (isCurrentTenantOnboardingRequest(
        boundaryFence,
        requestBoundary,
        generationRef,
        generation,
      )) setLoadingMore(false);
    }
  }, [
    authClient,
    boundaryFence,
    boundaryRevision,
    isLoadingMore,
    limit,
    page?.nextCursor,
    status,
  ]);

  const mutate = React.useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    const operationBoundary = boundaryRevision;
    const operationAuthClient = authClientRef.current;
    if (!operationAuthClient || !boundaryFence.isCurrent(operationBoundary)) {
      throw staleTenantOnboardingOperation();
    }
    activeMutationCount.current += 1;
    setMutating(true);
    setPermissionDenied(false);
    setError(null);
    try {
      const result = await operation();
      if (authClientRef.current !== operationAuthClient
        || !boundaryFence.isCurrent(operationBoundary)
        || policyRef.current !== true
        || tenantKindRef.current === 'administration') {
        throw staleTenantOnboardingOperation();
      }
      setRevision((value) => value + 1);
      return result;
    } catch (cause) {
      if (authClientRef.current !== operationAuthClient
        || !boundaryFence.isCurrent(operationBoundary)
        || policyRef.current !== true
        || tenantKindRef.current === 'administration') {
        throw staleTenantOnboardingOperation();
      }
      settleTenantOnboardingFailure(
        cause,
        'tenantJoinRequests',
        setPermissionDenied,
        setError,
      );
      throw cause;
    } finally {
      if (boundaryFence.isCurrent(operationBoundary)) {
        activeMutationCount.current = Math.max(0, activeMutationCount.current - 1);
        if (activeMutationCount.current === 0) setMutating(false);
      }
    }
  }, [boundaryFence, boundaryRevision]);

  const approve = React.useCallback(async (
    joinRequestId: string,
    params: AuthTenantReviewJoinRequestParams,
  ) => {
    const current = authorityRef.current;
    const guard = {
      authClient,
      callbackCurrent: authClientRef.current === authClient
        && boundaryFence.isCurrent(boundaryRevision),
      scopeEnabled,
      feature: 'joinRequests' as const,
      featureEnabled: policyRef.current,
      tenantKindAllowed: tenantKindRef.current !== 'administration',
      administrationConfig: current.config,
      administrationConfigProjection: current.projection,
    };
    assertTenantOnboardingMutationAllowed(guard);
    return (await mutate(() => guard.authClient.approveTenantJoinRequest(
      joinRequestId,
      params,
    ))).request;
  }, [authClient, boundaryFence, boundaryRevision, mutate, scopeEnabled]);

  const deny = React.useCallback(async (
    joinRequestId: string,
    params: AuthTenantDenyJoinRequestParams,
  ) => {
    const current = authorityRef.current;
    const guard = {
      authClient,
      callbackCurrent: authClientRef.current === authClient
        && boundaryFence.isCurrent(boundaryRevision),
      scopeEnabled,
      feature: 'joinRequests' as const,
      featureEnabled: policyRef.current,
      tenantKindAllowed: tenantKindRef.current !== 'administration',
      administrationConfig: current.config,
      administrationConfigProjection: current.projection,
    };
    assertTenantOnboardingMutationAllowed(guard);
    return (await mutate(() => guard.authClient.denyTenantJoinRequest(
      joinRequestId,
      params,
    ))).request;
  }, [authClient, boundaryFence, boundaryRevision, mutate, scopeEnabled]);

  return {
    requests: projection.isCurrent ? requests : [],
    page: projection.isCurrent ? page : null,
    projection,
    reload,
    loadMore,
    approve,
    deny,
  };
}

interface JoinRequestAuthority {
  config: AuthTenantAdministrationConfig | null;
  projection: TenantOnboardingConfigProjection;
}

function emptyConfigProjection(): TenantOnboardingConfigProjection {
  return {
    isCurrent: false,
    isLoading: false,
    isPermissionDenied: false,
    error: null,
  };
}

function mergeJoinRequests(
  current: AuthTenantJoinRequest[],
  incoming: AuthTenantJoinRequest[],
): AuthTenantJoinRequest[] {
  const merged = new Map(current.map((item) => [item.joinRequestId, item]));
  for (const item of incoming) merged.set(item.joinRequestId, item);
  return [...merged.values()];
}
