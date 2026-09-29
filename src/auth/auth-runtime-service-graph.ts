/**
 * Mutable app-local service graph owned by one AuthRuntime.
 *
 * The graph is deliberately internal. Keeping the references together lets
 * bootstrap and lifecycle code cooperate on partial-startup cleanup without
 * turning either concern into part of the public AuthRuntime API.
 */

import type { AccountEmailService } from './account-email-service';
import type { AuthActionTokenService } from './action-token-service';
import type { AuthApplicationAdministrationService } from './auth-application-administration-service';
import type { AuthAuditService } from './auth-audit-service';
import type { AuthEmailOutbox } from './auth-email-outbox';
import type { InstalledAuthProfileGuard } from './auth-profile-state';
import type { AuthPlatformTenantAdministrationService } from './auth-platform-tenant-administration-service';
import type { AuthRequestAdmissionService } from './auth-request-admission-service';
import type { AuthSessionService } from './auth-session-service';
import type { AuthTenantAdministrationService } from './auth-tenant-administration-service';
import type { AuthTenantOnboardingService } from './auth-tenant-onboarding-service';
import type { AuthTenantSessionService } from './auth-tenant-session-service';
import type { AuthorizationRoleService } from './authorization-role-service';
import type { MfaChallengeService } from './mfa-challenge-service';
import type { MfaChallengeStore } from './mfa-challenge-store';
import type { MfaMethodStore } from './mfa-method-store';
import type { MfaService } from './mfa-service';
import type { NativeAuthorizationService } from './oidc/native-authorization-service';
import type { RegistrationIntentStore } from './registration-intent-store';
import type { TenancyService } from './tenancy/tenancy-service';
import type { TokenService } from './token-service';
import type { UserPropertyService } from './user-property-service';
import type { UserStore } from './user-store';
import type { VerifiedDomainOnboardingService } from './verified-domain-service';

export interface AuthRuntimeServiceGraph {
  userStore: UserStore | null;
  auditService: AuthAuditService | null;
  requestAdmissionService: AuthRequestAdmissionService | null;
  tokenService: TokenService | null;
  authSessionService: AuthSessionService | null;
  authTenantSessionService: AuthTenantSessionService | null;
  applicationAdministrationService: AuthApplicationAdministrationService | null;
  tenantAdministrationService: AuthTenantAdministrationService | null;
  platformTenantAdministrationService: AuthPlatformTenantAdministrationService | null;
  tenantOnboardingService: AuthTenantOnboardingService | null;
  verifiedDomainOnboardingService: VerifiedDomainOnboardingService | null;
  tenancyService: TenancyService | null;
  propertyService: UserPropertyService | null;
  actionTokenService: AuthActionTokenService | null;
  accountEmailService: AccountEmailService | null;
  mfaMethodStore: MfaMethodStore | null;
  mfaService: MfaService | null;
  mfaChallengeStore: MfaChallengeStore | null;
  mfaChallengeService: MfaChallengeService | null;
  nativeAuthorizationService: NativeAuthorizationService | null;
  registrationIntentStore: RegistrationIntentStore | null;
  authEmailOutbox: AuthEmailOutbox | null;
  authorizationRoleService: AuthorizationRoleService | null;
  installedProfileGuard: InstalledAuthProfileGuard | null;
}

export function createAuthRuntimeServiceGraph(): AuthRuntimeServiceGraph {
  return {
    userStore: null,
    auditService: null,
    requestAdmissionService: null,
    tokenService: null,
    authSessionService: null,
    authTenantSessionService: null,
    applicationAdministrationService: null,
    tenantAdministrationService: null,
    platformTenantAdministrationService: null,
    tenantOnboardingService: null,
    verifiedDomainOnboardingService: null,
    tenancyService: null,
    propertyService: null,
    actionTokenService: null,
    accountEmailService: null,
    mfaMethodStore: null,
    mfaService: null,
    mfaChallengeStore: null,
    mfaChallengeService: null,
    nativeAuthorizationService: null,
    registrationIntentStore: null,
    authEmailOutbox: null,
    authorizationRoleService: null,
    installedProfileGuard: null,
  };
}

export function authRuntimeServiceGraphHasState(
  services: AuthRuntimeServiceGraph,
): boolean {
  return Object.values(services).some((service) => service !== null);
}

export function resetAuthRuntimeServiceGraph(
  services: AuthRuntimeServiceGraph,
): void {
  for (const key of Object.keys(services) as Array<keyof AuthRuntimeServiceGraph>) {
    services[key] = null;
  }
}
