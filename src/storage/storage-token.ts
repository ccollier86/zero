/**
 * storage-token.ts
 *
 * Shared HMAC token helpers for storage URL capabilities. This file owns
 * token serialization and signature verification; callers own payload shape,
 * expiry rules, and permission semantics.
 */

let _encoder: TextEncoder | null = null;
let _decoder: TextDecoder | null = null;

function encoder(): TextEncoder {
  return (_encoder ??= new TextEncoder());
}

function decoder(): TextDecoder {
  return (_decoder ??= new TextDecoder('utf-8', { fatal: true }));
}

/**
 * Create a signed storage token from a JSON-serializable payload.
 */
export async function createSignedStorageToken(
  payload: Record<string, unknown>,
  secret: string
): Promise<string> {
  const token = toBase64UrlString(JSON.stringify(payload));
  const signature = await hmacSign(token, secret);
  return `${token}.${signature}`;
}

/**
 * Verify and decode a signed storage token.
 */
export async function verifySignedStorageToken<T extends Record<string, unknown>>(
  tokenString: string,
  secret: string
): Promise<T | null> {
  const dotIdx = tokenString.lastIndexOf('.');
  if (dotIdx === -1) return null;

  const token = tokenString.slice(0, dotIdx);
  const signature = tokenString.slice(dotIdx + 1);
  const valid = await hmacVerify(token, signature, secret);
  if (!valid) return null;

  try {
    return JSON.parse(fromBase64UrlString(token)) as T;
  } catch {
    return null;
  }
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder().encode(data));
  return toBase64Url(new Uint8Array(sig));
}

async function hmacVerify(data: string, signature: string, secret: string): Promise<boolean> {
  const expected = await hmacSign(data, secret);
  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function toBase64UrlString(str: string): string {
  return toBase64Url(encoder().encode(str));
}

function fromBase64UrlString(b64: string): string {
  const normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(
    normalized.length + ((4 - normalized.length % 4) % 4),
    '=',
  );
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return decoder().decode(bytes);
}
