'use client';

import * as React from 'react';

const DEFAULT_LOGIN_HREF = '/login';
const LOCAL_URL_BASE = 'https://zero.local';
const MAX_RETURN_TO_LENGTH = 8_192;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Build a same-origin login URL which returns to the current local page.
 *
 * Existing login query parameters are retained and an existing `redirect`
 * parameter wins. Unsafe or ambiguous current URLs are ignored, leaving the
 * validated login URL without a generated continuation.
 */
export function buildLocalReturnToHref(
  loginHref: string,
  currentHref?: string,
  expectedOrigin = LOCAL_URL_BASE,
): string {
  const origin = normalizeOrigin(expectedOrigin) ?? LOCAL_URL_BASE;
  const safeLoginHref = normalizeLocalLoginHref(loginHref, origin)
    ?? DEFAULT_LOGIN_HREF;
  if (!currentHref || currentHref.length > MAX_RETURN_TO_LENGTH) {
    return safeLoginHref;
  }
  const login = new URL(safeLoginHref, origin);
  if (login.searchParams.has('redirect')) return safeLoginHref;
  const returnTo = normalizeSameOriginReturnTo(currentHref, origin);
  if (!returnTo || returnTo.pathname === login.pathname) return safeLoginHref;
  return appendQueryParameter(
    safeLoginHref,
    'redirect',
    `${returnTo.pathname}${returnTo.search}${returnTo.hash}`,
  );
}

/** Preserve explicit host routing; generate a return path only when omitted. */
export function resolveLocalReturnToHref(
  explicitHref: string | undefined,
  currentHref?: string,
  expectedOrigin = LOCAL_URL_BASE,
  loginHref = DEFAULT_LOGIN_HREF,
): string {
  return explicitHref !== undefined
    ? explicitHref
    : buildLocalReturnToHref(loginHref, currentHref, expectedOrigin);
}

/**
 * SSR-safe local login continuation for public tenant onboarding surfaces.
 *
 * The server and hydration render use the plain login route. After mount, an
 * omitted override gains the validated current pathname, search, and hash.
 * Explicit host-provided hrefs are returned byte-for-byte, including custom
 * routers and intentional external identity-provider URLs.
 */
export function useLocalReturnToHref(
  explicitHref?: string,
  loginHref = DEFAULT_LOGIN_HREF,
): string {
  const [generatedHref, setGeneratedHref] = React.useState(() => (
    buildLocalReturnToHref(loginHref)
  ));

  React.useEffect(() => {
    if (explicitHref !== undefined || typeof window === 'undefined') return;
    setGeneratedHref(buildLocalReturnToHref(
      loginHref,
      window.location.href,
      window.location.origin,
    ));
  }, [explicitHref, loginHref]);

  return explicitHref !== undefined ? explicitHref : generatedHref;
}

function normalizeOrigin(value: string): string | null {
  if (hasUnsafeCharacters(value)) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function normalizeLocalLoginHref(value: string, origin: string): string | null {
  if (!isUnambiguousLocalHref(value)) return null;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || !isSafeDecodedPathname(url.pathname)) return null;
    return value;
  } catch {
    return null;
  }
}

function normalizeSameOriginReturnTo(
  value: string,
  origin: string,
): URL | null {
  if (hasUnsafeCharacters(value) || value.startsWith('//')) return null;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin
      || url.username
      || url.password
      || !isSafeDecodedPathname(url.pathname)
      || !isSafeDecodedReturnTo(url)) return null;
    return url;
  } catch {
    return null;
  }
}

function isSafeDecodedReturnTo(url: URL): boolean {
  try {
    return !hasUnsafeCharacters(decodeURIComponent(
      `${url.pathname}${url.search}${url.hash}`,
    ));
  } catch {
    return false;
  }
}

function isUnambiguousLocalHref(value: string): boolean {
  return value.startsWith('/')
    && !value.startsWith('//')
    && !hasUnsafeCharacters(value);
}

function hasUnsafeCharacters(value: string): boolean {
  return CONTROL_CHARACTERS.test(value) || value.includes('\\');
}

function isSafeDecodedPathname(pathname: string): boolean {
  try {
    const decoded = decodeURIComponent(pathname);
    return decoded.startsWith('/')
      && !decoded.startsWith('//')
      && !hasUnsafeCharacters(decoded);
  } catch {
    return false;
  }
}

function appendQueryParameter(
  href: string,
  key: string,
  value: string,
): string {
  const hashIndex = href.indexOf('#');
  const beforeHash = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : href.slice(hashIndex);
  const separator = beforeHash.includes('?')
    ? beforeHash.endsWith('?') || beforeHash.endsWith('&') ? '' : '&'
    : '?';
  return `${beforeHash}${separator}${key}=${encodeURIComponent(value)}${hash}`;
}
