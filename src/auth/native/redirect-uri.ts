import { isIP } from 'node:net';
import { hasSafeNativeRedirectQuery } from './redirect-query';
import type { NativeRedirectKind } from './types';

const LOOPBACK = /^http:\/\/(127\.0\.0\.1|\[::1\])(?::(\d+))?(?=\/|\?|$)/;
const PRIVATE_SCHEME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
const DNS_NAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const UNSAFE_URL_CHARACTER = /[\\\u0000-\u001f\u007f]/;

export function classifyNativeRedirectUri(
  value: string
): NativeRedirectKind | null {
  if (value.length > 2_048 || value !== value.trim() || UNSAFE_URL_CHARACTER.test(value)) {
    return null;
  }
  const url = parseSafe(value);
  if (!url) return null;
  if (!hasSafeNativeRedirectQuery(value, url)) return null;
  if (isLoopback(value, url)) return 'loopback';
  if (isClaimedHttps(value, url)) return 'claimed-https';
  if (isPrivateUse(value, url)) return 'private-use';
  return null;
}

export function assertNativeRedirectUri(value: string): NativeRedirectKind {
  const kind = classifyNativeRedirectUri(value);
  if (!kind) throw new Error(`[native-auth] Invalid native redirect URI: ${value}`);
  return kind;
}

export function matchesRegisteredNativeRedirectUri(
  requestedUri: string,
  registeredUri: string
): boolean {
  const requestedKind = classifyNativeRedirectUri(requestedUri);
  const registeredKind = classifyNativeRedirectUri(registeredUri);
  if (!requestedKind || requestedKind !== registeredKind) return false;
  if (requestedKind !== 'loopback') return requestedUri === registeredUri;
  return withoutLoopbackPort(requestedUri) === withoutLoopbackPort(registeredUri);
}

export function findRegisteredNativeRedirectUri(
  requestedUri: string,
  registeredUris: readonly string[]
): string | null {
  return registeredUris.find((uri) =>
    matchesRegisteredNativeRedirectUri(requestedUri, uri)) ?? null;
}

function parseSafe(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function hasSafeAuthority(url: URL): boolean {
  return !url.username && !url.password;
}

function isLoopback(value: string, url: URL): boolean {
  const match = LOOPBACK.exec(value);
  if (!match || url.protocol !== 'http:' || !hasSafeAuthority(url)) return false;
  const port = match[2] === undefined ? undefined : Number(match[2]);
  return port === undefined || (port >= 1 && port <= 65_535);
}

function isClaimedHttps(value: string, url: URL): boolean {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  return value.startsWith('https://') && url.protocol === 'https:'
    && hasSafeAuthority(url) && DNS_NAME.test(host) && isIP(host) === 0;
}

function isPrivateUse(value: string, url: URL): boolean {
  const scheme = value.slice(0, value.indexOf(':'));
  return PRIVATE_SCHEME.test(scheme) && value.startsWith(`${scheme}:/`)
    && !value.startsWith(`${scheme}://`) && !url.host;
}

function withoutLoopbackPort(value: string): string {
  return value.replace(LOOPBACK, 'http://$1');
}
