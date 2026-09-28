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
 * Auth routes and app-global middleware can both inspect the same Request.
 * Share one durable token hydration per app-local TokenService so nested
 * Elysia plugins do not repeat session/user/tenant reads or observe two
 * different authority snapshots during a single request.
 */
const requestAuthResolutions = new WeakMap<
  Request,
  Map<TokenService, Promise<AuthContext | null>>
>();

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
  let byService = requestAuthResolutions.get(request);
  if (!byService) {
    byService = new Map();
    requestAuthResolutions.set(request, byService);
  }
  const existing = byService.get(tokenService);
  if (existing) return existing;

  const token = readAuthBearerToken(request);
  const resolution = token
    ? resolveTokenContext(tokenService, token)
    : Promise.resolve(null);
  byService.set(tokenService, resolution);
  return resolution;
}

async function resolveTokenContext(
  tokenService: TokenService,
  token: string,
): Promise<AuthContext | null> {
  if (typeof tokenService.resolveAuthContext === 'function') {
    return tokenService.resolveAuthContext(token);
  }

  const payload = await tokenService.verifyAccessToken(token) as AccessTokenPayload | null;
  if (!payload || typeof payload.email !== 'string' || typeof payload.role !== 'string') return null;
  return { userId: payload.sub, email: payload.email, role: payload.role };
}
