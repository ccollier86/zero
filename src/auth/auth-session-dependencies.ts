/** Shared runtime contract for the focused session route plugins. */

import type { AccountEmailService } from './account-email-service';
import type { AuthActionTokenService } from './action-token-service';
import type { MfaChallengeService } from './mfa-challenge-service';
import type { MfaService } from './mfa-service';
import type { NativeAuthorizationService } from './oidc/native-authorization-service';
import type { RegistrationIntentStore } from './registration-intent-store';
import type { TokenService } from './token-service';
import { AuthError, type ResolvedAuthBehaviorConfig } from './types';
import type { UserPropertyService } from './user-property-service';
import type { UserStore } from './user-store';

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
  getAuthConfig: () => ResolvedAuthBehaviorConfig;
}

export interface AuthSessionServices {
  store: UserStore;
  tokenService: TokenService;
  propertyService: UserPropertyService;
  actionTokens: AuthActionTokenService;
  accountEmail: AccountEmailService;
  mfaChallengeService: MfaChallengeService | null;
  registrationIntents: RegistrationIntentStore;
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
  if (!store || !tokenService || !propertyService || !actionTokens
    || !accountEmail || !registrationIntents) {
    throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  }
  return {
    store, tokenService, propertyService, actionTokens, accountEmail,
    mfaChallengeService: config.getMfaChallengeService(), registrationIntents,
  };
}

export function requireSessionTokenService(config: AuthSessionPluginConfig): TokenService {
  const tokenService = config.getTokenService();
  if (!tokenService) throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  return tokenService;
}
