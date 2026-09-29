/**
 * resource-crud-rows.ts
 *
 * Owns small storage-neutral helpers for generated Resource inputs and exact
 * SQLite row comparisons. It contains no policy, routing, or persistence.
 */

import type { Row } from '../sync';

/** Normalize an HTTP mutation body without accepting arrays or null. */
export function normalizeResourceInput(
  input: unknown,
): Record<string, unknown> | { status: number; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { status: 400, error: 'Request body must be a JSON object' };
  }
  return input as Record<string, unknown>;
}

/** Compare only declared SQLite columns using SQLite-compatible blob equality. */
export function resourceRowsMatch(
  columns: readonly string[],
  current: Row,
  expected: Row,
): boolean {
  return columns.every((column) =>
    sqliteValuesEqual(current[column] ?? null, expected[column] ?? null));
}

function sqliteValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left instanceof Uint8Array && right instanceof Uint8Array) {
    if (left.byteLength !== right.byteLength) return false;
    for (let index = 0; index < left.byteLength; index += 1) {
      if (left[index] !== right[index]) return false;
    }
    return true;
  }
  return false;
}
