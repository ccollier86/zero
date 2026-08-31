/** Resolve app/plugin config into the strict runtime values used by OIDC. */

import { parseTokenTTL } from '../../tokens/token-utils';
import { assertNativeIssuer } from '../native';
import type { AuthPluginConfig, ResolvedAuthBehaviorConfig } from '../types';

export interface NativeRuntimeConfig {
  issuer: string;
  audience: string;
  loginPath: string;
  registrationPath: string;
  requestTtlMs: number;
  codeTtlMs: number;
  refreshTtlMs: number;
}

export function resolveNativeRuntimeConfig(
  plugin: AuthPluginConfig,
  auth: ResolvedAuthBehaviorConfig
): NativeRuntimeConfig | null {
  if (!auth.nativeApps.enabled) return null;
  if (auth.nativeApps.clients.length === 0) {
    throw new Error('[native-auth] At least one registered client is required.');
  }
  const configuredIssuer = plugin.nativeIssuer ?? auth.nativeApps.issuer;
  if (!configuredIssuer) {
    throw new Error('[native-auth] A canonical issuer or app.publicUrl is required.');
  }
  const issuer = assertNativeIssuer(configuredIssuer);
  const audience = withoutTrailingSlash(plugin.nativeAudience ?? new URL(issuer).origin)!;
  assertAbsoluteUrl(audience, 'audience');
  if (new URL(audience).origin !== new URL(issuer).origin) {
    throw new Error(
      '[native-auth] issuer and audience must share an origin. Split-origin native auth is not supported.'
    );
  }
  return {
    issuer,
    audience,
    loginPath: safeLocalPath(plugin.loginPath ?? '/login', 'loginPath'),
    registrationPath: safeLocalPath(plugin.registrationPath ?? '/register', 'registrationPath'),
    requestTtlMs: parseTokenTTL(auth.nativeApps.requestTTL, 'native request TTL'),
    codeTtlMs: parseTokenTTL(auth.nativeApps.codeTTL, 'native code TTL'),
    refreshTtlMs: parseTokenTTL(auth.nativeApps.refreshTokenTTL, 'native refresh TTL'),
  };
}

function safeLocalPath(path: string, label: string): string {
  if (
    path !== path.trim()
    || !path.startsWith('/')
    || path.startsWith('//')
    || /[\\\u0000-\u001f\u007f]/.test(path)
  ) {
    throw new Error(`[native-auth] ${label} must be an absolute local path.`);
  }
  return path;
}

function withoutTrailingSlash(value: string | undefined): string | undefined {
  return value?.replace(/\/+$/, '');
}

function assertAbsoluteUrl(value: string, label: string): void {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error(`[native-auth] ${label} must use HTTPS outside loopback development.`);
  }
  if (url.hash || url.search || url.username || url.password) {
    throw new Error(`[native-auth] ${label} contains unsafe URL components.`);
  }
  if (label === 'audience' && url.pathname !== '/') {
    throw new Error('[native-auth] audience must be a canonical origin without a path.');
  }
}
