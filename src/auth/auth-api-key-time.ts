/** Browser-safe timestamp rules shared by Guardian API-key server and client code. */

/** Largest millisecond timestamp accepted by JavaScript's `Date`. */
export const AUTH_API_KEY_MAX_TIMESTAMP_MS = 8_640_000_000_000_000;

export function isAuthApiKeyTimestamp(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= AUTH_API_KEY_MAX_TIMESTAMP_MS;
}

/** Add a finite lifetime without producing an unsafe or non-renderable timestamp. */
export function resolveAuthApiKeyExpiry(
  now: number,
  ttlMs: number,
): number | null {
  if (!isAuthApiKeyTimestamp(now)
    || !Number.isSafeInteger(ttlMs)
    || ttlMs <= 0) return null;
  const expiresAt = now + ttlMs;
  return expiresAt > now && isAuthApiKeyTimestamp(expiresAt)
    ? expiresAt
    : null;
}
