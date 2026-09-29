import type { AccountEmailService } from './account-email-service';
import type { AuthEmailOutbox } from './auth-email-outbox';
import type { ResolvedAuthBehaviorConfig } from './types';
import type { AuthorizationKernel } from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import type { AuthRequestAdmissionService } from './auth-request-admission-service';
import type { AuthTenantOnboardingService } from './auth-tenant-onboarding-service';
import type { AuthTenantSessionService } from './auth-tenant-session-service';
import type { MfaChallengeService } from './mfa-challenge-service';
import type { TokenService } from './token-service';
import type { UserPropertyService } from './user-property-service';
import type { UserStore } from './user-store';

/** Runtime dependencies for the tenant-onboarding HTTP surface. */
export interface AuthTenantOnboardingPluginConfig {
  getService: () => AuthTenantOnboardingService | null;
  getUserStore: () => UserStore | null;
  getTokenService: () => TokenService | null;
  getPropertyService: () => UserPropertyService | null;
  getTenantSessionService: () => AuthTenantSessionService | null;
  getMfaChallengeService: () => MfaChallengeService | null;
  getRequestAdmissionService: () => AuthRequestAdmissionService | null;
  getAuthorizationKernel: () => AuthorizationKernel;
  getAuthorizationRoleService: () => AuthorizationRoleService | null;
  getAuthConfig: () => ResolvedAuthBehaviorConfig;
  getAccountEmailService: () => AccountEmailService | null;
  getAuthEmailOutbox: () => AuthEmailOutbox | null;
}
