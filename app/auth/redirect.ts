/**
 * redirect.ts
 *
 * Shared auth-page redirect helper. This file owns browser redirect parsing
 * only; route guards and token lifecycle remain in Zero auth.
 */

import { normalizeAbsoluteLocalPath } from '@zero/framework/react';

/** Return a local redirect target from the current URL, or the fallback path. */
export function getSafeAuthRedirect(fallback = '/'): string {
  if (typeof window === 'undefined') return fallback;

  const values = new URL(window.location.href).searchParams.getAll('redirect');
  const redirect = values.length === 1 ? values[0] : null;
  return resolveSafeAuthRedirect(redirect, window.location.origin, fallback);
}

/** Normalize a same-origin absolute-path redirect without browser backslash ambiguity. */
export function resolveSafeAuthRedirect(
  redirect: string | null,
  _origin: string,
  fallback = '/',
): string {
  const safeFallback = normalizeAbsoluteLocalPath(fallback) ?? '/';
  return normalizeAbsoluteLocalPath(redirect) ?? safeFallback;
}
