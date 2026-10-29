/** Exact bootstrap/recovery exemptions, not a blanket auth-route or API bypass. */
const RECOVERY = new Set([
  '/api/health', '/api/_zero/logging/health', '/api/_zero/logging/policy', '/api/_zero/logging/observations',
  '/auth/login', '/auth/register', '/auth/refresh', '/auth/logout', '/auth/config', '/auth/me', '/auth/authorization',
  '/auth/forgot-password', '/auth/reset-password', '/auth/setup-password', '/auth/verify-email',
  '/auth/mfa/challenge/verify', '/auth/mfa/methods', '/auth/mfa/setup', '/auth/mfa/setup/verify', '/auth/jwks',
]);
export function isLoggingRecoveryRequest(request: Request): boolean {
  const path = new URL(request.url).pathname;
  return RECOVERY.has(path) || path === '/sync';
}
