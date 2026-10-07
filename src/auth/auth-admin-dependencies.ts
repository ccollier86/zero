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
import type { AuthorizationKernel } from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import { emitPlatformCode } from '../observability/sink';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import type { AuthUserContactService } from './auth-user-contact-service';
import {
  createRequestAuthorizationAccess,
  type RequestAuthorizationAccess,
} from './authorization-access';

export interface AuthAdminPluginConfig {
  getUserStore: () => UserStore | null;
  getTokenService: () => TokenService | null;
  getAuthorizationKernel: () => AuthorizationKernel;
  getAuthorizationRoleService: () => AuthorizationRoleService | null;
  getPropertyService: () => UserPropertyService | null;
  getActionTokenService: () => AuthActionTokenService | null;
  getAccountEmailService: () => AccountEmailService | null;
  getMfaService?: () => MfaService | null;
  getMfaChallengeService?: () => MfaChallengeService | null;
  getEmailRuntime: () => EmailRuntime;
  getAuthConfig: () => ResolvedAuthBehaviorConfig;
  getUserContactService?: () => AuthUserContactService | null;
  /** Owning app emitter. Omitted only by standalone/legacy compositions. */
  emitCode?: AuthPlatformCodeEmitter;
}

export function getAuthAdminEmitter(
  config: AuthAdminPluginConfig,
): AuthPlatformCodeEmitter {
  return config.emitCode ?? emitPlatformCode;
}

export interface AdminServices {
  store: UserStore;
  propertyService: UserPropertyService;
  auth: AuthContext;
  access: RequestAuthorizationAccess;
  /** Final read fence for sensitive account projections. */
  assertCurrentAuthority: AssertAuthAdminMutationAuthority;
}

export type AdminMutationServices = AdminServices;

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
  const kernel = config.getAuthorizationKernel();
  const roles = config.getAuthorizationRoleService();
  const access = createRequestAuthorizationAccess({
    authContext: auth,
    kernel,
    propertyStore: store,
    roleAssignments: roles,
  });
  if (kernel.tenancy.mode === 'single') {
    if (auth.role !== 'admin') throw new AuthError('Forbidden', 'FORBIDDEN', 403);
  } else {
    access.requireApplicationAuthorization();
    access.requirePermission('application.users:read');
  }
  return {
    store,
    propertyService,
    auth,
    access,
    assertCurrentAuthority: captureAuthAdminMutationAuthority({
      auth,
      tokenService,
      kernel,
      store,
      roles,
      permission: 'application.users:read',
    }),
  };
}

/** Authenticate and capture the exact authority required by an admin write. */
export async function requireAdminMutationServices(
  config: AuthAdminPluginConfig,
  request: Request,
): Promise<AdminMutationServices> {
  const services = await requireAdminServices(config, request);
  const tokenService = config.getTokenService();
  if (!tokenService) throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  const kernel = config.getAuthorizationKernel();
  const roles = config.getAuthorizationRoleService();
  if (kernel.tenancy.mode === 'multi') {
    services.access.requirePermission('application.users:manage');
  }
  return {
    ...services,
    assertCurrentAuthority: captureAuthAdminMutationAuthority({
      auth: services.auth,
      tokenService,
      kernel,
      store: services.store,
      roles,
      permission: 'application.users:manage',
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
