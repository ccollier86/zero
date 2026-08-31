/** Pending authorization record creation. */

import type { ResolvedNativeAuthConfig } from './config';
import type { NativePendingAuthorization } from './oidc-types';
import type { createAuthorizationProof } from './pkce';

export function createPendingAuthorization(
  config: ResolvedNativeAuthConfig,
  redirectUri: string,
  proof: Awaited<ReturnType<typeof createAuthorizationProof>>,
): NativePendingAuthorization {
  return {
    issuer: config.issuer,
    clientId: config.clientId,
    redirectUri,
    state: proof.state,
    nonce: proof.nonce,
    codeVerifier: proof.codeVerifier,
    createdAt: config.now(),
  };
}
