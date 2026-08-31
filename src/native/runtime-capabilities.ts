/** Fail fast when the host cannot run jose-backed OIDC validation safely. */

import { NativeAuthError } from './errors';

interface NativeRuntimeGlobals {
  crypto?: { subtle?: unknown };
  URL?: unknown;
  TextEncoder?: unknown;
  AbortController?: unknown;
  Request?: unknown;
  Response?: unknown;
  Headers?: unknown;
  URLSearchParams?: unknown;
}

export function assertNativeRuntimeCapabilities(
  runtime: NativeRuntimeGlobals = globalThis,
): void {
  const constructors = [
    runtime.URL, runtime.TextEncoder, runtime.AbortController,
    runtime.Request, runtime.Response, runtime.Headers, runtime.URLSearchParams,
  ];
  if (!runtime.crypto?.subtle || constructors.some((value) => typeof value !== 'function')) {
    throw new NativeAuthError(
      'Native OIDC requires WebCrypto and standard Fetch/URL platform globals.',
      'NATIVE_WEBCRYPTO_UNAVAILABLE',
    );
  }
}
