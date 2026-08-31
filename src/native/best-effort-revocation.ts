/** Bounded refresh-family cleanup that never masks the primary operation. */

import { createOperationSignal, raceWithSignal } from './abort';
import type { NativeFetch } from './adapter-types';
import type { NativeOidcMetadata } from './oidc-types';
import { revokeNativeRefreshToken } from './revocation';

interface RevocationInput {
  metadata: NativeOidcMetadata;
  clientId: string;
  fetch: NativeFetch;
  networkTimeoutMs: number;
}

export function revokeNativeRefreshTokenBestEffort(
  input: RevocationInput,
  refreshToken: string,
): void {
  const bounded = createOperationSignal(
    undefined, input.networkTimeoutMs, 'OIDC cleanup revocation timed out.',
  );
  void raceWithSignal(revokeNativeRefreshToken(input, refreshToken, bounded.signal), bounded.signal)
    .catch(() => undefined)
    .finally(bounded.dispose);
}
