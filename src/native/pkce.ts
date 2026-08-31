/** PKCE S256, state, and nonce generation for native authorization requests. */

import type { NativeCryptoAdapter } from './adapter-types';
import { encodeBase64Url, utf8 } from './crypto';
import { NativeAuthError } from './errors';

export interface NativeAuthorizationProof {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
  nonce: string;
}

/** Generate independent high-entropy PKCE, state, and OIDC nonce values. */
export async function createAuthorizationProof(
  crypto: NativeCryptoAdapter,
): Promise<NativeAuthorizationProof> {
  const codeVerifier = randomValue(crypto);
  const codeChallenge = encodeBase64Url(await crypto.sha256(utf8(codeVerifier)));
  if (codeChallenge.length !== 43) throw invalidCrypto();
  return {
    codeVerifier,
    codeChallenge,
    state: randomValue(crypto),
    nonce: randomValue(crypto),
  };
}

function randomValue(crypto: NativeCryptoAdapter): string {
  const bytes = crypto.randomBytes(32);
  if (bytes.length !== 32) throw invalidCrypto();
  return encodeBase64Url(bytes);
}

function invalidCrypto(): NativeAuthError {
  return new NativeAuthError('Native crypto adapter returned invalid output.', 'NATIVE_CRYPTO_INVALID');
}
