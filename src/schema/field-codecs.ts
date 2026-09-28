/**
 * field-codecs.ts
 *
 * Centralizes conversion between UI values and ReactiveDB row values for schema
 * fields. This file owns value encoding/decoding only; it does not validate,
 * render inputs, or write to collections.
 */

import type { FieldMeta } from './field-types';

function parseJson(value: string): unknown {
  if (value.trim() === '') return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function toStringArray(value: unknown): string[] {
  const decoded = typeof value === 'string' ? parseJson(value) : value;
  if (!Array.isArray(decoded)) return [];
  return decoded.map(String);
}

function toDateRange(value: unknown): [string, string] {
  const values = toStringArray(value);
  return [values[0] ?? '', values[1] ?? ''];
}

function encodeJson(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(parseJson(value));
  }
  return JSON.stringify(value ?? null);
}

/** Decode the integer/text representations SQLite may return for a boolean. */
export function decodeBooleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

/** Encode an application boolean into the integer representation SQLite uses. */
export function encodeBooleanValue(value: unknown): 0 | 1 {
  return decodeBooleanValue(value) ? 1 : 0;
}

export function decodeFieldValue(meta: FieldMeta, value: unknown): unknown {
  switch (meta.type) {
    case 'boolean':
      return decodeBooleanValue(value);

    case 'multiSelect':
    case 'tags':
      return toStringArray(value);

    case 'dateRange':
      return toDateRange(value);

    case 'combobox':
      return meta.multiple ? toStringArray(value) : value;

    case 'json':
      return typeof value === 'string' ? parseJson(value) : value;

    default:
      return value;
  }
}

export function encodeFieldValue(meta: FieldMeta, value: unknown): unknown {
  switch (meta.type) {
    case 'boolean':
      return encodeBooleanValue(value);

    case 'multiSelect':
    case 'tags':
      return JSON.stringify(Array.isArray(value) ? value.map(String) : []);

    case 'dateRange': {
      const range = Array.isArray(value) ? value : ['', ''];
      return JSON.stringify([String(range[0] ?? ''), String(range[1] ?? '')]);
    }

    case 'combobox':
      if (meta.multiple) {
        return JSON.stringify(Array.isArray(value) ? value.map(String) : []);
      }
      return value;

    case 'json':
      return encodeJson(value);

    default:
      return value;
  }
}
