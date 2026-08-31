const RESERVED_RESPONSE_KEYS = new Set([
  'code',
  'error',
  'error_description',
  'error_uri',
  'state',
  'iss',
]);

export function hasSafeNativeRedirectQuery(value: string, url: URL): boolean {
  if (value.includes('#') || value.endsWith('?')) return false;
  const seen = new Set<string>();
  for (const [key] of url.searchParams) {
    if (seen.has(key) || RESERVED_RESPONSE_KEYS.has(key)) return false;
    seen.add(key);
  }
  return true;
}
