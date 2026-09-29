/** Credential-free commit proof for a live authenticated session identity. */

import type { TokenService } from './token-service';
import { AuthError, type AuthContext } from './types';

export interface AuthSessionIdentityAdmission {
  /** Exact security generation carried by the admitted live session. */
  readonly authGeneration: number;
  /** Revalidate the same credential-free session authority at commit time. */
  readonly consume: () => boolean;
}

/**
 * Capture the exact live session family without retaining its bearer token.
 * The returned callback is safe to execute inside a later SQLite transaction
 * and fails after revocation, expiry, account changes, or scope changes.
 */
export function captureAuthSessionIdentityProof(
  auth: AuthContext,
  tokenService: TokenService,
): () => boolean {
  return captureAuthSessionIdentityAdmission(auth, tokenService).consume;
}

/** Capture both the commit callback and the generation proven by that callback. */
export function captureAuthSessionIdentityAdmission(
  auth: AuthContext,
  tokenService: TokenService,
): AuthSessionIdentityAdmission {
  const reference = tokenService.captureAuthContextAuthority(auth);
  if (!reference) {
    throw new AuthError(
      'Authenticated session authority is unavailable',
      'UNAUTHORIZED',
      401,
    );
  }
  return Object.freeze({
    authGeneration: reference.authGeneration,
    consume: () => tokenService.resolveAuthContextAuthority(reference) !== null,
  });
}
