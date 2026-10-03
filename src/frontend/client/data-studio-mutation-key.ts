/** Browser-safe, bounded canonicalization for Data Studio retry identities. */

const MAX_DEPTH = 32;
const MAX_NODES = 4_096;
const MAX_COLLECTION_ENTRIES = 1_024;
const MAX_CANONICAL_CHARACTERS = 768 * 1_024;
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const ARRAY_INDEX = /^(?:0|[1-9][0-9]*)$/u;

/**
 * Canonicalize plain JSON data without evaluating property getters. Reflective
 * failures (including hostile Proxy traps) are converted to a closed error.
 */
export function canonicalizeDataStudioMutationInput(value: unknown): string {
  try {
    let nodes = 0;
    let characters = 0;
    const active = new WeakSet<object>();

    const encode = (current: unknown, depth: number): string => {
      nodes += 1;
      if (nodes > MAX_NODES || depth > MAX_DEPTH) throw invalidMutationInput();

      if (current === null || typeof current === 'boolean') {
        const encoded = String(current);
        charge(encoded.length);
        return encoded;
      }
      if (typeof current === 'string') {
        assertWellFormedString(current);
        if (current.length > MAX_CANONICAL_CHARACTERS) throw invalidMutationInput();
        const encoded = JSON.stringify(current);
        charge(encoded.length);
        return encoded;
      }
      if (typeof current === 'number') {
        if (!Number.isFinite(current)) throw invalidMutationInput();
        const encoded = Object.is(current, -0) ? '0' : String(current);
        charge(encoded.length);
        return encoded;
      }
      if (typeof current !== 'object') throw invalidMutationInput();
      if (active.has(current)) throw invalidMutationInput();
      active.add(current);

      try {
        if (Array.isArray(current)) {
          return encodeArray(current, depth);
        }
        return encodeRecord(current, depth);
      } finally {
        active.delete(current);
      }
    };

    const encodeArray = (array: readonly unknown[], depth: number): string => {
      const descriptors = Object.getOwnPropertyDescriptors(array);
      const ownKeys = Reflect.ownKeys(descriptors);
      const lengthDescriptor = descriptors['length'] as PropertyDescriptor | undefined;
      if (!lengthDescriptor || !('value' in lengthDescriptor)
        || !Number.isSafeInteger(lengthDescriptor.value)
        || lengthDescriptor.value < 0
        || lengthDescriptor.value > MAX_COLLECTION_ENTRIES) {
        throw invalidMutationInput();
      }
      const length = lengthDescriptor.value as number;
      if (ownKeys.length !== length + 1) throw invalidMutationInput();
      charge(2 + Math.max(0, length - 1));
      const entries: string[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor?.enumerable || !('value' in descriptor)) {
          throw invalidMutationInput();
        }
        entries.push(encode(descriptor.value, depth + 1));
      }
      for (const key of ownKeys) {
        if (key === 'length') continue;
        if (typeof key !== 'string' || !ARRAY_INDEX.test(key)
          || Number(key) >= length || String(Number(key)) !== key) {
          throw invalidMutationInput();
        }
      }
      return `[${entries.join(',')}]`;
    };

    const encodeRecord = (object: object, depth: number): string => {
      const prototype = Object.getPrototypeOf(object);
      if (prototype !== Object.prototype && prototype !== null) {
        throw invalidMutationInput();
      }
      const descriptors = Object.getOwnPropertyDescriptors(object);
      const ownKeys = Reflect.ownKeys(descriptors);
      if (ownKeys.length > MAX_COLLECTION_ENTRIES) throw invalidMutationInput();
      const keys: string[] = [];
      for (const key of ownKeys) {
        if (typeof key !== 'string' || BLOCKED_KEYS.has(key)) throw invalidMutationInput();
        assertWellFormedString(key);
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !('value' in descriptor)) {
          throw invalidMutationInput();
        }
        keys.push(key);
      }
      keys.sort(compareCodeUnits);
      charge(2 + Math.max(0, keys.length - 1));
      return `{${keys.map((key) => {
        const descriptor = descriptors[key]!;
        const encodedKey = JSON.stringify(key);
        charge(encodedKey.length + 1);
        return `${encodedKey}:${encode(descriptor.value, depth + 1)}`;
      }).join(',')}}`;
    };

    const charge = (amount: number): void => {
      characters += amount;
      if (characters > MAX_CANONICAL_CHARACTERS) throw invalidMutationInput();
    };

    return encode(value, 0);
  } catch {
    throw invalidMutationInput();
  }
}

function assertWellFormedString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        throw invalidMutationInput();
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw invalidMutationInput();
    }
  }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalidMutationInput(): TypeError {
  return new TypeError('Data Studio mutation input must be bounded plain JSON data.');
}
