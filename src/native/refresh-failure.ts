/** Distinguishes retryable refresh outages from terminal session failures. */

import { NativeAuthError } from './errors';

const RETRYABLE_CODES = new Set([
  'OIDC_TOKEN_SERVER_ERROR',
  'OIDC_TOKEN_TEMPORARILY_UNAVAILABLE',
  'OIDC_REFRESH_FAILED',
]);

const TERMINAL_CODES = new Set([
  'OIDC_REFRESH_ROTATION_MISSING',
  'OIDC_TOKEN_RESPONSE_INVALID',
  'OIDC_TOKEN_INVALID_GRANT',
  'OIDC_TOKEN_INVALID_CLIENT',
  'OIDC_TOKEN_UNAUTHORIZED_CLIENT',
]);

export function shouldDiscardRefreshSession(
  error: NativeAuthError,
  responseAccepted: boolean,
): boolean {
  if (responseAccepted || TERMINAL_CODES.has(error.code)) return true;
  if (RETRYABLE_CODES.has(error.code)) return false;
  if (error.status === undefined || error.status >= 500
    || error.status === 408 || error.status === 429) return false;
  return error.status >= 400;
}
