/** Bounded, privacy-safe summaries for aggregate database failures. */

import {
  isDatabaseErrorCode,
  normalizeDatabaseError,
  type DatabaseErrorCode,
} from './database-error';
import { DATABASE_OBSERVABILITY_COUNT_MAX } from './database-capacity';

/** Maximum distinct codes carried by one aggregate failure signal. */
export const DATABASE_FAILURE_CODE_SUMMARY_MAX_ENTRIES = 4;

/**
 * Summarize the most frequent normalized failure codes without retaining raw
 * causes. Entries are ordered by descending count, then by stable code name.
 */
export function summarizeDatabaseFailureCodes(
  failures: readonly unknown[],
): string | undefined {
  if (failures.length === 0) return undefined;
  const counts = new Map<DatabaseErrorCode, number>();
  for (const failure of failures) {
    const code = normalizeDatabaseError(failure).code;
    counts.set(code, Math.min(
      DATABASE_OBSERVABILITY_COUNT_MAX,
      (counts.get(code) ?? 0) + 1,
    ));
  }
  return [...counts.entries()]
    .sort(compareFailureCodeCounts)
    .slice(0, DATABASE_FAILURE_CODE_SUMMARY_MAX_ENTRIES)
    .map(([code, count]) => `${code}:${count}`)
    .join(',');
}

/** Validate and canonically return one externally supplied summary. */
export function normalizeDatabaseFailureCodeSummary(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new TypeError('Invalid database failure-code summary.');
  }
  const encodedEntries = value.split(',');
  if (encodedEntries.length > DATABASE_FAILURE_CODE_SUMMARY_MAX_ENTRIES) {
    throw new TypeError('Invalid database failure-code summary.');
  }

  const seen = new Set<DatabaseErrorCode>();
  const entries: Array<readonly [DatabaseErrorCode, number]> = [];
  for (const encoded of encodedEntries) {
    const separator = encoded.lastIndexOf(':');
    const code = encoded.slice(0, separator);
    const countText = encoded.slice(separator + 1);
    const count = Number(countText);
    if (separator <= 0
      || !isDatabaseErrorCode(code)
      || seen.has(code)
      || !/^[1-9][0-9]*$/u.test(countText)
      || !Number.isSafeInteger(count)
      || count > DATABASE_OBSERVABILITY_COUNT_MAX) {
      throw new TypeError('Invalid database failure-code summary.');
    }
    seen.add(code);
    entries.push([code, count]);
  }

  const canonical = [...entries]
    .sort(compareFailureCodeCounts)
    .map(([code, count]) => `${code}:${count}`)
    .join(',');
  if (canonical !== value) {
    throw new TypeError('Invalid database failure-code summary.');
  }
  return canonical;
}

function compareFailureCodeCounts(
  left: readonly [DatabaseErrorCode, number],
  right: readonly [DatabaseErrorCode, number],
): number {
  if (right[1] !== left[1]) return right[1] - left[1];
  return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
}
