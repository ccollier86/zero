/**
 * Neutral exact string-array predicate shared by database reads and resource
 * authorization. Owns bounded, descriptor-safe validation and fail-closed
 * in-memory matching; it does not resolve authority or access table fields.
 */

import { types as utilTypes } from 'node:util';

export const STRING_ARRAY_OVERLAP_MAX_PERMITTED_VALUES = 50;
export const STRING_ARRAY_OVERLAP_MAX_RETAINED_VALUES = 256;
export const STRING_ARRAY_OVERLAP_MAX_VALUE_BYTES = 1_024;
export const STRING_ARRAY_OVERLAP_MAX_RETAINED_BYTES = 65_536;

export type StringArrayOverlapValidation =
  | { readonly ok: true; readonly value: readonly string[] }
  | { readonly ok: false; readonly kind: 'invalid' | 'limit'; readonly error: string };

const encoder = new TextEncoder();

/** Detach a dense string-array policy value without invoking user accessors. */
export function validateStringArrayOverlapValues(
  value: unknown,
): StringArrayOverlapValidation {
  return validateArray(value, STRING_ARRAY_OVERLAP_MAX_PERMITTED_VALUES);
}

/**
 * Match ANY exact string in a bounded JSON string or decoded array. Invalid
 * data denies the whole row, even when another element would otherwise match.
 * Empty strings, NUL, and well-formed Unicode are literal values, not sentinels.
 */
export function matchesStringArrayOverlap(
  rowValue: unknown,
  permitted: readonly string[],
): boolean {
  const allowed = validateStringArrayOverlapValues(permitted);
  if (!allowed.ok || allowed.value.length === 0) return false;
  let decoded = rowValue;
  if (typeof rowValue === 'string') {
    if (!isWellFormedUnicode(rowValue)
      || rowValue.length > STRING_ARRAY_OVERLAP_MAX_RETAINED_BYTES
      || byteLength(rowValue) > STRING_ARRAY_OVERLAP_MAX_RETAINED_BYTES) {
      return false;
    }
    try {
      decoded = JSON.parse(rowValue);
    } catch {
      return false;
    }
  }
  const retained = validateArray(decoded, STRING_ARRAY_OVERLAP_MAX_RETAINED_VALUES);
  if (!retained.ok
    || byteLength(JSON.stringify(retained.value)) > STRING_ARRAY_OVERLAP_MAX_RETAINED_BYTES) {
    return false;
  }
  const set = new Set(allowed.value);
  return retained.value.some((entry) => set.has(entry));
}

function validateArray(value: unknown, maximum: number): StringArrayOverlapValidation {
  // Bun exposes proxy detection through its node:util compatibility API; it
  // has no equivalent native Bun API. Check before any reflection/trap can run.
  if (utilTypes.isProxy(value) || !Array.isArray(value)) {
    return invalid('String-array overlap requires a plain string array.');
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Array.prototype && prototype !== null) {
      return invalid('String-array overlap requires a plain string array.');
    }
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (!Number.isSafeInteger(length) || length < 0) {
      return invalid('String-array overlap requires a dense data array.');
    }
    if (length > maximum) return limit('String-array overlap item limit exceeded.');
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as
      Record<string, PropertyDescriptor>;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1 || !keys.includes('length')) {
      return invalid('String-array overlap requires a dense, unextended array.');
    }
    const result: string[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !('value' in descriptor)
        || typeof descriptor.value !== 'string'
        || !isWellFormedUnicode(descriptor.value)) {
        return invalid('String-array overlap elements must be well-formed strings.');
      }
      if (descriptor.value.length > STRING_ARRAY_OVERLAP_MAX_VALUE_BYTES
        || byteLength(descriptor.value) > STRING_ARRAY_OVERLAP_MAX_VALUE_BYTES) {
        return limit('String-array overlap string byte limit exceeded.');
      }
      result.push(descriptor.value);
    }
    return { ok: true, value: Object.freeze(result) };
  } catch {
    return invalid('String-array overlap requires a plain data array.');
  }
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function invalid(error: string): StringArrayOverlapValidation {
  return { ok: false, kind: 'invalid', error };
}

function limit(error: string): StringArrayOverlapValidation {
  return { ok: false, kind: 'limit', error };
}
