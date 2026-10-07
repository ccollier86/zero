/** Shared runtime contract for the focused session route plugins. */

import type { AccountEmailService } from './account-email-service';
import type { EmailRuntime } from '../email/types';
import type { AuthActionTokenService } from './action-token-service';
import type { MfaChallengeService } from './mfa-challenge-service';
import type { MfaService } from './mfa-service';
import type { NativeAuthorizationService } from './oidc/native-authorization-service';
import type { RegistrationIntentStore } from './registration-intent-store';
import type { TokenService } from './token-service';
import { AuthError, type ResolvedAuthBehaviorConfig } from './types';
import type { UserPropertyService } from './user-property-service';
import type { UserStore } from './user-store';
import type { TenancyService } from './tenancy/tenancy-service';
import type { AuthTenantSessionService } from './auth-tenant-session-service';
import type { AuthRequestAdmissionService } from './auth-request-admission-service';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import type { AuthUserProfileService } from './auth-user-profile-service';
import type { AuthUserContactService } from './auth-user-contact-service';

export interface AuthSessionPluginConfig {
  getUserStore: () => UserStore | null;
  getTokenService: () => TokenService | null;
  getPropertyService: () => UserPropertyService | null;
  getActionTokenService: () => AuthActionTokenService | null;
  getAccountEmailService: () => AccountEmailService | null;
  getMfaService: () => MfaService | null;
  getMfaChallengeService: () => MfaChallengeService | null;
  getNativeAuthorizationService: () => NativeAuthorizationService | null;
  getRegistrationIntentStore: () => RegistrationIntentStore | null;
  getTenancyService?: () => TenancyService | null;
  getAuthTenantSessionService: () => AuthTenantSessionService | null;
  getRequestAdmissionService?: () => AuthRequestAdmissionService | null;
  getEmailRuntime: () => EmailRuntime;
  getAuthConfig: () => ResolvedAuthBehaviorConfig;
  getUserProfileService?: () => AuthUserProfileService | null;
  getUserContactService?: () => AuthUserContactService | null;
  getUserAvatarService?: () => import('./auth-user-avatar-service').AuthUserAvatarService | null;
  /** Managed composition supplies an app-local emitter; standalone adapters may omit it. */
  emitCode?: AuthPlatformCodeEmitter;
}

export interface AuthSessionServices {
  store: UserStore;
  tokenService: TokenService;
  propertyService: UserPropertyService;
  actionTokens: AuthActionTokenService;
  accountEmail: AccountEmailService;
  mfaChallengeService: MfaChallengeService | null;
  registrationIntents: RegistrationIntentStore;
  tenancyService: TenancyService | null;
  tenantSessions: AuthTenantSessionService;
}

export function requireSessionServices(
  config: AuthSessionPluginConfig
): AuthSessionServices {
  const store = config.getUserStore();
  const tokenService = config.getTokenService();
  const propertyService = config.getPropertyService();
  const actionTokens = config.getActionTokenService();
  const accountEmail = config.getAccountEmailService();
  const registrationIntents = config.getRegistrationIntentStore();
  const tenantSessions = config.getAuthTenantSessionService();
  if (!store || !tokenService || !propertyService || !actionTokens
    || !accountEmail || !registrationIntents || !tenantSessions) {
    throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  }
  return {
    store, tokenService, propertyService, actionTokens, accountEmail,
    mfaChallengeService: config.getMfaChallengeService(), registrationIntents,
    tenancyService: config.getTenancyService?.() ?? null,
    tenantSessions,
  };
}

export function requireSessionTokenService(config: AuthSessionPluginConfig): TokenService {
  const tokenService = config.getTokenService();
  if (!tokenService) throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  return tokenService;
}
