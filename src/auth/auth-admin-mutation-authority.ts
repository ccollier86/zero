/** Commit-boundary authority for platform-administrator mutations. */

import type { TokenService } from './token-service';
import { AuthError, type AuthContext } from './types';

/**
 * Re-resolve the exact request session immediately before an administrator
 * control-plane write. The callback retains no bearer credential.
 */
export type AssertAuthAdminMutationAuthority = () => AuthContext;

/**
 * Capture a secret-free reference to the authenticated administrator session.
 * Session revocation/expiry and every account or scope revision fail closed.
 */
export function captureAuthAdminMutationAuthority(input: {
  auth: AuthContext;
  tokenService: TokenService;
}): AssertAuthAdminMutationAuthority {
  const reference = input.tokenService.captureAuthContextAuthority(input.auth);
  if (!reference) throw staleAdminAuthority();

  return () => {
    const current = input.tokenService.resolveAuthContextAuthority(reference);
    if (!current || current.role !== 'admin') throw staleAdminAuthority();
    return current;
  };
}

function staleAdminAuthority(): AuthError {
  return new AuthError(
    'Administrator authorization changed before the operation could commit',
    'AUTHORIZATION_CHANGED',
    409,
  );
}
