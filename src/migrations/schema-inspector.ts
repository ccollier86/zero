/**
 * schema-inspector.ts
 *
 * Reads the actual SQLite schema into the migration snapshot shape. This file
 * owns database introspection only; comparison and planning live elsewhere.
 */

import type { Database } from 'bun:sqlite';
import { normalizeSql } from './schema-snapshot';
import type {
  SchemaColumnSnapshot,
  SchemaIndexSnapshot,
  SchemaSnapshot,
  SchemaTableSnapshot,
} from './types';

interface SqliteTableRow {
  name: string;
  sql: string | null;
}

interface TableInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface IndexListRow {
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

interface IndexInfoRow {
  seqno: number;
  cid: number;
  name: string;
}

export interface InspectSchemaOptions {
  /** Include platform/internal tables beginning with `_`. Default: true. */
  includeInternal?: boolean;
}

/** Inspect the live SQLite schema. */
export function inspectDatabaseSchema(
  db: Database,
  options: InspectSchemaOptions = {},
): SchemaSnapshot {
  const includeInternal = options.includeInternal ?? true;
  const tableRows = db
    .prepare(`
      SELECT name, sql
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `)
    .all() as SqliteTableRow[];

  const snapshot: SchemaSnapshot = { tables: {} };

  for (const tableRow of tableRows) {
    if (!includeInternal && tableRow.name.startsWith('_')) continue;
    snapshot.tables[tableRow.name] = inspectTable(db, tableRow);
  }

  return snapshot;
}

function inspectTable(db: Database, tableRow: SqliteTableRow): SchemaTableSnapshot {
  const tableName = tableRow.name;
  const createSql = tableRow.sql ?? undefined;
  const rawColumnDefinitions = parseCreateTableColumnDefinitions(createSql);
  const info = db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all() as TableInfoRow[];
  const columns: Record<string, SchemaColumnSnapshot> = {};
  const columnOrder: string[] = [];
  const compositePrimaryKey = info
    .filter((row) => row.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((row) => row.name);

  for (const row of info) {
    const definition = rawColumnDefinitions.get(row.name) ?? buildColumnDefinition(row);
    columns[row.name] = {
      name: row.name,
      definition: normalizeSql(definition),
      type: row.type.toLowerCase(),
      notNull: row.notnull === 1 || row.pk > 0,
      defaultValue: row.dflt_value,
      primaryKeyPosition: row.pk,
    };
    columnOrder.push(row.name);
  }

  const indexes = inspectIndexes(db, tableName);

  return {
    name: tableName,
    columns,
    columnOrder,
    primaryKey: compositePrimaryKey.length === 1 ? compositePrimaryKey[0] : null,
    compositePrimaryKey,
    identity: inferIdentity(tableName, indexes),
    indexes,
    createSql,
  };
}

function inspectIndexes(db: Database, tableName: string): Record<string, SchemaIndexSnapshot> {
  const rows = db.prepare(`PRAGMA index_list(${quoteIdentifier(tableName)})`).all() as IndexListRow[];
  const indexes: Record<string, SchemaIndexSnapshot> = {};

  for (const row of rows) {
    const columns = (db.prepare(`PRAGMA index_info(${quoteIdentifier(row.name)})`).all() as IndexInfoRow[])
      .sort((a, b) => a.seqno - b.seqno)
      .map((info) => info.name);

    indexes[row.name] = {
      name: row.name,
      columns,
      unique: row.unique === 1,
      origin: row.origin,
      partial: row.partial === 1,
    };
  }

  return indexes;
}

function inferIdentity(
  tableName: string,
  indexes: Record<string, SchemaIndexSnapshot>,
): string[] {
  const identityIndex = indexes[`idx_${tableName}_identity`];
  return identityIndex?.unique ? [...identityIndex.columns] : [];
}

function buildColumnDefinition(row: TableInfoRow): string {
  const parts = [row.type || ''];
  if (row.pk > 0) parts.push('primary key');
  if (row.notnull === 1) parts.push('not null');
  if (row.dflt_value !== null) parts.push(`default ${row.dflt_value}`);
  return parts.filter(Boolean).join(' ');
}

function parseCreateTableColumnDefinitions(sql: string | undefined): Map<string, string> {
  const definitions = new Map<string, string>();
  if (!sql) return definitions;

  const start = sql.indexOf('(');
  const end = sql.lastIndexOf(')');
  if (start === -1 || end === -1 || end <= start) return definitions;

  for (const part of splitTopLevel(sql.slice(start + 1, end))) {
    const trimmed = part.trim();
    if (!trimmed || isTableConstraint(trimmed)) continue;

    const match = /^("[^"]+"|`[^`]+`|\[[^\]]+\]|\S+)\s+([\s\S]+)$/.exec(trimmed);
    if (!match) continue;

    const columnName = unquoteIdentifier(match[1]);
    definitions.set(columnName, match[2].trim());
  }

  return definitions;
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];

    if (quote) {
      current += char;
      if (char === quote) {
        if (next === quote) {
          current += next;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      current += char;
      continue;
    }

    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;

    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) parts.push(current);
  return parts;
}

function isTableConstraint(value: string): boolean {
  return /^(constraint|primary\s+key|foreign\s+key|unique|check)\b/i.test(value);
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function unquoteIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('`') && trimmed.endsWith('`')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  return trimmed;
}
