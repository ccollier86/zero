/** Native SDK option validation and runtime dependency resolution. */

import type { NativeCryptoAdapter, NativeFetch } from './adapter-types';
import type { NativeAuthClientOptions, NativeIdentityScope } from './client-types';
import { createWebCryptoAdapter } from './crypto';
import { NativeAuthError } from './errors';
import { resolveNativeStorageNamespace } from './storage-namespace';
import { assertNativeRuntimeCapabilities } from './runtime-capabilities';

export interface ResolvedNativeAuthConfig extends NativeAuthClientOptions {
  issuer: string;
  fetch: NativeFetch;
  crypto: NativeCryptoAdapter;
  scopes: NativeIdentityScope[];
  storageNamespace: string;
  authorizationTimeoutMs: number;
  networkTimeoutMs: number;
  clockSkewSeconds: number;
  now: () => number;
}

const IDENTITY_SCOPES = new Set<NativeIdentityScope>(['openid', 'profile', 'email', 'phone', 'profile:write', 'contacts:write']);

/** Resolve secure defaults without supplying any platform-sensitive adapters. */
export function resolveNativeAuthConfig(
  options: NativeAuthClientOptions,
): ResolvedNativeAuthConfig {
  const issuer = normalizeIssuer(options.issuer);
  const fetcher = options.fetch ?? globalThis.fetch?.bind(globalThis);
  if (!fetcher) {
    throw new NativeAuthError('A native fetch adapter is required.', 'NATIVE_FETCH_UNAVAILABLE');
  }
  assertNativeRuntimeCapabilities();
  if (!/^[A-Za-z0-9._~-]{1,128}$/.test(options.clientId)) {
    throw new NativeAuthError('clientId is malformed.', 'NATIVE_CLIENT_ID_INVALID');
  }
  if (options.authorizationTimeoutMs !== undefined
    && (!Number.isFinite(options.authorizationTimeoutMs) || options.authorizationTimeoutMs <= 0)) {
    throw new NativeAuthError('authorizationTimeoutMs must be positive.', 'NATIVE_TIMEOUT_INVALID');
  }
  if (options.networkTimeoutMs !== undefined
    && (!Number.isFinite(options.networkTimeoutMs) || options.networkTimeoutMs <= 0)) {
    throw new NativeAuthError('networkTimeoutMs must be positive.', 'NATIVE_TIMEOUT_INVALID');
  }
  if (options.clockSkewSeconds !== undefined
    && (!Number.isFinite(options.clockSkewSeconds) || options.clockSkewSeconds < 0
      || options.clockSkewSeconds > 300)) {
    throw new NativeAuthError('clockSkewSeconds must be between 0 and 300.', 'NATIVE_CLOCK_SKEW_INVALID');
  }

  const requestedScopes = options.scopes ?? ['profile', 'email'];
  if (requestedScopes.some((scope) => !IDENTITY_SCOPES.has(scope))) {
    throw new NativeAuthError(
      'Only declared Zero identity and own-account scopes are supported.',
      'NATIVE_SCOPES_UNSUPPORTED',
    );
  }
  const scopes = [...new Set<NativeIdentityScope>(['openid', ...requestedScopes])];
  return {
    ...options,
    issuer,
    clientId: options.clientId.trim(),
    fetch: fetcher,
    crypto: options.crypto ?? createWebCryptoAdapter(),
    scopes,
    storageNamespace: resolveNativeStorageNamespace(
      options.storageNamespace,
      `zero.native.${encodeURIComponent(issuer)}.${encodeURIComponent(options.clientId.trim())}`,
    ),
    // Match the provider's default pending-request lifetime so registration
    // and verification email round trips are not abandoned after five minutes.
    authorizationTimeoutMs: options.authorizationTimeoutMs ?? 900_000,
    networkTimeoutMs: options.networkTimeoutMs ?? 15_000,
    clockSkewSeconds: options.clockSkewSeconds ?? 30,
    now: options.now ?? Date.now,
  };
}

function normalizeIssuer(value: string): string {
  const trimmed = value.trim().replace(/\/+$/g, '');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new NativeAuthError('issuer must be an absolute URL.', 'NATIVE_ISSUER_INVALID');
  }
  if (url.search || url.hash || url.username || url.password || !isSecureIssuer(url)) {
    throw new NativeAuthError('issuer must be HTTPS or an HTTP loopback URL.', 'NATIVE_ISSUER_INVALID');
  }
  return url.href.replace(/\/+$/g, '');
}

function isSecureIssuer(url: URL): boolean {
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}
