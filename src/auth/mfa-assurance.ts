/** Canonical validation for server-owned durable MFA assurance timestamps. */

import { AuthError } from './types';

export function normalizeMfaVerifiedAt(
  value: number | null | undefined,
  now = Date.now(),
): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > now) {
    throw new AuthError('MFA assurance is invalid', 'AUTH_SESSION_INVALID', 500);
  }
  return value;
}
