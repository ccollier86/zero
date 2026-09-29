'use client';

/** Compatibility barrel for the focused tenant administration hooks. */
export {
  useTenantMembers,
  type UseTenantMembersOptions,
  type UseTenantMembersResult,
} from './tenant-member-hooks';
export {
  canLoadTenantJoinRequests,
  useTenantOnboardingAdministration,
  type UseTenantOnboardingAdministrationOptions,
  type UseTenantOnboardingAdministrationResult,
} from './tenant-onboarding-hooks';
export {
  useTenantSwitcher,
  type UseTenantSwitcherResult,
} from './tenant-switcher-hooks';
export {
  isTenantAdministrationScopeStable,
  TenantAdministrationBoundaryFence,
  tenantAdministrationBoundaryKey,
} from './tenant-administration-boundary';
