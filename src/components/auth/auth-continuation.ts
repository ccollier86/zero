/**
 * auth-continuation.ts
 *
 * Type guards for auth responses that require additional MFA steps. This file
 * owns response narrowing only; forms own rendering and AuthClient owns state.
 */

import type {
  AuthCompletionResult,
  AuthMfaChallengeRequiredResult,
  AuthMfaSetupRequiredResult,
  AuthSessionResult,
  AuthTenantOnboardingRequiredResult,
  AuthTenantSelectionRequiredResult,
} from '../../frontend/client/auth-client';

/** Return true when an auth response contains a complete app session. */
export function isAuthSessionResult(value: unknown): value is AuthSessionResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AuthSessionResult>;
  return (
    typeof candidate.accessToken === 'string' &&
    typeof candidate.refreshToken === 'string' &&
    Boolean(candidate.user)
  );
}
/** Return true when an auth response requires MFA enrollment before session issue. */
export function isMfaSetupRequiredResult(
  value: unknown,
): value is AuthMfaSetupRequiredResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AuthMfaSetupRequiredResult>;
  return candidate.mfaSetupRequired === true && typeof candidate.mfaSetupToken === 'string';
}

/** Return true when an auth response requires MFA challenge verification. */
export function isMfaChallengeRequiredResult(
  value: unknown,
): value is AuthMfaChallengeRequiredResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AuthMfaChallengeRequiredResult>;
  return candidate.mfaChallengeRequired === true && Boolean(candidate.mfaChallenge);
}

/** Return true when an auth response needs an MFA continuation UI. */
export function isMfaContinuationResult(
  value: AuthCompletionResult | null | undefined,
): value is AuthMfaSetupRequiredResult | AuthMfaChallengeRequiredResult {
  return isMfaSetupRequiredResult(value) || isMfaChallengeRequiredResult(value);
}

/** Return true when auth must bind one of several live organizations. */
export function isTenantSelectionRequiredResult(
  value: unknown,
): value is AuthTenantSelectionRequiredResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AuthTenantSelectionRequiredResult>;
  return candidate.tenantSelectionRequired === true
    && typeof candidate.tenantSelection?.continuation === 'string'
    && Array.isArray(candidate.tenantSelection?.tenants);
}

/** Return true when identity succeeded but no active tenant can be bound. */
export function isTenantOnboardingRequiredResult(
  value: unknown,
): value is AuthTenantOnboardingRequiredResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AuthTenantOnboardingRequiredResult>;
  return candidate.tenantOnboardingRequired === true
    && candidate.onboarding?.reason === 'no_active_tenant_membership';
}

export type AuthFlowContinuationResult =
  | AuthMfaSetupRequiredResult
  | AuthMfaChallengeRequiredResult
  | AuthTenantSelectionRequiredResult
  | AuthTenantOnboardingRequiredResult;

/** Any supported incomplete browser-auth result handled by Zero's coordinator. */
export function isAuthFlowContinuationResult(
  value: AuthCompletionResult | null | undefined,
): value is AuthFlowContinuationResult {
  return isMfaContinuationResult(value)
    || isTenantSelectionRequiredResult(value)
    || isTenantOnboardingRequiredResult(value);
}
