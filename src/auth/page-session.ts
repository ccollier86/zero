/**
 * HttpOnly page-session cookie support for server-rendered routes.
 *
 * The cookie contains a dedicated signed page JWT bound to a persisted refresh
 * session. It is never accepted as API authentication and is never exposed to
 * browser JavaScript.
 */

import type { HTTPHeaders } from 'elysia';
import type { TokenService } from './token-service';
import type { AuthContext } from './types';

export const PAGE_SESSION_COOKIE_NAME = '__zero_page_session';

interface ResponseSet {
  headers: HTTPHeaders;
}

interface SessionResponse {
  refreshToken: string;
}

/** Resolve the page cookie only for safe methods and never over explicit credentials. */
export async function resolvePageSessionAuth(
  request: Request,
  tokenService: TokenService | null
): Promise<AuthContext | null> {
  if (!tokenService || !isSafePageMethod(request.method)) return null;

  // An explicit Authorization header is authoritative. Invalid Bearer input
  // must not silently fall back to an ambient cookie.
  if (request.headers.has('authorization')) return null;

  const token = readPageSessionCookie(request);
  return token ? tokenService.resolvePageSessionToken(token) : null;
}

/** Read the page-session value without validating or exposing it to application code. */
export function readPageSessionCookie(request: Request): string | null {
  return readCookie(request.headers.get('cookie'), PAGE_SESSION_COOKIE_NAME);
}

/** Install or clear the page cookie to mirror an auth-completion response. */
export async function syncPageSessionCookie(
  set: ResponseSet,
  request: Request,
  tokenService: TokenService,
  response: unknown,
  options: { clearWhenMissing?: boolean } = {}
): Promise<void> {
  const refreshToken = getRefreshToken(response);
  if (refreshToken) {
    await setPageSessionCookie(set, request, tokenService, refreshToken);
    return;
  }

  if (options.clearWhenMissing) {
    await revokeAndClearPageSessionCookie(set, request, tokenService);
  }
}

/** Set a persistent cookie whose lifetime matches the backing refresh session. */
export async function setPageSessionCookie(
  set: ResponseSet,
  request: Request,
  tokenService: TokenService,
  rawRefreshToken: string
): Promise<void> {
  const previousSession = readPageSessionCookie(request);
  if (previousSession) {
    await tokenService.revokePageSessionToken(previousSession);
  }

  const session = await tokenService.issuePageSessionToken(rawRefreshToken);
  if (!session) {
    clearPageSessionCookie(set, request);
    return;
  }

  const maxAge = Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 1_000));
  const parts = [
    `${PAGE_SESSION_COOKIE_NAME}=${encodeURIComponent(session.token)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    `Expires=${new Date(session.expiresAt).toUTCString()}`,
    'HttpOnly',
    'SameSite=Lax',
  ];

  if (isSecureRequest(request)) parts.push('Secure');
  appendSetCookieHeader(set, parts.join('; '));
}

/** Revoke the backing refresh session, when valid, and expire its cookie. */
export async function revokeAndClearPageSessionCookie(
  set: ResponseSet,
  request: Request,
  tokenService: TokenService
): Promise<void> {
  const session = readPageSessionCookie(request);
  if (session) {
    await tokenService.revokePageSessionToken(session);
  }
  clearPageSessionCookie(set, request);
}

/** Expire the page cookie immediately without touching unrelated cookies. */
export function clearPageSessionCookie(set: ResponseSet, request: Request): void {
  appendSetCookieHeader(set, serializeClearedPageSessionCookie(request));
}

/** Build a deletion header for raw router responses. */
export function serializeClearedPageSessionCookie(request: Request): string {
  const parts = [
    `${PAGE_SESSION_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'HttpOnly',
    'SameSite=Lax',
  ];

  if (isSecureRequest(request)) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Return a deletion header when a safe page request presented an ambient
 * credential that failed resolution. Explicit Authorization and unsafe
 * methods never attempt cookie auth, so they must not clear a valid cookie.
 */
export function rejectedPageSessionCookieHeader(
  request: Request
): string | null {
  if (!isSafePageMethod(request.method)) return null;
  if (request.headers.has('authorization')) return null;
  if (!readPageSessionCookie(request)) return null;
  return serializeClearedPageSessionCookie(request);
}

function getRefreshToken(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null;
  const token = (response as Partial<SessionResponse>).refreshToken;
  return typeof token === 'string' && token.length > 0 ? token : null;
}

function appendSetCookieHeader(set: ResponseSet, value: string): void {
  const existing = set.headers['set-cookie'];
  if (Array.isArray(existing)) {
    set.headers['set-cookie'] = [...existing, value];
  } else if (existing !== undefined) {
    set.headers['set-cookie'] = [String(existing), value];
  } else {
    set.headers['set-cookie'] = value;
  }
}

function isSafePageMethod(method: string): boolean {
  const normalized = method.toUpperCase();
  return normalized === 'GET' || normalized === 'HEAD';
}

function isSecureRequest(request: Request): boolean {
  if (new URL(request.url).protocol === 'https:') return true;
  const forwardedProto = request.headers.get('x-forwarded-proto');
  return forwardedProto?.split(',', 1)[0]?.trim().toLowerCase() === 'https';
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;

    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      // Preserve malformed input as an invalid credential so the router can
      // reject and clear it instead of leaving an undeletable stale cookie.
      return value;
    }
  }

  return null;
}
