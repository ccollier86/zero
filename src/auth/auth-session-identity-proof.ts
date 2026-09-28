/** Credential-free commit proof for a live authenticated session identity. */

import type { TokenService } from './token-service';
import { AuthError, type AuthContext } from './types';

/**
 * Capture the exact live session family without retaining its bearer token.
 * The returned callback is safe to execute inside a later SQLite transaction
 * and fails after revocation, expiry, account changes, or scope changes.
 */
export function captureAuthSessionIdentityProof(
  auth: AuthContext,
  tokenService: TokenService,
): () => boolean {
  const reference = tokenService.captureAuthContextAuthority(auth);
  if (!reference) {
    throw new AuthError(
      'Authenticated session authority is unavailable',
      'UNAUTHORIZED',
      401,
    );
  }
  return () => tokenService.resolveAuthContextAuthority(reference) !== null;
}
