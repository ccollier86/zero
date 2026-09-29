import type { AuthError } from './types';

const AUTH_SERVICE_UNAVAILABLE_MESSAGE = 'Authentication service unavailable';

/**
 * Preserve actionable client errors while keeping internal 5xx diagnostics
 * inside Zero's observability boundary.
 */
export function getPublicAuthErrorMessage(error: AuthError): string {
  return error.status >= 500 ? AUTH_SERVICE_UNAVAILABLE_MESSAGE : error.message;
}
