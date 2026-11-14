/** Security headers and tiny HTML/redirect responses for browser authorization. */

import { classifyNativeRedirectUri } from '../native/redirect-uri';

const PAGE_HEADERS = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
} as const;

export function nativeRedirect(location: string): Response {
  return new Response(null, { status: 302, headers: { ...PAGE_HEADERS, Location: location } });
}

/** Only consent passes a callback from its server-validated, registered request. */
export function nativeHtml(body: string, status = 200, consentRedirectUri?: string): Response {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Zero authorization</title></head><body>${body}</body></html>`, {
    status,
    headers: {
      ...PAGE_HEADERS,
      'Content-Security-Policy': consentRedirectUri === undefined
        ? PAGE_HEADERS['Content-Security-Policy']
        : consentPolicy(consentRedirectUri),
      // no-referrer makes Chromium send Origin: null for consent form POSTs.
      // Keep it on nativeRedirect(), especially when a callback carries a code.
      'Referrer-Policy': 'same-origin',
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
}

function consentPolicy(redirectUri: string): string {
  const kind = classifyNativeRedirectUri(redirectUri);
  if (!kind) throw new Error('Invalid native consent callback.');
  const callback = new URL(redirectUri);
  // CSP checks the POST's redirect chain too. Permit only this request's
  // private scheme or exact network origin, never every registered callback.
  // Do not interpolate paths/query values into a policy: they can contain CSP
  // delimiters, and CSP ignores path restrictions after redirects anyway.
  const source = kind === 'private-use' ? callback.protocol : callback.origin;
  return PAGE_HEADERS['Content-Security-Policy'].replace(
    "form-action 'self'", `form-action 'self' ${source}`,
  );
}

export function oauthJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
    },
  });
}

export function oauthEmpty(): Response {
  return new Response(null, {
    status: 200,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  });
}

export function appendAuthorizationResult(
  redirectUri: string,
  values: Record<string, string>
): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  return url.toString();
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}
