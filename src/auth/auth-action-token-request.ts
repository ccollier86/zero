/** Privacy-preserving helpers for public one-time-token requests. */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { AuthActionTokenService } from './action-token-service';
import { AuthError } from './types';

export function createActionTokenOrHideCooldown(
  create: () => ReturnType<AuthActionTokenService['create']>
): ReturnType<AuthActionTokenService['create']> | null {
  try {
    return create();
  } catch (error) {
    if (error instanceof AuthError && error.code === 'ACTION_TOKEN_COOLDOWN') return null;
    throw error;
  }
}

export type PasswordResetSuppressionReason =
  | 'account_not_found'
  | 'account_suspended'
  | 'account_not_eligible'
  | 'policy_disabled'
  | 'cooldown';

export function emitPasswordResetSuppressed(
  reason: PasswordResetSuppressionReason,
  userId?: string
): void {
  emitPlatformCode(OBS_CODES.AUTH_PASSWORD_RESET_SUPPRESSED, {
    userId,
    metadata: { reason },
  });
}
