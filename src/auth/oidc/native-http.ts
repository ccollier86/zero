/** Security headers and tiny HTML/redirect responses for browser authorization. */

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

export function nativeHtml(body: string, status = 200): Response {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Zero authorization</title></head><body>${body}</body></html>`, {
    status,
    headers: { ...PAGE_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
  });
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
