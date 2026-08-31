/** Native redirect checks mirrored from the Zero provider registration policy. */

import { NativeAuthError } from './errors';

const LOOPBACK = /^http:\/\/(127\.0\.0\.1|\[::1\])(?::(\d+))?(?=\/|\?|$)/;
const PRIVATE_SCHEME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
const DNS_NAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const RESERVED = new Set(['code', 'error', 'error_description', 'error_uri', 'state', 'iss']);

/** Allow only redirect shapes the Zero server can register exactly. */
export function assertNativeRedirectUri(value: string): void {
  const url = parse(value);
  if (!url || value.length > 2_048 || value !== value.trim()
    || /[\\\u0000-\u001f\u007f]/.test(value)
    || url.hash || url.username || url.password || !safeQuery(value, url)) {
    throw invalid();
  }
  if (loopback(value, url) || claimedHttps(value, url) || privateUse(value, url)) return;
  throw invalid();
}

function parse(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function loopback(value: string, url: URL): boolean {
  const match = LOOPBACK.exec(value);
  if (!match || url.protocol !== 'http:') return false;
  const port = match[2] === undefined ? undefined : Number(match[2]);
  return port === undefined || (port >= 1 && port <= 65_535);
}

function claimedHttps(value: string, url: URL): boolean {
  return value.startsWith('https://') && url.protocol === 'https:'
    && DNS_NAME.test(url.hostname) && !isIpv4(url.hostname);
}

function isIpv4(host: string): boolean {
  const parts = host.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part)
    && String(Number(part)) === part && Number(part) <= 255);
}

function privateUse(value: string, url: URL): boolean {
  const scheme = value.slice(0, value.indexOf(':'));
  return PRIVATE_SCHEME.test(scheme) && value.startsWith(`${scheme}:/`)
    && !value.startsWith(`${scheme}://`) && !url.host;
}

function safeQuery(value: string, url: URL): boolean {
  if (value.endsWith('?')) return false;
  const seen = new Set<string>();
  for (const [key] of url.searchParams) {
    if (seen.has(key) || RESERVED.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function invalid(): NativeAuthError {
  return new NativeAuthError(
    'Native redirect URI must be registered claimed HTTPS, IP loopback, or reverse-domain private-use.',
    'OIDC_REDIRECT_URI_INVALID',
  );
}
