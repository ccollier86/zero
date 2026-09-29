import { describe, expect, test } from 'bun:test';
import {
  TenantAdministrationBoundaryFence,
  canLoadTenantJoinRequests,
  isTenantAdministrationScopeStable,
  tenantAdministrationBoundaryKey,
} from './tenant-administration-hooks';
import type {
  AuthPublicConfig,
  AuthTenantAdministrationConfig,
} from './auth-types';
import {
  projectTenantOnboardingSliceSettlement,
  resolveTenantOnboardingFeaturePolicy,
} from './tenant-onboarding-hooks';
import {
  assertTenantOnboardingMutationAllowed,
  canLoadTenantOnboardingFeature,
  projectTenantOnboardingAggregateError,
  projectTenantOnboardingConfigSettlement,
  retryTenantOnboardingSection,
  resolveTenantOnboardingRetryTarget,
  staleTenantOnboardingOperation,
  unavailableTenantAdministration,
  unavailableTenantAdministrationScope,
  unavailableTenantFeature,
  unavailableTenantPermission,
  unavailableTenantPolicy,
} from './tenant-onboarding-slice-core';

describe('tenant administration hook boundary fencing', () => {
  test('distinguishes account replacement even when the tenant id is unchanged', () => {
    expect(tenantAdministrationBoundaryKey('account-a', 'tenant-1')).not.toBe(
      tenantAdministrationBoundaryKey('account-b', 'tenant-1'),
    );
  });

  test('distinguishes tenant switches for the same account and clears disabled scope', () => {
    expect(tenantAdministrationBoundaryKey('account-a', 'tenant-1')).not.toBe(
      tenantAdministrationBoundaryKey('account-a', 'tenant-2'),
    );
    expect(tenantAdministrationBoundaryKey('account-a', 'tenant-1', false)).toBeNull();
    expect(isTenantAdministrationScopeStable(transition('preparing'))).toBe(false);
    expect(isTenantAdministrationScopeStable(transition('reconciling'))).toBe(false);
    expect(isTenantAdministrationScopeStable(transition('idle'))).toBe(true);
    expect(isTenantAdministrationScopeStable(transition('recovery-required'))).toBe(true);
    expect(tenantAdministrationBoundaryKey(
      'account-a',
      'tenant-1',
      true,
      'session-family-a',
    )).not.toBe(tenantAdministrationBoundaryKey(
      'account-a',
      'tenant-1',
      true,
      'session-family-b',
    ));
  });

  test('suppresses late list, loadMore, and mutation completions from older boundaries', () => {
    const fence = new TenantAdministrationBoundaryFence();
    const tenantOneRequest = fence.update(
      tenantAdministrationBoundaryKey('account-a', 'tenant-1'),
    );
    expect(fence.isCurrent(tenantOneRequest)).toBe(true);

    const tenantTwoRequest = fence.update(
      tenantAdministrationBoundaryKey('account-a', 'tenant-2'),
    );
    expect(fence.isCurrent(tenantOneRequest)).toBe(false);
    expect(fence.isCurrent(tenantTwoRequest)).toBe(true);

    const replacementAccountRequest = fence.update(
      tenantAdministrationBoundaryKey('account-b', 'tenant-2'),
    );
    expect(fence.isCurrent(tenantTwoRequest)).toBe(false);
    expect(fence.isCurrent(replacementAccountRequest)).toBe(true);
  });

  test('blocks a retained administration handler before it can dispatch in a replacement scope', () => {
    const fence = new TenantAdministrationBoundaryFence();
    const scopeA = fence.update(tenantAdministrationBoundaryKey(
      'account-a', 'tenant-1', true, 'session-family-a',
    ));
    let dispatches = 0;
    const retained = () => {
      if (!fence.isCurrent(scopeA)) return;
      dispatches += 1;
    };

    fence.update(tenantAdministrationBoundaryKey(
      'account-a', 'tenant-1', true, 'session-family-b',
    ));
    retained();

    expect(dispatches).toBe(0);
  });

  test('never loads customer join requests in the protected administration scope', () => {
    expect(canLoadTenantJoinRequests(true, 'administration')).toBe(false);
    expect(canLoadTenantJoinRequests(true, 'organization')).toBe(true);
    expect(canLoadTenantJoinRequests(false, 'organization')).toBe(false);
  });

  test('does not enable onboarding calls until public feature policy is ready', () => {
    const config = onboardingConfig(true, false);

    expect(resolveTenantOnboardingFeaturePolicy(
      'unknown', null, 'invitations',
    )).toBeNull();
    expect(resolveTenantOnboardingFeaturePolicy(
      'loading', config, 'invitations',
    )).toBeNull();
    expect(resolveTenantOnboardingFeaturePolicy(
      'error', null, 'invitations',
    )).toBe(false);
    expect(resolveTenantOnboardingFeaturePolicy(
      'ready', config, 'invitations',
    )).toBe(true);
    expect(resolveTenantOnboardingFeaturePolicy(
      'ready', config, 'joinRequests',
    )).toBe(false);
    expect(canLoadTenantOnboardingFeature(true, false, true, true)).toBe(false);
    expect(canLoadTenantOnboardingFeature(true, null, true, true)).toBe(false);
    expect(canLoadTenantOnboardingFeature(true, true, true, true)).toBe(true);
  });

  test('projects invitation and join-request settlement independently', () => {
    const invitations = projectTenantOnboardingSliceSettlement(
      true,
      true,
      4,
      4,
      settlement({ isMutating: true }),
    );
    const staleJoinRequests = projectTenantOnboardingSliceSettlement(
      true,
      true,
      4,
      3,
      settlement({ error: 'older boundary failure' }),
    );

    expect(invitations).toMatchObject({
      isCurrent: true,
      isLoading: false,
      isMutating: true,
      error: null,
    });
    expect(staleJoinRequests).toMatchObject({
      isCurrent: false,
      isLoading: true,
      isMutating: false,
      error: null,
    });

    const failedJoinRequests = projectTenantOnboardingSliceSettlement(
      true,
      true,
      4,
      4,
      settlement({ error: 'join request transport failed' }),
    );
    expect(failedJoinRequests).toMatchObject({
      isCurrent: true,
      isLoading: false,
      error: 'join request transport failed',
    });
    expect(invitations.error).toBeNull();
  });

  test('uses canonical typed errors for every local onboarding guard', () => {
    expect(unavailableTenantAdministration()).toMatchObject({
      name: 'AuthClientError',
      status: 401,
      code: 'UNAUTHORIZED',
      body: null,
    });
    expect(unavailableTenantAdministrationScope()).toMatchObject({
      name: 'AuthClientError',
      status: 404,
      code: 'TENANT_ADMINISTRATION_UNAVAILABLE',
      body: null,
    });
    expect(unavailableTenantFeature('invitations')).toMatchObject({
      name: 'AuthClientError',
      status: 404,
      code: 'TENANT_INVITATIONS_UNAVAILABLE',
      body: null,
    });
    expect(unavailableTenantFeature('joinRequests')).toMatchObject({
      name: 'AuthClientError',
      status: 404,
      code: 'TENANT_JOIN_REQUESTS_UNAVAILABLE',
      body: null,
    });
    expect(unavailableTenantPermission()).toMatchObject({
      name: 'AuthClientError',
      status: 403,
      code: 'FORBIDDEN',
      body: null,
    });
    expect(unavailableTenantPolicy()).toMatchObject({
      name: 'AuthClientError',
      status: 503,
      code: 'AUTH_POLICY_UNAVAILABLE',
      body: null,
    });
    expect(staleTenantOnboardingOperation()).toMatchObject({
      name: 'AuthClientError',
      status: 409,
      code: 'AUTHORIZATION_CHANGED',
      body: null,
    });
  });

  test('keeps protected config independent and retries only the failed prerequisite', () => {
    const protectedConfig = projectTenantOnboardingConfigSettlement(
      true,
      7,
      7,
      {
        isLoading: false,
        isPermissionDenied: false,
        error: null,
      },
    );
    expect(protectedConfig).toEqual({
      isCurrent: true,
      isLoading: false,
      isPermissionDenied: false,
      error: null,
    });
    expect(resolveTenantOnboardingFeaturePolicy(
      'ready', onboardingConfig(false, false), 'invitations',
    )).toBe(false);
    expect(protectedConfig.isCurrent).toBe(true);

    expect(resolveTenantOnboardingRetryTarget(
      'error', protectedConfig, true,
    )).toBe('public-config');
    expect(resolveTenantOnboardingRetryTarget('ready', {
      ...protectedConfig,
      error: 'protected config failed',
    }, false)).toBe('tenant-config');
    expect(resolveTenantOnboardingRetryTarget(
      'ready', protectedConfig, false,
    )).toBe('tenant-config');
    expect(resolveTenantOnboardingRetryTarget(
      'ready', protectedConfig, true,
    )).toBe('feature');

    const retries = { publicConfig: 0, tenantConfig: 0, feature: 0 };
    const retryActions = {
      reloadPublicConfig: () => { retries.publicConfig += 1; },
      reloadTenantConfig: () => { retries.tenantConfig += 1; },
      reloadFeature: () => { retries.feature += 1; },
    };
    expect(retryTenantOnboardingSection(
      'error', protectedConfig, true, retryActions,
    )).toBe('public-config');
    expect(retries).toEqual({ publicConfig: 1, tenantConfig: 0, feature: 0 });

    expect(retryTenantOnboardingSection('ready', {
      ...protectedConfig,
      error: 'protected config failed',
    }, false, retryActions)).toBe('tenant-config');
    expect(retries).toEqual({ publicConfig: 1, tenantConfig: 1, feature: 0 });

    expect(retryTenantOnboardingSection(
      'ready', protectedConfig, true, retryActions,
    )).toBe('feature');
    expect(retries).toEqual({ publicConfig: 1, tenantConfig: 1, feature: 1 });
  });

  test('fails mutation guards closed before transport while policy is unavailable', () => {
    const config = tenantAdministrationConfig();
    let dispatches = 0;
    const attempt = (
      featureEnabled: boolean | null,
      projection: ReturnType<typeof projectTenantOnboardingConfigSettlement>,
      scopeEnabled = true,
    ) => {
      try {
        const guard = {
          authClient: { dispatch: () => { dispatches += 1; } },
          callbackCurrent: true,
          scopeEnabled,
          feature: 'invitations' as const,
          featureEnabled,
          tenantKindAllowed: true,
          administrationConfig: config,
          administrationConfigProjection: projection,
        };
        assertTenantOnboardingMutationAllowed(guard);
        guard.authClient.dispatch();
        return null;
      } catch (cause) {
        return cause;
      }
    };
    const loadingConfig = projectTenantOnboardingConfigSettlement(
      true, 2, -1, { isLoading: true, isPermissionDenied: false, error: null },
    );
    const failedConfig = projectTenantOnboardingConfigSettlement(
      true, 2, 2, {
        isLoading: false,
        isPermissionDenied: false,
        error: 'protected config failed',
      },
    );

    expect(attempt(false, loadingConfig)).toMatchObject({
      status: 404,
      code: 'TENANT_INVITATIONS_UNAVAILABLE',
      body: null,
    });
    expect(attempt(true, loadingConfig, false)).toMatchObject({
      status: 404,
      code: 'TENANT_ADMINISTRATION_UNAVAILABLE',
      body: null,
    });
    expect(attempt(true, loadingConfig)).toMatchObject({
      status: 503,
      code: 'AUTH_POLICY_UNAVAILABLE',
      body: null,
    });
    expect(attempt(true, failedConfig)).toMatchObject({
      status: 503,
      code: 'AUTH_POLICY_UNAVAILABLE',
      body: null,
    });
    expect(dispatches).toBe(0);

    const readyConfig = projectTenantOnboardingConfigSettlement(
      true, 2, 2, { isLoading: false, isPermissionDenied: false, error: null },
    );
    expect(attempt(true, readyConfig)).toBeNull();
    expect(dispatches).toBe(1);
  });

  test('keeps permission denial visible through the legacy aggregate error', () => {
    const config = projectTenantOnboardingConfigSettlement(
      true,
      1,
      1,
      { isLoading: false, isPermissionDenied: false, error: null },
    );
    const invitations = projectTenantOnboardingSliceSettlement(
      true,
      true,
      1,
      1,
      settlement({ isPermissionDenied: true }),
    );
    const joinRequests = projectTenantOnboardingSliceSettlement(
      true,
      true,
      1,
      1,
      settlement(),
    );
    expect(projectTenantOnboardingAggregateError(
      null,
      config,
      invitations,
      joinRequests,
    )).toBe('Invitation history is not available for the current role');
  });
});

function onboardingConfig(
  invitations: boolean,
  joinRequests: boolean,
): AuthPublicConfig {
  return {
    tenancy: {
      mode: 'multi',
      onboarding: {
        invitations: {
          enabled: invitations,
          accountCreation: true,
          delivery: {
            default: 'manual',
            manual: true,
            email: false,
          },
        },
        joinRequests: { enabled: joinRequests },
      },
    },
  } as AuthPublicConfig;
}

function settlement(overrides: Partial<{
  isLoading: boolean;
  isLoadingMore: boolean;
  isMutating: boolean;
  isPermissionDenied: boolean;
  error: string | null;
}> = {}) {
  return {
    isLoading: false,
    isLoadingMore: false,
    isMutating: false,
    isPermissionDenied: false,
    error: null,
    ...overrides,
  };
}

function tenantAdministrationConfig(): AuthTenantAdministrationConfig {
  return {
    tenancy: 'multi',
    authorization: 'advanced',
    terminology: { singular: 'organization', plural: 'organizations' },
    tenant: {
      tenantId: 'tenant-a',
      kind: 'organization',
      slug: 'tenant-a',
      name: 'Tenant A',
    },
    actor: {
      membershipId: 'membership-a',
      roles: ['owner'],
      permissions: [],
      allPermissions: true,
    },
    capabilities: {
      canReadMembers: true,
      canManageMembers: true,
      canReadRoles: true,
      canManageRoles: true,
      canTransferOwnership: true,
      canReadInvitations: true,
      canManageInvitations: true,
      canReviewJoinRequests: true,
    },
    roles: [],
  };
}

function transition(
  phase: 'idle' | 'preparing' | 'committed' | 'reconciling' | 'recovery-required',
) {
  return {
    phase,
    operation: phase === 'idle' ? null : 'tenant-switch' as const,
    revision: 1,
    recoverable: phase === 'recovery-required',
    error: null,
  };
}
