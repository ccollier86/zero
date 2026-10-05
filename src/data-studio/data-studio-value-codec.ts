/** Bounded JSON and typed-column value normalization. */

import {
  DATA_STUDIO_MAX_COLLECTION_ENTRIES,
  DATA_STUDIO_MAX_VALUE_BYTES,
  DATA_STUDIO_MAX_VALUE_DEPTH,
  DATA_STUDIO_MAX_VALUE_NODES,
  type DataStudioColumn,
  type DataStudioValue,
} from './data-studio-contracts';
import { DataStudioError } from './data-studio-error';
import {
  assertDataStudioUtf8Limit,
  assertDenseDataStudioArray,
  canonicalDataStudioJson,
  DATA_STUDIO_BLOCKED_OBJECT_KEYS,
  dataStudioLimitExceeded,
  invalidDataStudioValue,
  readDataStudioRecord,
} from './data-studio-codec-common';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;
const MAX_VALUE_OBJECT_KEY_LENGTH = 128;

interface NormalizationBudget {
  nodes: number;
}

/** Validate and detach one strict, bounded JSON cell value. */
export function normalizeDataStudioValue(value: unknown): DataStudioValue {
  try {
    const normalized = normalizeJsonValue(value, new Set<object>(), 0, { nodes: 0 });
    assertDataStudioUtf8Limit(
      canonicalDataStudioJson(normalized),
      DATA_STUDIO_MAX_VALUE_BYTES,
      'Data Studio value exceeds its byte limit.',
    );
    return normalized;
  } catch (error) {
    if (error instanceof DataStudioError) throw error;
    throw invalidDataStudioValue('Data Studio value is invalid.', error);
  }
}

export function serializeDataStudioValue(value: unknown): string {
  const serialized = canonicalDataStudioJson(normalizeDataStudioValue(value));
  assertDataStudioUtf8Limit(
    serialized,
    DATA_STUDIO_MAX_VALUE_BYTES,
    'Data Studio value exceeds its byte limit.',
  );
  return serialized;
}

export function parseDataStudioValue(text: string): DataStudioValue {
  if (typeof text !== 'string') {
    throw invalidDataStudioValue('Data Studio value must be encoded as JSON text.');
  }
  assertDataStudioUtf8Limit(
    text,
    DATA_STUDIO_MAX_VALUE_BYTES,
    'Data Studio value exceeds its byte limit.',
  );
  try {
    return normalizeDataStudioValue(JSON.parse(text));
  } catch (error) {
    if (error instanceof DataStudioError) throw error;
    throw invalidDataStudioValue('Data Studio value JSON is malformed.', error);
  }
}

/** Normalize a value for an already-admitted logical column. */
export function normalizeValueForDataStudioColumn(
  column: DataStudioColumn,
  value: unknown,
): DataStudioValue {
  if (value === null) {
    if (column.required) {
      throw invalidDataStudioValue('Required Data Studio columns cannot store null.');
    }
    return null;
  }

  switch (column.type) {
    case 'text':
      if (typeof value !== 'string') {
        throw invalidDataStudioValue('Data Studio text columns require a string.');
      }
      return normalizeDataStudioValue(value);
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw invalidDataStudioValue(
          'Data Studio number columns require a finite number.',
        );
      }
      return normalizeDataStudioValue(value);
    case 'boolean':
      if (typeof value !== 'boolean') {
        throw invalidDataStudioValue('Data Studio boolean columns require a boolean.');
      }
      return value;
    case 'date':
      if (typeof value !== 'string' || !isCanonicalCalendarDate(value)) {
        throw invalidDataStudioValue('Data Studio date columns require YYYY-MM-DD.');
      }
      return value;
    case 'datetime': {
      if (typeof value !== 'string' || !DATETIME_PATTERN.test(value)) {
        throw invalidDataStudioValue(
          'Data Studio datetime columns require an ISO timestamp.',
        );
      }
      const timestamp = Date.parse(value);
      if (!isCanonicalCalendarDate(value.slice(0, 10)) || !Number.isFinite(timestamp)) {
        throw invalidDataStudioValue('Data Studio datetime value is invalid.');
      }
      return new Date(timestamp).toISOString();
    }
    case 'json':
      return normalizeDataStudioValue(value);
  }
}

function normalizeJsonValue(
  value: unknown,
  ancestors: Set<object>,
  depth: number,
  budget: NormalizationBudget,
): DataStudioValue {
  budget.nodes += 1;
  if (budget.nodes > DATA_STUDIO_MAX_VALUE_NODES) {
    throw dataStudioLimitExceeded('Data Studio value has too many nodes.');
  }
  if (depth > DATA_STUDIO_MAX_VALUE_DEPTH) {
    throw dataStudioLimitExceeded('Data Studio value is nested too deeply.');
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    assertDataStudioUtf8Limit(
      value,
      DATA_STUDIO_MAX_VALUE_BYTES,
      'Data Studio string value exceeds its byte limit.',
    );
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw invalidDataStudioValue('Data Studio numbers must be finite.');
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') {
    throw invalidDataStudioValue('Data Studio cells accept JSON values only.');
  }
  if (ancestors.has(value)) {
    throw invalidDataStudioValue('Data Studio values cannot contain cycles.');
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      assertDenseDataStudioArray(value, 'Data Studio value array');
      if (value.length > DATA_STUDIO_MAX_COLLECTION_ENTRIES) {
        throw dataStudioLimitExceeded('Data Studio array has too many entries.');
      }
      return Object.freeze(value.map((entry) =>
        normalizeJsonValue(entry, ancestors, depth + 1, budget)));
    }

    const record = readDataStudioRecord(value);
    const keys = Object.keys(record);
    if (keys.length > DATA_STUDIO_MAX_COLLECTION_ENTRIES) {
      throw dataStudioLimitExceeded('Data Studio object has too many entries.');
    }
    const result: Record<string, DataStudioValue> = Object.create(null);
    for (const key of keys.sort()) {
      if (DATA_STUDIO_BLOCKED_OBJECT_KEYS.has(key)
        || key.length === 0
        || key.length > MAX_VALUE_OBJECT_KEY_LENGTH) {
        throw invalidDataStudioValue('Data Studio object contains an invalid key.');
      }
      result[key] = normalizeJsonValue(record[key], ancestors, depth + 1, budget);
    }
    return Object.freeze(result);
  } finally {
    ancestors.delete(value);
  }
}

function isCanonicalCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}
