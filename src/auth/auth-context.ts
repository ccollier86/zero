/**
 * auth-context.ts
 *
 * Resolves AuthContext from HTTP requests using the token service. This file
 * owns request-token extraction only; it does not issue tokens, mutate users,
 * or register Elysia routes.
 */

import type { TokenService } from './token-service';
import type { AccessTokenPayload, AuthContext } from './types';
import { readAuthBearerToken } from './auth-bearer-token';

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
  const token = readAuthBearerToken(request);
  if (!token) return null;
  if (typeof tokenService.resolveAuthContext === 'function') {
    return tokenService.resolveAuthContext(token);
  }

  const payload = await tokenService.verifyAccessToken(token) as AccessTokenPayload | null;
  if (!payload || typeof payload.email !== 'string' || typeof payload.role !== 'string') return null;
  return { userId: payload.sub, email: payload.email, role: payload.role };
}
