/** Clerk-like ergonomic entry point for Zero desktop and mobile apps. */

import type { NativeAuthClient, NativeAuthClientOptions } from './client-types';
import { createNativeAuthClient } from './native-auth-client';
import { resolveZeroNativeIssuer } from './server-url';

export interface ZeroNativeAuthOptions extends Omit<
  NativeAuthClientOptions,
  'issuer' | 'vault' | 'callbacks'
> {
  /** Deployed Zero URL; discovery and signing keys are resolved automatically. */
  serverUrl: string;
  /** OS keychain/keystore adapter. Never use plain preferences or localStorage. */
  secureStorage: NativeAuthClientOptions['vault'];
  /** Custom-URI, claimed-HTTPS, or loopback callback adapter. */
  callback: NativeAuthClientOptions['callbacks'];
}

export type ZeroNativeAuth = NativeAuthClient;

/** Create a public native client. clientId is publishable; no secret is used. */
export function createZeroNativeAuth(options: ZeroNativeAuthOptions): ZeroNativeAuth {
  const { serverUrl, secureStorage, callback, ...rest } = options;
  return createNativeAuthClient({
    ...rest,
    issuer: resolveZeroNativeIssuer(serverUrl),
    vault: secureStorage,
    callbacks: callback,
  });
}
