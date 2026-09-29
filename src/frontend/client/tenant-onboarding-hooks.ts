'use client';

import * as React from 'react';
import type {
  AuthTenantAdministrationConfig,
  AuthTenantDenyJoinRequestParams,
  AuthTenantInvitation,
  AuthTenantInvitationPage,
  AuthTenantInvitationStatus,
  AuthTenantIssueInvitationParams,
  AuthTenantIssueInvitationResult,
  AuthTenantJoinRequest,
  AuthTenantJoinRequestPage,
  AuthTenantJoinRequestStatus,
  AuthTenantReviewJoinRequestParams,
} from './auth-types';
import { useAuth, useAuthConfig, type AuthConfigStatus } from './auth-hooks';
import { useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import { useClientMaybe } from './client-context';
import type { InternalClient } from './sdk';
import {
  isTenantAdministrationScopeStable,
  TenantAdministrationBoundaryFence,
  tenantAdministrationBoundaryKey,
} from './tenant-administration-boundary';
import {
  projectTenantOnboardingAggregateError,
  resolveTenantOnboardingFeaturePolicy,
  retryTenantOnboardingSection,
} from './tenant-onboarding-slice-core';
import { useTenantOnboardingConfigSlice } from './tenant-onboarding-config-slice';
import { useTenantOnboardingInvitationSlice } from './tenant-onboarding-invitation-slice';
import { useTenantOnboardingJoinRequestSlice } from './tenant-onboarding-join-request-slice';

export {
  projectTenantOnboardingSliceSettlement,
  resolveTenantOnboardingFeaturePolicy,
  type TenantOnboardingSliceProjection,
  type TenantOnboardingSliceSettlement,
} from './tenant-onboarding-slice-core';

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
  /** Aggregate compatibility fields. Prefer the precise slice fields below. */
  isLoading: boolean;
  isLoadingMoreInvitations: boolean;
  isLoadingMoreJoinRequests: boolean;
  isMutating: boolean;
  error: string | null;
  /** Public onboarding policy remains unknown until `/auth/config` settles. */
  authConfigStatus: AuthConfigStatus;
  authConfigError: string | null;
  isLoadingConfig: boolean;
  isConfigPermissionDenied: boolean;
  configError: string | null;
  invitationsEnabled: boolean | null;
  joinRequestsEnabled: boolean | null;
  isLoadingInvitations: boolean;
  isLoadingJoinRequests: boolean;
  isMutatingInvitations: boolean;
  isMutatingJoinRequests: boolean;
  isInvitationsPermissionDenied: boolean;
  isJoinRequestsPermissionDenied: boolean;
  invitationsError: string | null;
  joinRequestsError: string | null;
  reload(): void;
  reloadConfig(): void;
  reloadInvitations(): void;
  reloadJoinRequests(): void;
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

/** Invitation and join-request administration for the active tenant. */
export function useTenantOnboardingAdministration(
  options: UseTenantOnboardingAdministrationOptions = {},
): UseTenantOnboardingAdministrationResult {
  const client = useClientMaybe() as InternalClient | null;
  const authClient = client?.auth ?? null;
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const auth = useAuth();
  const authConfig = useAuthConfig();
  const tenantKind = auth.activeTenant?.kind ?? null;
  const scopeEnabled = options.enabled !== false && Boolean(
    authClient
      && authorizationBoundary.ready
      && auth.isAuthenticated
      && auth.activeTenant
      && isTenantAdministrationScopeStable(auth.sessionTransition),
  );
  const invitationsEnabled = resolveTenantOnboardingFeaturePolicy(
    authConfig.status,
    authConfig.config,
    'invitations',
  );
  const joinRequestsEnabled = resolveTenantOnboardingFeaturePolicy(
    authConfig.status,
    authConfig.config,
    'joinRequests',
  );
  const boundaryKey = tenantAdministrationBoundaryKey(
    auth.user?.userId,
    auth.activeTenant?.tenantId,
    scopeEnabled,
    authorizationBoundary.key,
  );
  const boundaryFenceRef = React.useRef<TenantAdministrationBoundaryFence | null>(null);
  if (!boundaryFenceRef.current) {
    boundaryFenceRef.current = new TenantAdministrationBoundaryFence();
  }
  const boundaryFence = boundaryFenceRef.current;
  const boundaryRevision = boundaryFence.update(boundaryKey);

  const protectedConfig = useTenantOnboardingConfigSlice({
    authClient,
    boundaryFence,
    boundaryRevision,
    scopeEnabled,
  });

  const invitation = useTenantOnboardingInvitationSlice({
    authClient,
    boundaryFence,
    boundaryRevision,
    scopeEnabled,
    featureEnabled: invitationsEnabled,
    administrationConfig: protectedConfig.config,
    administrationConfigProjection: protectedConfig.projection,
    limit: options.limit,
    status: options.invitationStatus,
  });
  const joinRequest = useTenantOnboardingJoinRequestSlice({
    authClient,
    boundaryFence,
    boundaryRevision,
    scopeEnabled,
    featureEnabled: joinRequestsEnabled,
    tenantKind,
    administrationConfig: protectedConfig.config,
    administrationConfigProjection: protectedConfig.projection,
    limit: options.limit,
    status: options.joinRequestStatus,
  });

  const reloadInvitations = React.useCallback(() => {
    if (!boundaryFence.isCurrent(boundaryRevision)) return;
    retryTenantOnboardingSection(
      authConfig.status,
      protectedConfig.projection,
      protectedConfig.config !== null,
      {
        reloadPublicConfig: () => void authConfig.reload(),
        reloadTenantConfig: protectedConfig.reload,
        reloadFeature: invitation.reload,
      },
    );
  }, [
    authConfig.reload,
    authConfig.status,
    boundaryFence,
    boundaryRevision,
    invitation.reload,
    protectedConfig.config,
    protectedConfig.projection,
    protectedConfig.reload,
  ]);
  const reloadJoinRequests = React.useCallback(() => {
    if (!boundaryFence.isCurrent(boundaryRevision)) return;
    retryTenantOnboardingSection(
      authConfig.status,
      protectedConfig.projection,
      protectedConfig.config !== null,
      {
        reloadPublicConfig: () => void authConfig.reload(),
        reloadTenantConfig: protectedConfig.reload,
        reloadFeature: joinRequest.reload,
      },
    );
  }, [
    authConfig.reload,
    authConfig.status,
    boundaryFence,
    boundaryRevision,
    joinRequest.reload,
    protectedConfig.config,
    protectedConfig.projection,
    protectedConfig.reload,
  ]);
  const reload = React.useCallback(() => {
    if (!boundaryFence.isCurrent(boundaryRevision)) return;
    if (authConfig.status === 'error') {
      void authConfig.reload();
      return;
    }
    if (!protectedConfig.config
      || protectedConfig.projection.error
      || protectedConfig.projection.isPermissionDenied) {
      protectedConfig.reload();
      return;
    }
    invitation.reload();
    joinRequest.reload();
  }, [
    authConfig.reload,
    authConfig.status,
    boundaryFence,
    boundaryRevision,
    invitation.reload,
    joinRequest.reload,
    protectedConfig.config,
    protectedConfig.projection.error,
    protectedConfig.projection.isPermissionDenied,
    protectedConfig.reload,
  ]);

  const policyError = scopeEnabled && authConfig.status === 'error'
    ? authConfig.error
    : null;
  return {
    config: protectedConfig.config,
    invitations: invitation.invitations,
    joinRequests: joinRequest.requests,
    invitationPage: invitation.page,
    joinRequestPage: joinRequest.page,
    isLoading: protectedConfig.projection.isLoading
      || invitation.projection.isLoading
      || joinRequest.projection.isLoading,
    isLoadingMoreInvitations: invitation.projection.isLoadingMore,
    isLoadingMoreJoinRequests: joinRequest.projection.isLoadingMore,
    isMutating: invitation.projection.isMutating || joinRequest.projection.isMutating,
    error: projectTenantOnboardingAggregateError(
      policyError,
      protectedConfig.projection,
      invitation.projection,
      joinRequest.projection,
    ),
    authConfigStatus: authConfig.status,
    authConfigError: policyError,
    isLoadingConfig: protectedConfig.projection.isLoading,
    isConfigPermissionDenied: protectedConfig.projection.isPermissionDenied,
    configError: protectedConfig.projection.error,
    invitationsEnabled,
    joinRequestsEnabled,
    isLoadingInvitations: invitation.projection.isLoading
      || (invitationsEnabled === true && protectedConfig.projection.isLoading),
    isLoadingJoinRequests: joinRequest.projection.isLoading
      || (joinRequestsEnabled === true && protectedConfig.projection.isLoading),
    isMutatingInvitations: invitation.projection.isMutating,
    isMutatingJoinRequests: joinRequest.projection.isMutating,
    isInvitationsPermissionDenied: invitation.projection.isPermissionDenied,
    isJoinRequestsPermissionDenied: joinRequest.projection.isPermissionDenied,
    invitationsError: invitation.projection.error,
    joinRequestsError: joinRequest.projection.error,
    reload,
    reloadConfig: protectedConfig.reload,
    reloadInvitations,
    reloadJoinRequests,
    loadMoreInvitations: invitation.loadMore,
    loadMoreJoinRequests: joinRequest.loadMore,
    issueInvitation: invitation.issue,
    revokeInvitation: invitation.revoke,
    approveJoinRequest: joinRequest.approve,
    denyJoinRequest: joinRequest.deny,
  };
}

/** Administration tenants never participate in customer join-request admission. */
export function canLoadTenantJoinRequests(
  canReviewJoinRequests: boolean,
  tenantKind: 'administration' | 'organization' | null,
): boolean {
  return canReviewJoinRequests && tenantKind !== 'administration';
}
