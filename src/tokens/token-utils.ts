/**
 * token-utils.ts
 *
 * Owns low-level token helpers used by the platform token service. It creates
 * opaque values, hashes raw tokens, and parses duration strings; it does not
 * persist tokens or decide token policy.
 */

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
  const match = ttl.match(/^(\d+)(s|m|h|d)$/);
  if (!match) throw new Error(`Invalid ${label} format: ${ttl}`);

  const value = Number.parseInt(match[1], 10);
  switch (match[2]) {
    case 's':
      return value * 1_000;
    case 'm':
      return value * 60_000;
    case 'h':
      return value * 3_600_000;
    case 'd':
      return value * 86_400_000;
    default:
      throw new Error(`Invalid ${label} unit: ${match[2]}`);
  }
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
