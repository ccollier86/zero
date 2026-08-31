/**
 * mfa-secret-crypto.ts
 *
 * Encrypts and decrypts MFA shared secrets for storage. This file owns only
 * symmetric secret protection; TOTP code generation lives in mfa-totp.ts.
 */

const SECRET_CIPHER_VERSION = 'v1';

/** Encrypt an MFA secret with AES-GCM using an app-provided key string. */
export async function encryptMfaSecret(
  plaintext: string,
  encryptionKey: string
): Promise<string> {
  const key = await importAesKey(encryptionKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  return [
    SECRET_CIPHER_VERSION,
    base64UrlEncode(iv),
    base64UrlEncode(new Uint8Array(ciphertext)),
  ].join('.');
}

/** Decrypt an MFA secret encrypted by encryptMfaSecret(). */
export async function decryptMfaSecret(
  ciphertext: string,
  encryptionKey: string
): Promise<string> {
  const [version, ivValue, cipherValue] = ciphertext.split('.');
  if (version !== SECRET_CIPHER_VERSION || !ivValue || !cipherValue) {
    throw new Error('Unsupported MFA secret ciphertext');
  }

  const key = await importAesKey(encryptionKey);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlDecode(ivValue) },
    key,
    base64UrlDecode(cipherValue)
  );
  return new TextDecoder().decode(plaintext);
}

async function importAesKey(encryptionKey: string): Promise<CryptoKey> {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(encryptionKey);
  const keyBytes = toArrayBufferView(hasher.digest());
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function base64UrlEncode(value: Uint8Array): string {
  return Buffer.from(value)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.padEnd(Math.ceil(value.length / 4) * 4, '=');
  const normalized = padded.replaceAll('-', '+').replaceAll('_', '/');
  return toArrayBufferView(Buffer.from(normalized, 'base64'));
}

function toArrayBufferView(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const arrayBuffer = value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength
  ) as ArrayBuffer;
  return new Uint8Array(arrayBuffer);
}
