/** Validate the one local continuation Zero uses during native registration. */

const REQUEST_ID = /^[A-Za-z0-9_-]{43,128}$/;
const BASE = 'https://zero.invalid';

export function normalizeNativeAuthContinuation(value: unknown): string | null {
  return parseNativeAuthContinuation(value)?.continuation ?? null;
}

/** Parse the only local continuation shape accepted by native registration. */
export function parseNativeAuthContinuation(value: unknown): {
  continuation: string;
  requestId: string;
} | null {
  if (typeof value !== 'string' || value.length > 512 || value !== value.trim()) return null;
  try {
    const url = new URL(value, BASE);
    const ids = url.searchParams.getAll('request_id');
    const keys = [...new Set(url.searchParams.keys())];
    if (url.origin !== BASE || url.pathname !== '/auth/oauth/authorize' || url.hash
      || keys.length !== 1 || keys[0] !== 'request_id'
      || ids.length !== 1 || !REQUEST_ID.test(ids[0]!)) {
      return null;
    }
    return {
      continuation: `${url.pathname}?request_id=${encodeURIComponent(ids[0]!)}`,
      requestId: ids[0]!,
    };
  } catch {
    return null;
  }
}
