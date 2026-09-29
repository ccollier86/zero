/** Shared, transport-neutral primitives for the authorization policy modules. */

export function compareAuthorizationKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function uniqueSortedAuthorizationValues(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareAuthorizationKeys);
}

export function sameAuthorizationStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const normalizedLeft = uniqueSortedAuthorizationValues(left);
  const normalizedRight = uniqueSortedAuthorizationValues(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

export function sameAuthorizationStringArray(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export function isUniqueAuthorizationStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value)
    && value.every(isNonEmptyAuthorizationString)
    && new Set(value).size === value.length;
}

export function isPlainAuthorizationRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function assertNonEmptyAuthorizationString(
  value: unknown,
  label: string,
): asserts value is string {
  if (!isNonEmptyAuthorizationString(value)) {
    throw authorizationConfigError(`${label} must be a non-empty string.`);
  }
}

export function isNonEmptyAuthorizationString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

export function isBoundedAuthorizationDisplayText(
  value: unknown,
  maxLength: number,
): value is string {
  return isNonEmptyAuthorizationString(value) && value.length <= maxLength;
}

export function authorizationConfigError(message: string): Error {
  return new Error(`[auth] ${message}`);
}
