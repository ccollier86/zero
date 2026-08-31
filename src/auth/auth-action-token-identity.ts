/**
 * auth-action-token-identity.ts
 *
 * Binds action tokens to current account identity/security state without
 * storing the email address in token metadata.
 */

import { hashToken } from '../tokens/token-utils';
import { AuthError, type UserRecord } from './types';

const EMAIL_IDENTITY_KEY = 'authEmailIdentity';
const AUTH_GENERATION_KEY = 'authGeneration';
const SECURITY_TRANSITION_KEY = 'authSecurityTransition';

/** Add non-overridable email/generation bindings to persisted token metadata. */
export function bindActionTokenIdentity(
  user: UserRecord,
  authGeneration: number,
  afterSecurityTransition: boolean,
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> {
  return {
    ...metadata,
    [EMAIL_IDENTITY_KEY]: hashToken(user.email),
    [AUTH_GENERATION_KEY]: authGeneration + (afterSecurityTransition ? 1 : 0),
    [SECURITY_TRANSITION_KEY]: afterSecurityTransition,
  };
}

/** Reject unbound tokens or tokens that crossed an unauthorized transition. */
export function assertActionTokenIdentity(
  user: UserRecord,
  authGeneration: number,
  metadata: Record<string, unknown>
): void {
  const email = metadata[EMAIL_IDENTITY_KEY];
  const generation = metadata[AUTH_GENERATION_KEY];
  const identityMatches = typeof email === 'string' && email === hashToken(user.email);
  const generationMatches = generation === authGeneration;
  const transitionStateMatches = metadata[SECURITY_TRANSITION_KEY] !== true
    || user.passwordChangeRequired;
  if (identityMatches && generationMatches && transitionStateMatches) return;
  throw new AuthError('Action token is invalid', 'ACTION_TOKEN_INVALID', 400);
}
