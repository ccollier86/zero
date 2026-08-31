/** Focused browser-route helpers kept outside the Elysia controller. */

import { NativeAuthorizationError } from '../native';
import { readPageSessionCookie } from '../page-session';
import type { NativeAuthorizationService } from './native-authorization-service';
import { escapeHtml, nativeHtml } from './native-http';
import type { NativeAuthHttpConfig } from './native-plugin-types';

export function requireNativeService(config: NativeAuthHttpConfig): NativeAuthorizationService {
  const service = config.getService();
  if (!service) throw new Error('Native authentication is not ready.');
  return service;
}

export async function resolveNativePagePost(request: Request, config: NativeAuthHttpConfig) {
  const raw = readPageSessionCookie(request);
  const tokens = config.getTokenService();
  return raw && tokens ? tokens.resolvePageSessionToken(raw) : null;
}

export function authorizationProblem(message: string): Response {
  return nativeHtml(`<main><h1>Authorization unavailable</h1><p>${escapeHtml(message)}</p></main>`, 400);
}

export function authContinuationPath(
  path: string,
  redirect: string,
  loginHint?: string | null,
): string {
  const url = new URL(path, 'https://zero.invalid');
  url.searchParams.set('redirect', redirect);
  if (loginHint && loginHint.length <= 254 && !/[\u0000-\u001f\u007f]/.test(loginHint)) {
    url.searchParams.set('login_hint', loginHint);
  }
  return `${url.pathname}${url.search}`;
}

export function singleQueryValue(params: URLSearchParams, name: string): string | null {
  const values = params.getAll(name);
  return values.length === 1 && values[0] ? values[0] : null;
}
