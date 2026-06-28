/**
 * schema-loader.ts
 *
 * Loads app-declared table schemas from a module path for doctor/plan CLI use.
 * This file owns module-shape normalization only.
 */

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { TableSchema } from '../sync/types';

/** Load declared server tables from a TypeScript/JavaScript module. */
export async function loadDeclaredTables(modulePath: string): Promise<Record<string, TableSchema>> {
  const absolute = resolve(modulePath);
  const module = await import(`${pathToFileURL(absolute).href}?t=${Date.now()}`);
  const candidate = module.tables ?? module.serverTables ?? module.schema ?? module.default;
  const tables = extractTables(candidate);

  if (!tables) {
    throw new Error(
      `[migrations] Could not find exported tables in ${modulePath}. ` +
      'Export `tables`, `serverTables`, a schema() result, or a default table map.'
    );
  }

  return tables;
}

function extractTables(value: unknown): Record<string, TableSchema> | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;

  if (isTableMap(record)) return normalizeTableMap(record);
  if (record.serverTables && isTableMap(record.serverTables as Record<string, unknown>)) {
    return normalizeTableMap(record.serverTables as Record<string, unknown>);
  }
  if (record.tables && isTableMap(record.tables as Record<string, unknown>)) {
    return normalizeTableMap(record.tables as Record<string, unknown>);
  }

  return null;
}

function isTableMap(value: Record<string, unknown>): boolean {
  return Object.values(value).every((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const table = entry as Record<string, unknown>;
    return Boolean(table.serverTable) || Object.values(table).some((column) => typeof column === 'string');
  });
}

function normalizeTableMap(value: Record<string, unknown>): Record<string, TableSchema> {
  const tables: Record<string, TableSchema> = {};

  for (const [name, entry] of Object.entries(value)) {
    const table = entry as Record<string, unknown>;
    tables[name] = (table.serverTable ?? table) as TableSchema;
  }

  return tables;
}
