'use client';

import * as React from 'react';
import { AuthClientError } from './auth-errors';
import type {
  AuthTenantAddMemberParams,
  AuthTenantAdministrationConfig,
  AuthTenantMember,
  AuthTenantMemberListParams,
  AuthTenantMemberPage,
  AuthTenantOwnershipTransferResult,
  AuthTenantSummary,
  AuthTenantUpdateMemberParams,
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
  AuthSessionTransitionState,
} from './auth-types';
import { useAuth, useAuthConfig } from './auth-hooks';
import { useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import { useClientMaybe } from './client-context';
import type { InternalClient } from './sdk';

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
  const mutationRevision = React.useRef(0);
  const search = options.search ?? '';
  const status = options.status;
  const limit = options.limit;

  React.useEffect(() => {
    const requestRevision = ++queryRevision.current;
    const requestBoundary = boundaryRevision;
    setLoadedBoundaryRevision(requestBoundary);
    setConfig(null);
    setMembers([]);
    setPage(null);
    setLoadingMore(false);
    setMutating(false);
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
    const operationRevision = ++mutationRevision.current;
    setMutating(true);
    setError(null);
    try {
      const result = await operation();
      const scopeRemainsCurrent = boundaryFence.isCurrent(operationBoundary);
      if (!scopeRemainsCurrent && !allowsOwnedScopeReplacement(result)) {
        throw staleOperation();
      }
      if (scopeRemainsCurrent && operationRevision === mutationRevision.current) reload();
      return result;
    } catch (cause) {
      if (!boundaryFence.isCurrent(operationBoundary)) throw staleOperation();
      if (boundaryFence.isCurrent(operationBoundary)
        && operationRevision === mutationRevision.current) {
        setError(errorMessage(cause));
        if (cause instanceof AuthClientError
          && cause.code === 'TENANT_ROLE_REVISION_CONFLICT') reload();
      }
      throw cause;
    } finally {
      if (boundaryFence.isCurrent(operationBoundary)
        && operationRevision === mutationRevision.current) setMutating(false);
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

export interface UseTenantSwitcherResult {
  isAvailable: boolean;
  terminology: { singular: string; plural: string };
  tenants: AuthTenantSummary[];
  activeTenant: AuthTenantSummary | null;
  isLoading: boolean;
  isSwitching: boolean;
  error: string | null;
  reload(): void;
  switchTenant(tenantId: string): Promise<void>;
}

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
  const mutationRevision = React.useRef(0);

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
    setMutating(false);
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
        nextConfig.capabilities.canReviewJoinRequests
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
    const operationRevision = ++mutationRevision.current;
    setMutating(true);
    setError(null);
    try {
      const result = await operation();
      if (!boundaryFence.isCurrent(operationBoundary)) throw staleOperation();
      if (operationRevision === mutationRevision.current) reload();
      return result;
    } catch (cause) {
      if (!boundaryFence.isCurrent(operationBoundary)) throw staleOperation();
      if (boundaryFence.isCurrent(operationBoundary)
        && operationRevision === mutationRevision.current) setError(errorMessage(cause));
      throw cause;
    } finally {
      if (boundaryFence.isCurrent(operationBoundary)
        && operationRevision === mutationRevision.current) setMutating(false);
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

/** Refresh-proof-backed tenant choices for the packaged switcher. */
export function useTenantSwitcher(): UseTenantSwitcherResult {
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const auth = useAuth();
  const authConfig = useAuthConfig();
  const scopeStable = isTenantAdministrationScopeStable(auth.sessionTransition);
  const enabled = authConfig.config?.tenancy?.mode === 'multi'
    && auth.isAuthenticated
    && Boolean(auth.activeTenant)
    && scopeStable;
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
  const [tenants, setTenants] = React.useState<AuthTenantSummary[]>([]);
  const [loadedBoundaryRevision, setLoadedBoundaryRevision] = React.useState(-1);
  const [isLoading, setLoading] = React.useState(false);
  const [isSwitching, setSwitching] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [revision, setRevision] = React.useState(0);
  const queryRevision = React.useRef(0);
  const switchRevision = React.useRef(0);

  React.useEffect(() => {
    const requestRevision = ++queryRevision.current;
    const requestBoundary = boundaryRevision;
    setLoadedBoundaryRevision(requestBoundary);
    setTenants([]);
    setSwitching(false);
    if (!enabled) {
      setTenants([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    void auth.listTenants().then((result) => {
      if (boundaryFence.isCurrent(requestBoundary)
        && requestRevision === queryRevision.current) {
        setTenants(result?.tenants ?? []);
      }
    }).catch((cause) => {
      if (boundaryFence.isCurrent(requestBoundary)
        && requestRevision === queryRevision.current) setError(errorMessage(cause));
    }).finally(() => {
      if (boundaryFence.isCurrent(requestBoundary)
        && requestRevision === queryRevision.current) setLoading(false);
    });
  }, [
    auth.listTenants,
    boundaryFence,
    boundaryRevision,
    enabled,
    revision,
  ]);

  const hasCurrentData = enabled && loadedBoundaryRevision === boundaryRevision;

  return {
    isAvailable: authConfig.config?.tenancy?.mode === 'multi',
    terminology: authConfig.config?.tenancy?.terminology ?? {
      singular: 'organization',
      plural: 'organizations',
    },
    tenants: hasCurrentData ? tenants : [],
    activeTenant: enabled ? auth.activeTenant : null,
    isLoading: enabled && (!hasCurrentData || isLoading),
    isSwitching: hasCurrentData && isSwitching,
    error: hasCurrentData ? error : null,
    reload: React.useCallback(() => {
      if (boundaryFence.isCurrent(boundaryRevision)) {
        setRevision((value) => value + 1);
      }
    }, [boundaryFence, boundaryRevision]),
    switchTenant: React.useCallback(async (tenantId: string) => {
      if (!auth.activeTenant || tenantId === auth.activeTenant.tenantId) return;
      const operationBoundary = boundaryRevision;
      if (!boundaryFence.isCurrent(operationBoundary)) throw staleOperation();
      const operationRevision = ++switchRevision.current;
      setSwitching(true);
      setError(null);
      try {
        await auth.switchTenant(tenantId);
      } catch (cause) {
        if (boundaryFence.isCurrent(operationBoundary)
          && operationRevision === switchRevision.current) setError(errorMessage(cause));
        throw cause;
      } finally {
        if (boundaryFence.isCurrent(operationBoundary)
          && operationRevision === switchRevision.current) setSwitching(false);
      }
    }, [
      auth.activeTenant?.tenantId,
      auth.switchTenant,
      boundaryFence,
      boundaryRevision,
    ]),
  };
}

/** @internal Identity + tenant boundary used by tenant-scoped hook caches. */
export function tenantAdministrationBoundaryKey(
  userId: string | undefined,
  tenantId: string | undefined,
  enabled = true,
  authorizationScopeKey?: string,
): string | null {
  return enabled && userId && tenantId
    ? JSON.stringify([authorizationScopeKey ?? null, userId, tenantId])
    : null;
}

/** @internal Only committed/recoverable session scopes may back tenant UI. */
export function isTenantAdministrationScopeStable(
  transition: AuthSessionTransitionState,
): boolean {
  return transition.phase === 'idle' || transition.phase === 'recovery-required';
}

/** @internal Monotonic fence for suppressing async work from a prior boundary. */
export class TenantAdministrationBoundaryFence {
  private key: string | null | undefined;
  private revision = 0;

  update(key: string | null): number {
    if (key !== this.key) {
      this.key = key;
      this.revision += 1;
    }
    return this.revision;
  }

  isCurrent(revision: number): boolean {
    return revision === this.revision;
  }
}

function mergeMembers(
  current: AuthTenantMember[],
  incoming: AuthTenantMember[],
): AuthTenantMember[] {
  const merged = new Map(current.map((member) => [member.membershipId, member]));
  for (const member of incoming) merged.set(member.membershipId, member);
  return [...merged.values()];
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
