/**
 * resource-schema.ts
 *
 * Owns table-schema inspection helpers used by resource registration. This
 * file reads in-memory schema metadata only; it does not query SQLite, mutate
 * resources, or evaluate authorization policy.
 */

import type { TableSchema } from '../sync/types';

/** Return the first SQL column declared as a primary key in a Zero table schema. */
export function inferTablePrimaryKey(schema: TableSchema | undefined): string | null {
  if (!schema) return null;

  for (const [column, definition] of Object.entries(schema)) {
    if (column === '_identity') continue;
    if (typeof definition !== 'string') continue;
    if (definition.toLowerCase().includes('primary key')) return column;
  }

  return null;
}

/** Return true when a table schema has the named SQL column. */
export function tableHasColumn(schema: TableSchema | undefined, column: string): boolean {
  if (!schema) return false;
  return typeof schema[column] === 'string';
}

/** Return real SQL column names from a table schema, excluding Zero metadata. */
export function getResourceTableColumns(schema: TableSchema | undefined): string[] {
  if (!schema) return [];

  return Object.entries(schema)
    .filter(([key, value]) => key !== '_identity' && typeof value === 'string')
    .map(([key]) => key);
}
