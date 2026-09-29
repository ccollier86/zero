/**
 * Shared structural validation helpers for auth configuration normalization.
 *
 * These helpers intentionally produce the established public auth validation
 * messages. Concern-specific normalizers own their accepted fields and
 * validation order.
 */

export function assertPlainRecord<T>(
  value: T,
  label: string,
): asserts value is T & Record<string, unknown> {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new Error(`[auth] ${label} must be an object.`);
  }
}

export function assertOnlyKeys(
  value: object,
  allowed: readonly string[],
  label: string,
): void {
  const unknown = Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .sort(compareAuthConfigKeys);
  if (unknown.length > 0) {
    throw new Error(`[auth] ${label} contains unsupported field "${unknown[0]}".`);
  }
}

export function assertOptionalBoolean(
  value: unknown,
  label: string,
): asserts value is boolean | undefined {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new Error(`[auth] ${label} must be a boolean.`);
  }
}

export function assertOptionalString(
  value: unknown,
  label: string,
): asserts value is string | undefined {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`[auth] ${label} must be a string.`);
  }
}

export function normalizePublicPath(
  value: string | undefined,
  fallback: string,
): string {
  const path = value?.trim() || fallback;
  return path.startsWith('/') ? path : `/${path}`;
}

export function firstNonEmpty(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function compareAuthConfigKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
