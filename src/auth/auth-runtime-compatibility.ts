/**
 * Process-wide compatibility adapters for legacy Auth callers.
 *
 * Managed applications close over an app-local AuthRuntime. These adapters
 * intentionally reject ambiguous multi-app use and contain the only global
 * runtime registry retained for source compatibility.
 */

import { CompatibilityProviderRegistry } from '../runtime/compatibility-provider-registry';
import type { AuthRuntime } from './auth-runtime';

const authRuntimeProviders = new CompatibilityProviderRegistry<AuthRuntime>('Auth runtime');

/** Register one app runtime for the legacy no-argument getter surface. */
export function registerAuthRuntimeCompatibility(owner: object, runtime: AuthRuntime) {
  return authRuntimeProviders.register(owner, () => runtime);
}

/** Internal seam used by the legacy direct start/stop lifecycle. */
export function getAuthCompatibilityRuntime(): AuthRuntime | null {
  return authRuntimeProviders.get();
}

/** Runtime values exposed through Elysia derive for legacy callers. */
export function getAuthRuntimeContext() {
  return authRuntimeProviders.get()?.getContext() ?? emptyAuthRuntimeContext();
}

export function getAuthStore() {
  return authRuntimeProviders.get()?.getStore() ?? null;
}

export function getAuthAuditService() {
  return authRuntimeProviders.get()?.getAuditService() ?? null;
}

export function getTokenService() {
  return authRuntimeProviders.get()?.getTokenService() ?? null;
}

export function getAuthSessionService() {
  return authRuntimeProviders.get()?.getAuthSessionService() ?? null;
}

export function getAuthorizationKernel() {
  return authRuntimeProviders.get()?.getAuthorizationKernel() ?? null;
}

export function getAuthorizationRoleService() {
  return authRuntimeProviders.get()?.getAuthorizationRoleService() ?? null;
}

export function getPropertyService() {
  return authRuntimeProviders.get()?.getPropertyService() ?? null;
}

export function getActionTokenService() {
  return authRuntimeProviders.get()?.getActionTokenService() ?? null;
}

export function getAccountEmailService() {
  return authRuntimeProviders.get()?.getAccountEmailService() ?? null;
}

export function getMfaMethodStore() {
  return authRuntimeProviders.get()?.getMfaMethodStore() ?? null;
}

export function getMfaService() {
  return authRuntimeProviders.get()?.getMfaService() ?? null;
}

export function getMfaChallengeService() {
  return authRuntimeProviders.get()?.getMfaChallengeService() ?? null;
}

export function getNativeAuthorizationService() {
  return authRuntimeProviders.get()?.getNativeAuthorizationService() ?? null;
}

export function getRegistrationIntentStore() {
  return authRuntimeProviders.get()?.getRegistrationIntentStore() ?? null;
}

export function getAuthEmailOutbox() {
  return authRuntimeProviders.get()?.getAuthEmailOutbox() ?? null;
}

export function getVerifiedDomainOnboardingService() {
  return authRuntimeProviders.get()?.getVerifiedDomainOnboardingService() ?? null;
}

function emptyAuthRuntimeContext() {
  return {
    authStore: null,
    authAuditService: null,
    tokenService: null,
    authSessionService: null,
    authTenantSessionService: null,
    tenantAdministrationService: null,
    platformTenantAdministrationService: null,
    tenantOnboardingService: null,
    verifiedDomainOnboardingService: null,
    authorizationKernel: null,
    tenancyService: null,
    mfaMethodStore: null,
    mfaService: null,
    mfaChallengeService: null,
    nativeAuthorizationService: null,
  };
}
