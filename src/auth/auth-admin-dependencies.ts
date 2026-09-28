/**
 * auth-admin-dependencies.ts
 *
 * Defines the narrow runtime contract shared by admin route plugins and owns
 * admin authentication. It does not register routes or mutate auth state.
 */

import type { AccountEmailService } from './account-email-service';
import type { EmailRuntime } from '../email/types';
import type { AuthActionTokenService } from './action-token-service';
import {
  captureAuthAdminMutationAuthority,
  type AssertAuthAdminMutationAuthority,
} from './auth-admin-mutation-authority';
import { extractAuthContext } from './auth-context';
import type { MfaChallengeService } from './mfa-challenge-service';
import type { MfaService } from './mfa-service';
import type { TokenService } from './token-service';
import { AuthError, type AuthContext, type ResolvedAuthBehaviorConfig } from './types';
import type { UserPropertyService } from './user-property-service';
import type { UserStore } from './user-store';

export interface AuthAdminPluginConfig {
  getUserStore: () => UserStore | null;
  getTokenService: () => TokenService | null;
  getPropertyService: () => UserPropertyService | null;
  getActionTokenService: () => AuthActionTokenService | null;
  getAccountEmailService: () => AccountEmailService | null;
  getMfaService?: () => MfaService | null;
  getMfaChallengeService?: () => MfaChallengeService | null;
  getEmailRuntime: () => EmailRuntime;
  getAuthConfig: () => ResolvedAuthBehaviorConfig;
}

export interface AdminServices {
  store: UserStore;
  propertyService: UserPropertyService;
  auth: AuthContext;
}

export interface AdminMutationServices extends AdminServices {
  assertCurrentAuthority: AssertAuthAdminMutationAuthority;
}

/** Authenticate an admin request and return initialized route dependencies. */
export async function requireAdminServices(
  config: AuthAdminPluginConfig,
  request: Request
): Promise<AdminServices> {
  const store = config.getUserStore();
  const tokenService = config.getTokenService();
  const propertyService = config.getPropertyService();
  if (!store || !tokenService || !propertyService) {
    throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  }

  const auth = await extractAuthContext(request, tokenService);
  if (!auth) throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
  if (auth.role !== 'admin') throw new AuthError('Forbidden', 'FORBIDDEN', 403);
  return { store, propertyService, auth };
}

/** Authenticate and capture the exact authority required by an admin write. */
export async function requireAdminMutationServices(
  config: AuthAdminPluginConfig,
  request: Request,
): Promise<AdminMutationServices> {
  const services = await requireAdminServices(config, request);
  const tokenService = config.getTokenService();
  if (!tokenService) throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  return {
    ...services,
    assertCurrentAuthority: captureAuthAdminMutationAuthority({
      auth: services.auth,
      tokenService,
    }),
  };
}

/** Require the initialized MFA coordinator used by admin MFA routes. */
export function requireAdminMfaService(config: AuthAdminPluginConfig): MfaChallengeService {
  const service = config.getMfaChallengeService?.();
  if (!service) throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  return service;
}

/** Fail before setting mfaRequired when no configured factor can be enrolled. */
export function assertMfaRequirementAvailable(config: AuthAdminPluginConfig): void {
  const service = config.getMfaService?.();
  const challenge = config.getMfaChallengeService?.();
  const readiness = service?.getReadiness({
    emailOtpReady: config.getEmailRuntime().enabled,
  });
  if (!challenge || !readiness?.enabled || !readiness.ready || !readiness.availableMethods.length) {
    throw new AuthError('MFA is not available', 'MFA_NOT_AVAILABLE', 409);
  }
}
