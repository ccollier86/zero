/**
 * redirect.ts
 *
 * Shared auth-page redirect helper. This file owns browser redirect parsing
 * only; route guards and token lifecycle remain in Zero auth.
 */

/** Return a local redirect target from the current URL, or the fallback path. */
export function getSafeAuthRedirect(fallback = '/'): string {
  if (typeof window === 'undefined') return fallback;

  const redirect = new URL(window.location.href).searchParams.get('redirect');
  return resolveSafeAuthRedirect(redirect, window.location.origin, fallback);
}

/** Normalize a same-origin absolute-path redirect without browser backslash ambiguity. */
export function resolveSafeAuthRedirect(
  redirect: string | null,
  origin: string,
  fallback = '/',
): string {
  if (!redirect || redirect !== redirect.trim() || /[\\\u0000-\u001f\u007f]/.test(redirect)) {
    return fallback;
  }
  try {
    const target = new URL(redirect, origin);
    return target.origin === origin && redirect.startsWith('/')
      ? `${target.pathname}${target.search}${target.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}
