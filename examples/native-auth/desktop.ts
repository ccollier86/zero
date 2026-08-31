/** Dependency-free adapter for Electron or another trusted JavaScript desktop host. */

import {
  createZeroNativeAuthBroker,
  type NativeIdentityScope,
  type NativeSecureVault,
  type ZeroNativeAuth,
} from '@zero/framework/native';

export interface DesktopAuthHost {
  openSystemBrowser(url: string, signal?: AbortSignal): Promise<void>;
  prepareLoopbackCallback(input: {
    path: string;
    signal?: AbortSignal;
  }): Promise<{
    redirectUri: string;
    waitForCallback(signal?: AbortSignal): Promise<string>;
    close(): Promise<void>;
  }>;
  readSecret(key: string): Promise<string | null>;
  writeSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
}

export interface DesktopAuthOptions {
  serverUrl: string;
  clientId: string;
  host: DesktopAuthHost;
  callbackPath?: string;
  scopes?: NativeIdentityScope[];
}

/** Create Zero auth once the desktop shell exposes its narrow, trusted bridge. */
export function createDesktopAuth(options: DesktopAuthOptions): ZeroNativeAuth {
  const { host } = options;
  const secureStorage: NativeSecureVault = {
    get: (key) => host.readSecret(key),
    set: (key, value) => host.writeSecret(key, value),
    delete: (key) => host.deleteSecret(key),
  };

  return createZeroNativeAuthBroker({
    serverUrl: options.serverUrl,
    clientId: options.clientId,
    scopes: options.scopes,
    secureStorage,
    browser: {
      open: (url, request) => host.openSystemBrowser(url, request?.signal),
    },
    callback: {
      async prepare(request) {
        const listener = await host.prepareLoopbackCallback({
          path: options.callbackPath ?? '/oauth/callback',
          signal: request.signal,
        });
        assertLoopbackCallback(listener.redirectUri, options.callbackPath ?? '/oauth/callback');
        return {
          redirectUri: listener.redirectUri,
          waitForCallback: (signal) => listener.waitForCallback(signal),
          dispose: () => listener.close(),
        };
      },
    },
  });
}

function assertLoopbackCallback(value: string, path: string): void {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'http:' || !['127.0.0.1', '::1'].includes(host)
    || !url.port || url.pathname !== path || url.search || url.hash) {
    throw new Error('Desktop callback must be a clean IP-loopback URI with an ephemeral port.');
  }
}
