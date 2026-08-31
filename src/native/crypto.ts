/** WebCrypto-backed default primitives and base64url helpers. */

import type { NativeCryptoAdapter } from './adapter-types';
import { NativeAuthError } from './errors';

/** Create the default cryptographically secure adapter from global WebCrypto. */
export function createWebCryptoAdapter(): NativeCryptoAdapter {
  const webCrypto = globalThis.crypto;
  if (!webCrypto?.getRandomValues || !webCrypto.subtle) {
    throw new NativeAuthError(
      'A WebCrypto implementation or native crypto adapter is required.',
      'NATIVE_WEBCRYPTO_UNAVAILABLE',
    );
  }

  return {
    randomBytes(length) {
      return webCrypto.getRandomValues(new Uint8Array(length));
    },
    async sha256(value) {
      const input = new ArrayBuffer(value.byteLength);
      new Uint8Array(input).set(value);
      return new Uint8Array(await webCrypto.subtle.digest('SHA-256', input));
    },
  };
}

/** Encode bytes without padding using the URL-safe Base64 alphabet. */
export function encodeBase64Url(value: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let output = '';
  for (let index = 0; index < value.length; index += 3) {
    const remaining = value.length - index;
    const block = (value[index]! << 16)
      | ((value[index + 1] ?? 0) << 8)
      | (value[index + 2] ?? 0);
    output += alphabet[(block >>> 18) & 63]! + alphabet[(block >>> 12) & 63]!;
    if (remaining > 1) output += alphabet[(block >>> 6) & 63]!;
    if (remaining > 2) output += alphabet[block & 63]!;
  }
  return output;
}

/** Encode UTF-8 text for hashing. */
export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
