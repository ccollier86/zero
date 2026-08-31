/** Extract a bounded Bearer credential before JWT parsing or verification. */

import { AUTH_REQUEST_LIMITS } from './auth-request-limits';

export function readAuthBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header || header.length > AUTH_REQUEST_LIMITS.token + 16) return null;
  const token = /^Bearer +([^\s]+)$/i.exec(header)?.[1];
  if (!token || token.length > AUTH_REQUEST_LIMITS.token) return null;
  return token;
}
