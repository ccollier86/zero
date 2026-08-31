/** Current-user and session signing-key routes. */

import { Elysia } from 'elysia';
import { extractAuthContext } from './auth-context';
import {
  requireSessionServices,
  requireSessionTokenService,
  type AuthSessionPluginConfig,
} from './auth-session-dependencies';
import { toAuthUserResponse } from './auth-user-response';
import { AuthError } from './types';

export function createAuthCurrentUserPlugin(config: AuthSessionPluginConfig) {
  return new Elysia({ name: 'auth-current-user' })
    .get('/me', async ({ request }) => {
      const { store, tokenService, propertyService } = requireSessionServices(config);
      const auth = await extractAuthContext(request, tokenService);
      if (!auth) throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);

      const user = store.getUserById(auth.userId);
      if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
      propertyService.applyMissingDefaults(user.userId, store);
      return toAuthUserResponse(store.getUserById(user.userId)!);
    })
    .get('/jwks', () => requireSessionTokenService(config).getJWKS());
}
