/** Shared session-only dependencies for Guardian API-key management routes. */

import type { AuthApiKeyService } from './auth-api-key-service';
import type { AuthApiKeyMutationAuthority } from './auth-api-key-types';
import { authAuditRequestFromRequest } from './auth-audit-service';
import { authContextAuthorityFingerprint } from './auth-context-authority';
import { extractAuthContext } from './auth-context';
import { apiKeyAuthorityChanged } from './auth-api-key-errors';
import type { TokenService } from './token-service';
import { AuthError, type AuthContext } from './types';
import type { UserStore } from './user-store';
import type { AuthorizationKernel } from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';

export interface AuthApiKeyPluginConfig {
  getApiKeyService: () => AuthApiKeyService | null;
  getUserStore: () => UserStore | null;
  getTokenService: () => TokenService | null;
  getAuthorizationKernel: () => AuthorizationKernel;
  getAuthorizationRoleService: () => AuthorizationRoleService | null;
}

export interface AuthApiKeyRouteActor {
  readonly auth: AuthContext;
  readonly service: AuthApiKeyService;
  readonly store: UserStore;
  readonly tokenService: TokenService;
  readonly kernel: AuthorizationKernel;
  readonly roles: AuthorizationRoleService | null;
}

export async function requireAuthApiKeyRouteActor(
  config: AuthApiKeyPluginConfig,
  request: Request,
): Promise<AuthApiKeyRouteActor> {
  const service = config.getApiKeyService();
  const store = config.getUserStore();
  const tokenService = config.getTokenService();
  if (!service || !store || !tokenService) {
    throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  }
  // Deliberately use TokenService directly. Guardian API-key control routes
  // never accept an API key as the credential that administers API keys.
  const auth = await extractAuthContext(request, tokenService);
  if (!auth) throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
  return Object.freeze({
    auth,
    service,
    store,
    tokenService,
    kernel: config.getAuthorizationKernel(),
    roles: config.getAuthorizationRoleService(),
  });
}

export function captureAuthApiKeyMutationAuthority(
  actor: AuthApiKeyRouteActor,
  request: Request,
): AuthApiKeyMutationAuthority {
  const reference = actor.tokenService.captureAuthContextAuthority(actor.auth);
  if (!reference) throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
  const fingerprint = authContextAuthorityFingerprint(
    actor.auth,
    actor.store.getProperties(actor.auth.userId),
  );
  return Object.freeze({
    auth: actor.auth,
    auditRequest: authAuditRequestFromRequest(request),
    assertCurrent: () => {
      const current = actor.tokenService.resolveAuthContextAuthority(reference);
      if (!current || authContextAuthorityFingerprint(
        current,
        actor.store.getProperties(current.userId),
      ) !== fingerprint) throw apiKeyAuthorityChanged();
      return current;
    },
  });
}
