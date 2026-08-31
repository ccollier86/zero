/** OIDC token-hash claim verification. */

import type { NativeCryptoAdapter } from './adapter-types';
import { encodeBase64Url, utf8 } from './crypto';

/** ES256 uses the left-most half of a SHA-256 digest for at_hash. */
export async function matchesAccessTokenHash(
  accessToken: string,
  expected: string,
  crypto: NativeCryptoAdapter,
): Promise<boolean> {
  const digest = await crypto.sha256(utf8(accessToken));
  return constantTimeEqual(encodeBase64Url(digest.slice(0, digest.length / 2)), expected);
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}
