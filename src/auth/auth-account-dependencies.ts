/** Runtime contract shared by public account-lifecycle route plugins. */

import type { AccountEmailService } from './account-email-service';
import type { AuthActionTokenService } from './action-token-service';
import type { AuthEmailOutbox } from './auth-email-outbox';
import type { MfaChallengeService } from './mfa-challenge-service';
import type { NativeAuthorizationService } from './oidc/native-authorization-service';
import type { RegistrationIntentStore } from './registration-intent-store';
import type { TokenService } from './token-service';
import { AuthError, type ResolvedAuthBehaviorConfig } from './types';
import type { UserStore } from './user-store';
import type { AuthTenantSessionService } from './auth-tenant-session-service';
import { emitPlatformCode } from '../observability/sink';
import type { AuthPlatformCodeEmitter } from './auth-observability';

export interface AuthAccountPluginConfig {
  getUserStore: () => UserStore | null;
  getTokenService: () => TokenService | null;
  getActionTokenService: () => AuthActionTokenService | null;
  getAccountEmailService: () => AccountEmailService | null;
  getAuthEmailOutbox: () => AuthEmailOutbox | null;
  getMfaChallengeService?: () => MfaChallengeService | null;
  getNativeAuthorizationService: () => NativeAuthorizationService | null;
  getRegistrationIntentStore: () => RegistrationIntentStore | null;
  getAuthConfig: () => ResolvedAuthBehaviorConfig;
  getAuthTenantSessionService: () => AuthTenantSessionService | null;
  /** Owning app emitter. Omitted only by standalone/legacy compositions. */
  emitCode?: AuthPlatformCodeEmitter;
}

export function getAuthAccountEmitter(
  config: AuthAccountPluginConfig,
): AuthPlatformCodeEmitter {
  return config.emitCode ?? emitPlatformCode;
}

export function requireAuthEmailOutbox(config: AuthAccountPluginConfig): AuthEmailOutbox {
  const outbox = config.getAuthEmailOutbox();
  if (!outbox) throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  return outbox;
}

export interface AuthAccountServices {
  store: UserStore;
  tokenService: TokenService;
  actionTokens: AuthActionTokenService;
  accountEmail: AccountEmailService;
  mfaChallengeService: MfaChallengeService | null;
  registrationIntents: RegistrationIntentStore;
  tenantSessions: AuthTenantSessionService;
}

export function requireAccountServices(
  config: AuthAccountPluginConfig
): AuthAccountServices {
  const store = config.getUserStore();
  const tokenService = config.getTokenService();
  const actionTokens = config.getActionTokenService();
  const accountEmail = config.getAccountEmailService();
  const registrationIntents = config.getRegistrationIntentStore();
  const tenantSessions = config.getAuthTenantSessionService();
  if (!store || !tokenService || !actionTokens || !accountEmail
    || !registrationIntents || !tenantSessions) {
    throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  }
  return {
    store, tokenService, actionTokens, accountEmail,
    mfaChallengeService: config.getMfaChallengeService?.() ?? null,
    registrationIntents,
    tenantSessions,
  };
}

export function requireAccountTokenService(config: AuthAccountPluginConfig): TokenService {
  const tokenService = config.getTokenService();
  if (!tokenService) throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  return tokenService;
}
