'use client';

import type * as React from 'react';
import { reportAuthClientActionFailure } from './auth-action-observability';
import { AuthClientError } from './auth-errors';
import type { AuthConfigStatus } from './auth-hooks';
import type {
  AuthPublicConfig,
  AuthTenantAdministrationConfig,
} from './auth-types';
import type { TenantAdministrationBoundaryFence } from './tenant-administration-boundary';

export type TenantOnboardingAction =
  | 'tenantOnboardingConfig'
  | 'tenantInvitations'
  | 'tenantJoinRequests';

export interface TenantOnboardingSliceSettlement {
  readonly isLoading: boolean;
  readonly isLoadingMore: boolean;
  readonly isMutating: boolean;
  readonly isPermissionDenied: boolean;
  readonly error: string | null;
}

export interface TenantOnboardingSliceProjection
  extends TenantOnboardingSliceSettlement {
  readonly isCurrent: boolean;
}

export interface TenantOnboardingConfigSettlement {
  readonly isLoading: boolean;
  readonly isPermissionDenied: boolean;
  readonly error: string | null;
}

export interface TenantOnboardingConfigProjection
  extends TenantOnboardingConfigSettlement {
  readonly isCurrent: boolean;
}

/** Preserve the legacy single-error projection while exact slices stay typed. */
export function projectTenantOnboardingAggregateError(
  policyError: string | null,
  tenantConfig: TenantOnboardingConfigProjection,
  invitations: TenantOnboardingSliceProjection,
  joinRequests: TenantOnboardingSliceProjection,
): string | null {
  return policyError
    ?? tenantConfig.error
    ?? (tenantConfig.isPermissionDenied
      ? 'Tenant onboarding access is not available for the current role'
      : null)
    ?? invitations.error
    ?? (invitations.isPermissionDenied
      ? 'Invitation history is not available for the current role'
      : null)
    ?? joinRequests.error
    ?? (joinRequests.isPermissionDenied
      ? 'Join-request review is not available for the current role'
      : null);
}

/** Resolve one public capability without treating uncertainty as disabled. */
export function resolveTenantOnboardingFeaturePolicy(
  status: AuthConfigStatus,
  config: AuthPublicConfig | null,
  feature: 'invitations' | 'joinRequests',
): boolean | null {
  if (status === 'unknown' || status === 'loading') return null;
  if (status === 'error' || !config) return false;
  return config.tenancy?.onboarding?.[feature]?.enabled === true;
}

/** Hide stale slice data without coupling it to its sibling's settlement. */
export function projectTenantOnboardingSliceSettlement(
  scopeEnabled: boolean,
  featureEnabled: boolean | null,
  boundaryRevision: number,
  loadedBoundaryRevision: number,
  settlement: TenantOnboardingSliceSettlement,
): TenantOnboardingSliceProjection {
  const isCurrent = scopeEnabled
    && featureEnabled === true
    && boundaryRevision === loadedBoundaryRevision;
  return {
    isCurrent,
    isLoading: scopeEnabled && (
      featureEnabled === null
      || (featureEnabled === true && (!isCurrent || settlement.isLoading))
    ),
    isLoadingMore: isCurrent && settlement.isLoadingMore,
    isMutating: isCurrent && settlement.isMutating,
    isPermissionDenied: isCurrent && settlement.isPermissionDenied,
    error: isCurrent ? settlement.error : null,
  };
}

/** Project protected config independently from public feature policy. */
export function projectTenantOnboardingConfigSettlement(
  scopeEnabled: boolean,
  boundaryRevision: number,
  loadedBoundaryRevision: number,
  settlement: TenantOnboardingConfigSettlement,
): TenantOnboardingConfigProjection {
  const isCurrent = scopeEnabled && boundaryRevision === loadedBoundaryRevision;
  return {
    isCurrent,
    isLoading: scopeEnabled && (!isCurrent || settlement.isLoading),
    isPermissionDenied: isCurrent && settlement.isPermissionDenied,
    error: isCurrent ? settlement.error : null,
  };
}

export type TenantOnboardingRetryTarget =
  | 'public-config'
  | 'tenant-config'
  | 'feature';

export interface TenantOnboardingRetryActions {
  reloadPublicConfig(): void;
  reloadTenantConfig(): void;
  reloadFeature(): void;
}

/** Select the narrowest failed prerequisite that a section retry must reload. */
export function resolveTenantOnboardingRetryTarget(
  authConfigStatus: AuthConfigStatus,
  tenantConfig: TenantOnboardingConfigProjection,
  hasTenantConfig: boolean,
): TenantOnboardingRetryTarget {
  if (authConfigStatus === 'error') return 'public-config';
  if (tenantConfig.error
    || tenantConfig.isPermissionDenied
    || !tenantConfig.isCurrent
    || !hasTenantConfig) {
    return 'tenant-config';
  }
  return 'feature';
}

/** Dispatch exactly one retry without coupling the two feature slices. */
export function retryTenantOnboardingSection(
  authConfigStatus: AuthConfigStatus,
  tenantConfig: TenantOnboardingConfigProjection,
  hasTenantConfig: boolean,
  actions: TenantOnboardingRetryActions,
): TenantOnboardingRetryTarget {
  const target = resolveTenantOnboardingRetryTarget(
    authConfigStatus,
    tenantConfig,
    hasTenantConfig,
  );
  if (target === 'public-config') actions.reloadPublicConfig();
  else if (target === 'tenant-config') actions.reloadTenantConfig();
  else actions.reloadFeature();
  return target;
}

/** Shared fail-closed read gate used before either feature transport. */
export function canLoadTenantOnboardingFeature(
  scopeEnabled: boolean,
  featureEnabled: boolean | null,
  hasAuthClient: boolean,
  hasTenantConfig: boolean,
): boolean {
  return scopeEnabled
    && featureEnabled === true
    && hasAuthClient
    && hasTenantConfig;
}

export interface TenantOnboardingMutationGuard<T> {
  authClient: T | null;
  callbackCurrent: boolean;
  scopeEnabled: boolean;
  feature: 'invitations' | 'joinRequests';
  featureEnabled: boolean | null;
  tenantKindAllowed: boolean;
  administrationConfig: AuthTenantAdministrationConfig | null;
  administrationConfigProjection: TenantOnboardingConfigProjection;
}

/** Enforce every local mutation prerequisite before transport dispatch. */
export function assertTenantOnboardingMutationAllowed<T>(
  guard: TenantOnboardingMutationGuard<T>,
): asserts guard is TenantOnboardingMutationGuard<T> & { authClient: T } {
  if (!guard.authClient) throw unavailableTenantAdministration();
  if (!guard.callbackCurrent) throw staleTenantOnboardingOperation();
  if (!guard.scopeEnabled) throw unavailableTenantAdministrationScope();
  if (guard.featureEnabled !== true || !guard.tenantKindAllowed) {
    throw unavailableTenantFeature(guard.feature);
  }
  if (guard.administrationConfigProjection.isPermissionDenied) {
    throw unavailableTenantPermission();
  }
  if (!guard.administrationConfigProjection.isCurrent
    || guard.administrationConfigProjection.isLoading
    || guard.administrationConfigProjection.error
    || !guard.administrationConfig) {
    throw unavailableTenantPolicy();
  }
  const capability = guard.feature === 'invitations'
    ? guard.administrationConfig.capabilities.canManageInvitations
    : guard.administrationConfig.capabilities.canReviewJoinRequests;
  if (!capability) throw unavailableTenantPermission();
}

export function isCurrentTenantOnboardingRequest(
  fence: TenantAdministrationBoundaryFence,
  boundaryRevision: number,
  generationRef: React.MutableRefObject<number>,
  generation: number,
): boolean {
  return fence.isCurrent(boundaryRevision) && generationRef.current === generation;
}

export function settleTenantOnboardingFailure(
  cause: unknown,
  action: TenantOnboardingAction,
  setPermissionDenied: React.Dispatch<React.SetStateAction<boolean>>,
  setError: React.Dispatch<React.SetStateAction<string | null>>,
): void {
  const permissionDenied = cause instanceof AuthClientError && cause.status === 403;
  reportAuthClientActionFailure(action, cause, { codeOnly: true });
  setPermissionDenied(permissionDenied);
  setError(permissionDenied ? null : tenantOnboardingErrorMessage(cause));
}

export function tenantOnboardingErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Tenant onboarding request failed';
}

export function unavailableTenantAdministration(): AuthClientError {
  return new AuthClientError(
    'Tenant administration requires an authenticated Zero client',
    401,
    'UNAUTHORIZED',
    null,
  );
}

export function unavailableTenantFeature(
  feature: 'invitations' | 'joinRequests',
): AuthClientError {
  const invitations = feature === 'invitations';
  return new AuthClientError(
    invitations
      ? 'Tenant invitations are not enabled by the current public auth policy'
      : 'Tenant join requests are not enabled by the current public auth policy',
    404,
    invitations
      ? 'TENANT_INVITATIONS_UNAVAILABLE'
      : 'TENANT_JOIN_REQUESTS_UNAVAILABLE',
    null,
  );
}

export function unavailableTenantPermission(): AuthClientError {
  return new AuthClientError(
    'Your current tenant role does not allow this action',
    403,
    'FORBIDDEN',
    null,
  );
}

export function unavailableTenantAdministrationScope(): AuthClientError {
  return new AuthClientError(
    'Tenant administration requires an active tenant scope',
    404,
    'TENANT_ADMINISTRATION_UNAVAILABLE',
    null,
  );
}

export function unavailableTenantPolicy(): AuthClientError {
  return new AuthClientError(
    'Tenant administration policy is unavailable; retry after it loads',
    503,
    'AUTH_POLICY_UNAVAILABLE',
    null,
  );
}

export function staleTenantOnboardingOperation(): AuthClientError {
  return new AuthClientError(
    'The authorization scope changed before this request completed',
    409,
    'AUTHORIZATION_CHANGED',
    null,
  );
}
