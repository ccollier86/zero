/**
 * Native platform adapter contracts. The SDK owns OIDC policy while host apps
 * own operating-system browser, callback, vault, and crypto integrations.
 */

/** Async OS-backed secret storage used for refresh tokens and pending PKCE state. */
export interface NativeSecureVault {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Opens authorization URLs in the system browser, never an embedded webview. */
export interface NativeSystemBrowser {
  open(url: string, options?: { signal?: AbortSignal }): Promise<void>;
  close?(): Promise<void>;
}

/** One armed custom-URI, claimed-HTTPS, or loopback callback capture. */
export interface NativeCallbackSession {
  readonly redirectUri: string;
  waitForCallback(signal?: AbortSignal): Promise<string>;
  dispose(): Promise<void>;
}

/** Creates and arms a callback capture before the system browser is opened. */
export interface NativeCallbackAdapter {
  prepare(options: {
    redirectUri?: string;
    signal?: AbortSignal;
  }): Promise<NativeCallbackSession>;
}

/** Cryptographically secure primitives required by PKCE and OIDC validation. */
export interface NativeCryptoAdapter {
  randomBytes(length: number): Uint8Array;
  sha256(value: Uint8Array): Promise<Uint8Array>;
}

/** Fetch contract injectable by native wrappers and deterministic tests. */
export type NativeFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
