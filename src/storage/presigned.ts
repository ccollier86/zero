// ─── Presigned URL Signing ─────────────────────────────────────────────────

/**
 * HMAC-based presigned URL tokens.
 *
 * Token format: base64url({ driveId, path, method, exp, maxSize?, contentType? })
 * Signature: HMAC-SHA256(token, secret)
 *
 * URL: /storage/presigned/{token}.{signature}
 */

interface PresignedPayload {
  d: string;  // driveId
  p: string;  // path
  m: 'GET' | 'PUT';
  e: number;  // expires (unix ms)
  s?: number; // maxSize (bytes)
  c?: string; // contentType
}

let _encoder: TextEncoder | null = null;
function encoder(): TextEncoder {
  return (_encoder ??= new TextEncoder());
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
  return expected === signature;
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function toBase64UrlString(str: string): string {
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64UrlString(b64: string): string {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded);
}

// ─── Public API ───────────────────────────────────────────────────────────

export interface CreatePresignedOptions {
  driveId: string;
  path: string;
  method: 'upload' | 'download';
  expiresIn: number;
  secret: string;
  maxSize?: number;
  contentType?: string;
}

/**
 * Create a presigned token for file access.
 * Returns the token string to embed in the URL.
 */
export async function createPresignedToken(opts: CreatePresignedOptions): Promise<string> {
  const payload: PresignedPayload = {
    d: opts.driveId,
    p: opts.path,
    m: opts.method === 'upload' ? 'PUT' : 'GET',
    e: Date.now() + opts.expiresIn * 1000,
  };
  if (opts.maxSize) payload.s = opts.maxSize;
  if (opts.contentType) payload.c = opts.contentType;

  const token = toBase64UrlString(JSON.stringify(payload));
  const signature = await hmacSign(token, opts.secret);

  return `${token}.${signature}`;
}

export interface VerifiedPresigned {
  driveId: string;
  path: string;
  method: 'GET' | 'PUT';
  maxSize?: number;
  contentType?: string;
}

/**
 * Verify and decode a presigned token.
 * Returns null if invalid, expired, or tampered.
 */
export async function verifyPresignedToken(
  tokenString: string,
  secret: string
): Promise<VerifiedPresigned | null> {
  const dotIdx = tokenString.lastIndexOf('.');
  if (dotIdx === -1) return null;

  const token = tokenString.slice(0, dotIdx);
  const signature = tokenString.slice(dotIdx + 1);

  // Verify HMAC
  const valid = await hmacVerify(token, signature, secret);
  if (!valid) return null;

  // Decode payload
  let payload: PresignedPayload;
  try {
    payload = JSON.parse(fromBase64UrlString(token));
  } catch {
    return null;
  }

  // Check expiry
  if (Date.now() > payload.e) return null;

  return {
    driveId: payload.d,
    path: payload.p,
    method: payload.m,
    maxSize: payload.s,
    contentType: payload.c,
  };
}
