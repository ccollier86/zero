/** Canonicalizes the public Zero app URL into its native OIDC issuer. */

import { NativeAuthError } from './errors';

export function resolveZeroNativeIssuer(serverUrl: string): string {
  try {
    const url = new URL(serverUrl.trim());
    if (url.username || url.password || url.search || url.hash
      || !['/', '/auth', '/auth/'].includes(url.pathname)
      || !isSecureZeroServer(url)) {
      throw new Error('unsafe');
    }
    return `${url.origin}/auth`;
  } catch {
    throw new NativeAuthError(
      'serverUrl must be the Zero app origin or its /auth issuer.',
      'NATIVE_SERVER_URL_INVALID',
    );
  }
}

function isSecureZeroServer(url: URL): boolean {
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}
