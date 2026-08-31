const LOCAL_HTTP_ISSUER =
  /^http:\/\/(127\.0\.0\.1|\[::1\]|localhost)(?::\d+)?(?:\/|$)/;

export function isValidNativeIssuer(value: string): boolean {
  if (!value || value !== value.trim() || value.includes('?') || value.includes('#')) {
    return false;
  }
  try {
    const url = new URL(value);
    if (url.username || url.password || !['/', '/auth', '/auth/'].includes(url.pathname)) {
      return false;
    }
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && LOCAL_HTTP_ISSUER.test(value);
  } catch {
    return false;
  }
}

export function assertNativeIssuer(value: string): string {
  if (!isValidNativeIssuer(value)) {
    throw new Error(
      '[native-auth] issuer must use HTTPS (or loopback HTTP) and Zero\'s /auth path.'
    );
  }
  const url = new URL(value);
  return `${url.origin}/auth`;
}
