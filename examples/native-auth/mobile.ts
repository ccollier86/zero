/** Dependency-free mobile adapter factory for claimed links or private schemes. */

import {
  createZeroNativeAuthBroker,
  type NativeIdentityScope,
  type NativeSecureVault,
  type ZeroNativeAuth,
} from '@zero/framework/native';

export interface MobileAuthHost {
  openAuthSession(input: {
    authorizationUrl: string;
    redirectUri: string;
    signal?: AbortSignal;
  }): Promise<string>;
  dismissAuthSession?(): Promise<void>;
  readSecret(key: string): Promise<string | null>;
  writeSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
}

export interface MobileAuthOptions {
  serverUrl: string;
  clientId: string;
  redirectUri: string;
  host: MobileAuthHost;
  scopes?: NativeIdentityScope[];
}

interface PendingCallback {
  redirectUri: string;
  promise: Promise<string>;
  resolve(url: string): void;
}

/** Pair one OS browser-authentication session with Zero's callback adapter. */
export function createMobileAuth(options: MobileAuthOptions): ZeroNativeAuth {
  assertCompatibleMobileRuntime();
  const { host } = options;
  let pending: PendingCallback | null = null;
  const secureStorage: NativeSecureVault = {
    get: (key) => host.readSecret(key),
    set: (key, value) => host.writeSecret(key, value),
    delete: (key) => host.deleteSecret(key),
  };

  return createZeroNativeAuthBroker({
    serverUrl: options.serverUrl,
    clientId: options.clientId,
    redirectUri: options.redirectUri,
    scopes: options.scopes,
    secureStorage,
    callback: {
      async prepare(request) {
        if (pending) throw new Error('A native authorization is already active.');
        pending = createPending(request.redirectUri ?? options.redirectUri);
        const current = pending;
        return {
          redirectUri: current.redirectUri,
          waitForCallback: () => current.promise,
          async dispose() {
            if (pending === current) pending = null;
          },
        };
      },
    },
    browser: {
      async open(authorizationUrl, request) {
        const current = pending;
        if (!current) throw new Error('Native callback capture was not prepared.');
        current.resolve(await host.openAuthSession({
          authorizationUrl,
          redirectUri: current.redirectUri,
          signal: request?.signal,
        }));
      },
      close: () => host.dismissAuthSession?.() ?? Promise.resolve(),
    },
  });
}

function assertCompatibleMobileRuntime(): void {
  const webCrypto = globalThis.crypto;
  if (typeof globalThis.fetch !== 'function' || typeof URL !== 'function'
    || typeof TextEncoder !== 'function' || !webCrypto?.getRandomValues
    || !webCrypto.subtle) {
    throw new Error(
      'Zero mobile auth requires standards-compatible fetch, URL, TextEncoder, and WebCrypto.',
    );
  }
}

function createPending(redirectUri: string): PendingCallback {
  let resolve!: (url: string) => void;
  const promise = new Promise<string>((yes) => { resolve = yes; });
  return { redirectUri, promise, resolve };
}
