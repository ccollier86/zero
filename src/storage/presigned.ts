/**
 * presigned.ts
 *
 * HMAC-based presigned URL tokens.
 *
 * Token format: base64url({ driveId, path, method, exp, maxSize?, contentType? })
 * Signature: HMAC-SHA256(token, secret)
 *
 * URL: /storage/presigned/{token}.{signature}
 */

import { createSignedStorageToken, verifySignedStorageToken } from './storage-token';

interface PresignedPayload {
  d: string;  // driveId
  p: string;  // path
  m: 'GET' | 'PUT';
  e: number;  // expires (unix ms)
  s?: number; // maxSize (bytes)
  c?: string; // contentType
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

  return createSignedStorageToken(payload as unknown as Record<string, unknown>, opts.secret);
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
  const payload = await verifySignedStorageToken<PresignedPayload & Record<string, unknown>>(
    tokenString,
    secret
  );
  if (!payload) return null;

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
