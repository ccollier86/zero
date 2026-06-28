/**
 * auth.middleware.ts
 *
 * Resolves per-request authentication for Elysia route plugins. This file owns
 * HTTP Authorization header parsing and request-scoped auth helpers; token
 * issuance and user persistence remain in the auth plugin services.
 */

import { Elysia } from 'elysia';
import type { TokenService } from './token-service';
import { AuthError, type AuthContext } from './types';
import type { AccessTokenPayload } from './types';

/**
 * Auth middleware — resolves `authContext` + typed helpers into global Elysia context.
 *
 * Uses `resolve` (not `derive`) so types propagate across plugin boundaries.
 * Named plugin — Elysia deduplicates by name, runs once.
 *
 * - Does NOT throw on missing/invalid tokens — sets `authContext: null`
 * - Provides `requireAuth()` and `requireAdmin()` typed helpers
 * - All consuming plugins get proper types without casts
 *
 * Mount AFTER the auth plugin (needs getTokenService() to return non-null):
 * ```ts
 * app
 *   .use(createAuthPlugin({ db }))
 *   .use(createAuthMiddleware(getTokenService))
 *   .use(createNotificationPlugin({ db }))  // gets requireAuth() typed
 * ```
 */
export function createAuthMiddleware(
  getTokenService: () => TokenService | null
) {
  return new Elysia({ name: 'auth-middleware' })
    .resolve(
      { as: 'global' },
      async ({ request }) => {
        const tokenService = getTokenService();
        let authContext: AuthContext | null = null;

        if (tokenService) {
          const header = request.headers.get('authorization');
          if (header?.startsWith('Bearer ')) {
            const token = header.slice(7);
            authContext = await resolveContext(tokenService, token);
          }
        }

        return {
          authContext,
          requireAuth(): AuthContext {
            if (!authContext) throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
            return authContext;
          },
          requireAdmin(): AuthContext {
            if (!authContext) throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
            if (authContext.role !== 'admin') throw new AuthError('Forbidden', 'FORBIDDEN', 403);
            return authContext;
          },
        };
      }
    );
}

async function resolveContext(
  tokenService: TokenService,
  token: string
): Promise<AuthContext | null> {
  if (typeof tokenService.resolveAuthContext === 'function') {
    return tokenService.resolveAuthContext(token);
  }

  const payload = await tokenService.verifyAccessToken(token) as AccessTokenPayload | null;
  if (!payload) return null;
  return { userId: payload.sub, email: payload.email, role: payload.role };
}
