/**
 * token-utils.ts
 *
 * Owns low-level token helpers used by the platform token service. It creates
 * opaque values, hashes raw tokens, and parses duration strings; it does not
 * persist tokens or decide token policy.
 */
import { PlatformTokenError } from './token-types';

/** Create a high-entropy opaque token suitable for URLs and email links. */
export function createOpaqueToken(bytes = 32): string {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Buffer.from(data).toString('base64url');
}

/** Hash a raw token before database lookup or persistence. */
export function hashToken(rawToken: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(rawToken);
  return hasher.digest('hex');
}

/**
 * Parse Zero duration strings into milliseconds.
 *
 * Supports seconds, minutes, hours, and days. Throws for malformed values so
 * config mistakes fail before weak token lifetimes reach production.
 */
export function parseTokenTTL(ttl: string, label = 'token TTL'): number {
  if (typeof ttl !== 'string') {
    throw new PlatformTokenError(`Invalid ${label} format`, 'TOKEN_INPUT_INVALID', 400);
  }
  const match = ttl.match(/^(\d+)(s|m|h|d)$/);
  if (!match) throw new PlatformTokenError(`Invalid ${label} format`, 'TOKEN_INPUT_INVALID', 400);

  const value = Number.parseInt(match[1], 10);
  const multiplier = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 's' | 'm' | 'h' | 'd'];
  const milliseconds = value * multiplier;
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new PlatformTokenError(`Invalid ${label} duration`, 'TOKEN_INPUT_INVALID', 400);
  }
  return milliseconds;
}

/** Resolve a representable expiry without permitting lifetime arithmetic overflow. */
export function tokenExpiryAt(now: number, ttl: string, label: string): number {
  const expiresAt = now + parseTokenTTL(ttl, label);
  if (!Number.isSafeInteger(expiresAt)) {
    throw new PlatformTokenError(`Invalid ${label} expiry`, 'TOKEN_INPUT_INVALID', 400);
  }
  return expiresAt;
}

/** Parse JSON metadata defensively. */
export function parseTokenMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
