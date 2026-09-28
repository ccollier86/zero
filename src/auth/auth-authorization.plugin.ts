/** Current-user browser authorization projection. */

import { Elysia } from 'elysia';
import { extractAuthContext } from './auth-context';
import { createAuthAuthorizationSnapshot } from './auth-authorization-snapshot';
import { createRequestAuthorizationAccess } from './authorization-access';
import type { AuthorizationKernel } from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import { applyAuthPrivateNoStore } from './auth-response-cache';
import type { TokenService } from './token-service';
import { AuthError } from './types';
import type { UserStore } from './user-store';

export interface AuthAuthorizationPluginConfig {
  getUserStore: () => UserStore | null;
  getTokenService: () => TokenService | null;
  getAuthorizationKernel: () => AuthorizationKernel;
  getAuthorizationRoleService: () => AuthorizationRoleService | null;
}

/**
 * Mount below `/auth`. Every request rehydrates durable session authority and
 * expands retained role assignments; the response never trusts JWT role/scope
 * claims and never returns authentication proof or policy properties.
 */
export function createAuthAuthorizationPlugin(config: AuthAuthorizationPluginConfig) {
  return new Elysia({ name: 'auth-current-authorization' })
    .get('/authorization', async ({ request, set }) => {
      applyAuthPrivateNoStore(set);
      const store = config.getUserStore();
      const tokenService = config.getTokenService();
      if (!store || !tokenService) {
        throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
      }

      const auth = await extractAuthContext(request, tokenService);
      if (!auth) throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);

      const kernel = config.getAuthorizationKernel();
      const access = createRequestAuthorizationAccess({
        authContext: auth,
        kernel,
        // Properties are deliberately unavailable to this projection: browser
        // permission hints must not disclose server-trusted policy attributes.
        roleAssignments: config.getAuthorizationRoleService(),
      });
      return createAuthAuthorizationSnapshot(auth, kernel, access);
    });
}
