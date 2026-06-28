/**
 * password-action-policy.ts
 *
 * Resolves password action form mode from inspected auth tokens. This file
 * owns frontend token-to-action decisions only; the backend remains responsible
 * for validating and consuming action tokens.
 */

import type { AuthActionTokenInfo } from '../../frontend/client/auth-client';
import type { PasswordActionFormProps } from './password-action-form';

export type PasswordAction = 'reset' | 'setup';

/** Infer the form action represented by a valid backend action token. */
export function inferPasswordActionFromToken(
  tokenInfo: AuthActionTokenInfo | null,
): PasswordAction | null {
  if (!tokenInfo?.valid) return null;
  if (tokenInfo.type === 'account_setup') return 'setup';
  if (tokenInfo.type === 'password_reset' || tokenInfo.type === 'admin_password_reset') {
    return 'reset';
  }
  return null;
}

/** Resolve the effective form action, blocking invalid or mismatched tokens. */
export function resolvePasswordAction(
  mode: PasswordActionFormProps['mode'],
  tokenInfo: AuthActionTokenInfo | null,
): PasswordAction | null {
  const inferred = inferPasswordActionFromToken(tokenInfo);
  if (!inferred) return null;
  if (mode === 'auto') return inferred;
  return mode === inferred ? mode : null;
}

/** Return true when an explicit form mode does not match a valid token. */
export function isPasswordActionModeMismatch(
  mode: PasswordActionFormProps['mode'],
  tokenInfo: AuthActionTokenInfo | null,
): boolean {
  if (!tokenInfo?.valid || mode === 'auto') return false;
  return resolvePasswordAction(mode, tokenInfo) === null;
}
