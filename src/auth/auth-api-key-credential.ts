/** Secret construction and verification for Guardian user API keys. */

import { timingSafeEqual } from 'node:crypto';
import { createOpaqueToken, hashToken } from '../tokens/token-utils';

const API_KEY_PREFIX = 'zero_ak_v1.';
const API_KEY_PATTERN = /^zero_ak_v1\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;

export interface CreatedAuthApiKeyCredential {
  readonly keyId: string;
  readonly secret: string;
  readonly secretHash: string;
  readonly secretHint: string;
}

export function isAuthApiKeyToken(raw: string): boolean {
  return raw.startsWith(API_KEY_PREFIX);
}

export function createAuthApiKeyCredential(): CreatedAuthApiKeyCredential {
  const keyId = crypto.randomUUID();
  const opaque = createOpaqueToken(32);
  const secret = `${API_KEY_PREFIX}${keyId}.${opaque}`;
  return Object.freeze({
    keyId,
    secret,
    secretHash: hashToken(secret),
    secretHint: opaque.slice(-4),
  });
}

export function parseAuthApiKeyCredential(raw: string): { keyId: string } | null {
  if (typeof raw !== 'string' || raw.length > 128) return null;
  const match = API_KEY_PATTERN.exec(raw);
  return match ? { keyId: match[1]! } : null;
}

export function verifyAuthApiKeyCredential(
  raw: string,
  expectedHash: string,
): boolean {
  return safeHashEquals(expectedHash, hashToken(raw));
}

function safeHashEquals(expected: string, actual: string): boolean {
  if (expected.length !== 64 || actual.length !== 64) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
  } catch {
    return false;
  }
}
