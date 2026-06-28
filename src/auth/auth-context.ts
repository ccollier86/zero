/**
 * auth-context.ts
 *
 * Resolves AuthContext from HTTP requests using the token service. This file
 * owns request-token extraction only; it does not issue tokens, mutate users,
 * or register Elysia routes.
 */

import type { TokenService } from './token-service';
import type { AccessTokenPayload, AuthContext } from './types';

/**
 * Extract auth context from a request's Authorization header.
 *
 * Returns null when the header is missing, malformed, expired, invalid, or the
 * user account is no longer allowed to authenticate.
 */
export async function extractAuthContext(
  request: Request,
  tokenService: TokenService
): Promise<AuthContext | null> {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;

  const token = header.slice(7);
  if (typeof tokenService.resolveAuthContext === 'function') {
    return tokenService.resolveAuthContext(token);
  }

  const payload = await tokenService.verifyAccessToken(token) as AccessTokenPayload | null;
  if (!payload) return null;
  return { userId: payload.sub, email: payload.email, role: payload.role };
}
