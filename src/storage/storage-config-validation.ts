/** Primitive validators shared by the focused Storage config normalizers. */

const MAX_SAFE_BYTES = Number.MAX_SAFE_INTEGER;

export function assertPlainObject<T extends object>(value: T, path: string): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`[app] ${path} must be an object when configured.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`[app] ${path} must be a plain object.`);
  }
  return value;
}

export function assertKnownKeys(
  value: object,
  allowed: ReadonlySet<string>,
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`[app] ${path}.${key} is not a supported setting.`);
    }
  }
}

export function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new Error(`[app] ${path} must be a boolean.`);
  }
  return value;
}

export function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`[app] ${path} must be a positive integer.`);
  }
  return value as number;
}

export function nonNegativeSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value)
    || (value as number) < 0
    || (value as number) > MAX_SAFE_BYTES) {
    throw new Error(`[app] ${path} must be a non-negative safe integer.`);
  }
  return value as number;
}

export function boundedString(
  value: unknown,
  path: string,
  maxLength: number,
): string {
  if (typeof value !== 'string') {
    throw new Error(`[app] ${path} must be a string.`);
  }
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > maxLength) {
    throw new Error(`[app] ${path} must contain 1-${maxLength} characters.`);
  }
  return normalized;
}

export function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(`[app] ${path} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T[number];
}
