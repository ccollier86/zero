'use client';

import * as React from 'react';
import type {
  AuthTenantAdministrationConfig,
  AuthTenantInvitation,
  AuthTenantInvitationPage,
  AuthTenantInvitationStatus,
  AuthTenantIssueInvitationParams,
  AuthTenantIssueInvitationResult,
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

export interface TenantOnboardingInvitationSliceOptions {
  authClient: AuthSdk | null;
  boundaryFence: TenantAdministrationBoundaryFence;
  boundaryRevision: number;
  scopeEnabled: boolean;
  featureEnabled: boolean | null;
  administrationConfig: AuthTenantAdministrationConfig | null;
  administrationConfigProjection: TenantOnboardingConfigProjection;
  limit?: number;
  status?: AuthTenantInvitationStatus;
}

export interface TenantOnboardingInvitationSlice {
  invitations: AuthTenantInvitation[];
  page: AuthTenantInvitationPage['page'] | null;
  projection: TenantOnboardingSliceProjection;
  reload(): void;
  loadMore(): Promise<void>;
  issue(params: AuthTenantIssueInvitationParams): Promise<AuthTenantIssueInvitationResult>;
  revoke(invitationId: string): Promise<AuthTenantInvitation>;
}

/** Owns invitation reads, pagination, mutations, and settlement generation. */
export function useTenantOnboardingInvitationSlice({
  authClient,
  boundaryFence,
  boundaryRevision,
  scopeEnabled,
  featureEnabled,
  administrationConfig,
  administrationConfigProjection,
  limit,
  status,
}: TenantOnboardingInvitationSliceOptions): TenantOnboardingInvitationSlice {
  const [invitations, setInvitations] = React.useState<AuthTenantInvitation[]>([]);
  const [page, setPage] = React.useState<AuthTenantInvitationPage['page'] | null>(null);
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
  const authorityRef = React.useRef<InvitationAuthority>({
    config: null,
    projection: emptyConfigProjection(),
  });
  authClientRef.current = authClient;
  policyRef.current = featureEnabled;

  React.useEffect(() => {
    activeMutationCount.current = 0;
    setMutating(false);
  }, [boundaryRevision]);

  React.useEffect(() => {
    const generation = ++generationRef.current;
    const requestBoundary = boundaryRevision;
    setInvitations([]);
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
    if (!administrationConfig.capabilities.canReadInvitations) {
      setPermissionDenied(true);
      setLoadedBoundaryRevision(requestBoundary);
      setLoading(false);
      return;
    }
    void authClient.listTenantInvitations({ limit, status }).then((result) => {
      if (!isCurrentTenantOnboardingRequest(
        boundaryFence,
        requestBoundary,
        generationRef,
        generation,
      )) return;
      setInvitations(result.invitations);
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
        'tenantInvitations',
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
      || !authorityRef.current.projection.isCurrent
      || authorityRef.current.projection.isLoading
      || authorityRef.current.projection.isPermissionDenied
      || authorityRef.current.projection.error !== null
      || !authorityRef.current.config?.capabilities.canReadInvitations
      || !page?.nextCursor
      || isLoadingMore) return;
    const requestBoundary = boundaryRevision;
    const generation = generationRef.current;
    setLoadingMore(true);
    setPermissionDenied(false);
    setError(null);
    try {
      const result = await authClient.listTenantInvitations({
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
      setInvitations((current) => mergeInvitations(current, result.invitations));
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
        'tenantInvitations',
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
        || policyRef.current !== true) throw staleTenantOnboardingOperation();
      setRevision((value) => value + 1);
      return result;
    } catch (cause) {
      if (authClientRef.current !== operationAuthClient
        || !boundaryFence.isCurrent(operationBoundary)
        || policyRef.current !== true) throw staleTenantOnboardingOperation();
      settleTenantOnboardingFailure(
        cause,
        'tenantInvitations',
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

  const issue = React.useCallback(async (params: AuthTenantIssueInvitationParams) => {
    const current = authorityRef.current;
    const guard = {
      authClient,
      callbackCurrent: authClientRef.current === authClient
        && boundaryFence.isCurrent(boundaryRevision),
      scopeEnabled,
      feature: 'invitations' as const,
      featureEnabled: policyRef.current,
      tenantKindAllowed: true,
      administrationConfig: current.config,
      administrationConfigProjection: current.projection,
    };
    assertTenantOnboardingMutationAllowed(guard);
    return mutate(() => guard.authClient.issueTenantInvitation(params));
  }, [authClient, boundaryFence, boundaryRevision, mutate, scopeEnabled]);

  const revoke = React.useCallback(async (invitationId: string) => {
    const current = authorityRef.current;
    const guard = {
      authClient,
      callbackCurrent: authClientRef.current === authClient
        && boundaryFence.isCurrent(boundaryRevision),
      scopeEnabled,
      feature: 'invitations' as const,
      featureEnabled: policyRef.current,
      tenantKindAllowed: true,
      administrationConfig: current.config,
      administrationConfigProjection: current.projection,
    };
    assertTenantOnboardingMutationAllowed(guard);
    return (await mutate(
      () => guard.authClient.revokeTenantInvitation(invitationId),
    )).invitation;
  }, [authClient, boundaryFence, boundaryRevision, mutate, scopeEnabled]);

  return {
    invitations: projection.isCurrent ? invitations : [],
    page: projection.isCurrent ? page : null,
    projection,
    reload,
    loadMore,
    issue,
    revoke,
  };
}

interface InvitationAuthority {
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

function mergeInvitations(
  current: AuthTenantInvitation[],
  incoming: AuthTenantInvitation[],
): AuthTenantInvitation[] {
  const merged = new Map(current.map((item) => [item.invitationId, item]));
  for (const item of incoming) merged.set(item.invitationId, item);
  return [...merged.values()];
}
