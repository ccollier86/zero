'use client';

import * as React from 'react';
import { reportAuthClientActionFailure } from './auth-action-observability';
import type {
  AuthTenantAdministrationConfig,
  AuthTenantInvitation,
  AuthTenantInvitationPage,
  AuthTenantInvitationStatus,
  AuthTenantIssueInvitationParams,
  AuthTenantIssueInvitationResult,
  AuthTenantJoinRequest,
  AuthTenantJoinRequestPage,
  AuthTenantJoinRequestStatus,
  AuthTenantDenyJoinRequestParams,
  AuthTenantReviewJoinRequestParams,
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

export interface UseTenantOnboardingAdministrationOptions {
  enabled?: boolean;
  limit?: number;
  invitationStatus?: AuthTenantInvitationStatus;
  joinRequestStatus?: AuthTenantJoinRequestStatus;
}

export interface UseTenantOnboardingAdministrationResult {
  config: AuthTenantAdministrationConfig | null;
  invitations: AuthTenantInvitation[];
  joinRequests: AuthTenantJoinRequest[];
  invitationPage: AuthTenantInvitationPage['page'] | null;
  joinRequestPage: AuthTenantJoinRequestPage['page'] | null;
  isLoading: boolean;
  isLoadingMoreInvitations: boolean;
  isLoadingMoreJoinRequests: boolean;
  isMutating: boolean;
  error: string | null;
  reload(): void;
  loadMoreInvitations(): Promise<void>;
  loadMoreJoinRequests(): Promise<void>;
  issueInvitation(
    params: AuthTenantIssueInvitationParams,
  ): Promise<AuthTenantIssueInvitationResult>;
  revokeInvitation(invitationId: string): Promise<AuthTenantInvitation>;
  approveJoinRequest(
    joinRequestId: string,
    params: AuthTenantReviewJoinRequestParams,
  ): Promise<AuthTenantJoinRequest>;
  denyJoinRequest(
    joinRequestId: string,
    params: AuthTenantDenyJoinRequestParams,
  ): Promise<AuthTenantJoinRequest>;
}

/** Invitation issuance and retained join-request review for the active tenant. */
export function useTenantOnboardingAdministration(
  options: UseTenantOnboardingAdministrationOptions = {},
): UseTenantOnboardingAdministrationResult {
  const client = useClientMaybe() as InternalClient | null;
  const authClient = client?.auth ?? null;
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const auth = useAuth();
  const activeTenantKind = auth.activeTenant?.kind ?? null;
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
  const [invitations, setInvitations] = React.useState<AuthTenantInvitation[]>([]);
  const [joinRequests, setJoinRequests] = React.useState<AuthTenantJoinRequest[]>([]);
  const [invitationPage, setInvitationPage] = React.useState<
    AuthTenantInvitationPage['page'] | null
  >(null);
  const [joinRequestPage, setJoinRequestPage] = React.useState<
    AuthTenantJoinRequestPage['page'] | null
  >(null);
  const [loadedBoundaryRevision, setLoadedBoundaryRevision] = React.useState(-1);
  const [isLoading, setLoading] = React.useState(enabled);
  const [isLoadingMoreInvitations, setLoadingMoreInvitations] = React.useState(false);
  const [isLoadingMoreJoinRequests, setLoadingMoreJoinRequests] = React.useState(false);
  const [isMutating, setMutating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [revision, setRevision] = React.useState(0);
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
    setInvitations([]);
    setJoinRequests([]);
    setInvitationPage(null);
    setJoinRequestPage(null);
    setLoadingMoreInvitations(false);
    setLoadingMoreJoinRequests(false);
    if (!enabled || !authClient) {
      setConfig(null);
      setInvitations([]);
      setJoinRequests([]);
      setInvitationPage(null);
      setJoinRequestPage(null);
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
      const [invitationPage, joinRequestPage] = await Promise.all([
        nextConfig.capabilities.canReadInvitations
          ? authClient.listTenantInvitations({
              limit: options.limit,
              status: options.invitationStatus,
            })
          : Promise.resolve(null),
        canLoadTenantJoinRequests(
          nextConfig.capabilities.canReviewJoinRequests,
          activeTenantKind,
        )
          ? authClient.listTenantJoinRequests({
              limit: options.limit,
              status: options.joinRequestStatus,
            })
          : Promise.resolve(null),
      ]);
      if (!boundaryFence.isCurrent(requestBoundary)
        || requestRevision !== queryRevision.current) return;
      setInvitations(invitationPage?.invitations ?? []);
      setJoinRequests(joinRequestPage?.requests ?? []);
      setInvitationPage(invitationPage?.page ?? null);
      setJoinRequestPage(joinRequestPage?.page ?? null);
    }).catch((cause) => {
      if (boundaryFence.isCurrent(requestBoundary)
        && requestRevision === queryRevision.current) setError(errorMessage(cause));
    }).finally(() => {
      if (boundaryFence.isCurrent(requestBoundary)
        && requestRevision === queryRevision.current) setLoading(false);
    });
  }, [
    authClient,
    activeTenantKind,
    boundaryFence,
    boundaryRevision,
    enabled,
    options.invitationStatus,
    options.joinRequestStatus,
    options.limit,
    revision,
  ]);

  const reload = React.useCallback(() => {
    if (boundaryFence.isCurrent(boundaryRevision)) {
      setRevision((value) => value + 1);
    }
  }, [boundaryFence, boundaryRevision]);

  const loadMoreInvitations = React.useCallback(async () => {
    if (!boundaryFence.isCurrent(boundaryRevision)
      || !authClient || !invitationPage?.nextCursor || isLoadingMoreInvitations
      || loadedBoundaryRevision !== boundaryRevision) return;
    const requestBoundary = boundaryRevision;
    const requestRevision = queryRevision.current;
    setLoadingMoreInvitations(true);
    setError(null);
    try {
      const result = await authClient.listTenantInvitations({
        limit: options.limit,
        status: options.invitationStatus,
        cursor: invitationPage.nextCursor,
      });
      if (!boundaryFence.isCurrent(requestBoundary)
        || requestRevision !== queryRevision.current) return;
      setInvitations((current) => mergeInvitations(current, result.invitations));
      setInvitationPage(result.page);
    } catch (cause) {
      if (boundaryFence.isCurrent(requestBoundary)
        && requestRevision === queryRevision.current) setError(errorMessage(cause));
    } finally {
      if (boundaryFence.isCurrent(requestBoundary)
        && requestRevision === queryRevision.current) setLoadingMoreInvitations(false);
    }
  }, [
    authClient,
    boundaryFence,
    boundaryRevision,
    invitationPage?.nextCursor,
    isLoadingMoreInvitations,
    loadedBoundaryRevision,
    options.invitationStatus,
    options.limit,
  ]);

  const loadMoreJoinRequests = React.useCallback(async () => {
    if (!boundaryFence.isCurrent(boundaryRevision)
      || !authClient || !joinRequestPage?.nextCursor || isLoadingMoreJoinRequests
      || loadedBoundaryRevision !== boundaryRevision) return;
    const requestBoundary = boundaryRevision;
    const requestRevision = queryRevision.current;
    setLoadingMoreJoinRequests(true);
    setError(null);
    try {
      const result = await authClient.listTenantJoinRequests({
        limit: options.limit,
        status: options.joinRequestStatus,
        cursor: joinRequestPage.nextCursor,
      });
      if (!boundaryFence.isCurrent(requestBoundary)
        || requestRevision !== queryRevision.current) return;
      setJoinRequests((current) => mergeJoinRequests(current, result.requests));
      setJoinRequestPage(result.page);
    } catch (cause) {
      if (boundaryFence.isCurrent(requestBoundary)
        && requestRevision === queryRevision.current) setError(errorMessage(cause));
    } finally {
      if (boundaryFence.isCurrent(requestBoundary)
        && requestRevision === queryRevision.current) setLoadingMoreJoinRequests(false);
    }
  }, [
    authClient,
    boundaryFence,
    boundaryRevision,
    isLoadingMoreJoinRequests,
    joinRequestPage?.nextCursor,
    loadedBoundaryRevision,
    options.joinRequestStatus,
    options.limit,
  ]);
  const mutate = React.useCallback(async <T,>(operation: () => Promise<T>) => {
    const operationBoundary = boundaryRevision;
    if (!boundaryFence.isCurrent(operationBoundary)) throw staleOperation();
    activeMutationCount.current += 1;
    setMutating(true);
    setError(null);
    try {
      const result = await operation();
      if (!boundaryFence.isCurrent(operationBoundary)) throw staleOperation();
      reload();
      return result;
    } catch (cause) {
      if (!boundaryFence.isCurrent(operationBoundary)) throw staleOperation();
      setError(errorMessage(cause));
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
    invitations: hasCurrentData ? invitations : [],
    joinRequests: hasCurrentData ? joinRequests : [],
    invitationPage: hasCurrentData ? invitationPage : null,
    joinRequestPage: hasCurrentData ? joinRequestPage : null,
    isLoading: enabled && (!hasCurrentData || isLoading),
    isLoadingMoreInvitations: hasCurrentData && isLoadingMoreInvitations,
    isLoadingMoreJoinRequests: hasCurrentData && isLoadingMoreJoinRequests,
    isMutating: hasCurrentData && isMutating,
    error: hasCurrentData ? error : null,
    reload,
    loadMoreInvitations,
    loadMoreJoinRequests,
    issueInvitation: React.useCallback(async (params) => {
      if (!authClient) throw unavailable();
      return mutate(() => authClient.issueTenantInvitation(params));
    }, [authClient, mutate]),
    revokeInvitation: React.useCallback(async (invitationId) => {
      if (!authClient) throw unavailable();
      return (await mutate(() => authClient.revokeTenantInvitation(invitationId))).invitation;
    }, [authClient, mutate]),
    approveJoinRequest: React.useCallback(async (joinRequestId, params) => {
      if (!authClient) throw unavailable();
      return (await mutate(() => authClient.approveTenantJoinRequest(
        joinRequestId,
        params,
      ))).request;
    }, [authClient, mutate]),
    denyJoinRequest: React.useCallback(async (joinRequestId, params) => {
      if (!authClient) throw unavailable();
      return (await mutate(() => authClient.denyTenantJoinRequest(
        joinRequestId,
        params,
      ))).request;
    }, [authClient, mutate]),
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

function mergeJoinRequests(
  current: AuthTenantJoinRequest[],
  incoming: AuthTenantJoinRequest[],
): AuthTenantJoinRequest[] {
  const merged = new Map(current.map((item) => [item.joinRequestId, item]));
  for (const item of incoming) merged.set(item.joinRequestId, item);
  return [...merged.values()];
}

function errorMessage(cause: unknown): string {
  reportAuthClientActionFailure('tenantOnboarding', cause);
  return cause instanceof Error ? cause.message : 'Tenant request failed';
}

function unavailable(): Error {
  return new Error('Tenant administration requires an authenticated Zero client');
}

function staleOperation(): Error {
  return new Error('The active tenant changed before this request completed');
}

/** Administration tenants never participate in customer join-request admission. */
export function canLoadTenantJoinRequests(
  canReviewJoinRequests: boolean,
  tenantKind: 'administration' | 'organization' | null,
): boolean {
  return canReviewJoinRequests && tenantKind !== 'administration';
}
