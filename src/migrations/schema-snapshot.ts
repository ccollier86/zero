/**
 * schema-snapshot.ts
 *
 * Normalizes declared table schemas and hashes schema snapshots. This file is
 * pure data transformation; it does not inspect or mutate SQLite.
 */

import { createHash } from 'node:crypto';
import type { TableSchema } from '../sync/types';
import {
  databaseColumnDefinitionDeclaresNotNull,
  databaseColumnDefinitionDeclaresPrimaryKey,
} from '../sync/row-identity';
import { inspectDeclaredColumnDefault } from './column-default-parser';
import type {
  Migration,
  SchemaColumnSnapshot,
  SchemaIndexSnapshot,
  SchemaSnapshot,
  SchemaTableSnapshot,
} from './types';

/** Normalize declared app/server tables into a stable snapshot shape. */
export function snapshotDeclaredTables(tables: Record<string, TableSchema>): SchemaSnapshot {
  const snapshot: SchemaSnapshot = { tables: {} };

  for (const tableName of Object.keys(tables).sort()) {
    const schema = tables[tableName];
    const identity = Array.isArray(schema._identity) ? [...schema._identity] : [];
    const columns: Record<string, SchemaColumnSnapshot> = {};
    const columnOrder: string[] = [];
    let primaryKey: string | null = null;

    for (const [columnName, value] of Object.entries(schema)) {
      if (columnName === '_identity' || typeof value !== 'string') continue;

      const definition = normalizeSql(value);
      const isPrimaryKey = databaseColumnDefinitionDeclaresPrimaryKey(value);
      if (isPrimaryKey && primaryKey === null) primaryKey = columnName;

      columns[columnName] = {
        name: columnName,
        definition,
        type: getDeclaredColumnType(value),
        notNull: databaseColumnDefinitionDeclaresNotNull(value) || isPrimaryKey,
        defaultValue: getDeclaredDefault(value),
        primaryKeyPosition: isPrimaryKey ? 1 : 0,
      };
      columnOrder.push(columnName);
    }

    const indexes: Record<string, SchemaIndexSnapshot> = {};
    if (identity.length > 0) {
      const indexName = `idx_${tableName}_identity`;
      indexes[indexName] = {
        name: indexName,
        columns: identity,
        unique: true,
        origin: 'identity',
        partial: false,
      };
    }

    snapshot.tables[tableName] = {
      name: tableName,
      columns,
      columnOrder,
      primaryKey,
      compositePrimaryKey: [],
      identity,
      indexes,
    };
  }

  return snapshot;
}

/** Hash a schema snapshot with stable key ordering. */
export function hashSchemaSnapshot(snapshot: SchemaSnapshot): string {
  return sha256(stableStringify(snapshot));
}

/** Compute the checksum stored for a migration definition. */
export function hashMigration(migration: Migration): string {
  return sha256(stableStringify({
    version: migration.version,
    description: migration.description,
    safety: migration.safety ?? 'safe',
    backupRequired: migration.backupRequired ?? false,
    up: migration.up.toString(),
    down: migration.down?.toString() ?? null,
  }));
}

/** Normalize SQL text enough for stable drift comparisons. */
export function normalizeSql(sql: string): string {
  let normalized = '';
  let pendingSpace = false;
  for (let index = 0; index < sql.length;) {
    const char = sql[index]!;
    const next = sql[index + 1];
    if (isSqliteWhitespace(char) || char === '\ufeff') {
      pendingSpace = normalized.length > 0;
      index += 1;
      continue;
    }
    if (char === '-' && next === '-') {
      if (pendingSpace && normalized.length > 0) normalized += ' ';
      normalized += '--\n';
      pendingSpace = false;
      index += 2;
      while (index < sql.length && sql[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = sql.indexOf('*/', index + 2);
      if (end === -1) return normalized;
      index = end + 2;
      pendingSpace = normalized.length > 0;
      continue;
    }
    if (isSqlQuoteOpener(char)) {
      const end = findQuotedTokenEnd(sql, index, char);
      if (end === null) return normalized;
      if (pendingSpace) normalized += ' ';
      normalized += sql.slice(index, end);
      pendingSpace = false;
      index = end;
      continue;
    }
    if (char === ',') {
      normalized += ',';
      pendingSpace = true;
      index += 1;
      continue;
    }
    if (char !== '\ufeff' && isSqlIdentifierStart(char)) {
      let end = index + 1;
      while (end < sql.length && isSqlIdentifierContinue(sql[end]!)) end += 1;
      if (pendingSpace) normalized += ' ';
      normalized += asciiLower(sql.slice(index, end));
      pendingSpace = false;
      index = end;
      continue;
    }
    if (pendingSpace) normalized += ' ';
    normalized += char;
    pendingSpace = false;
    index += 1;
  }
  return normalized;
}

/** Stable stringify for hashing and persisted schema history. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const object = value as Record<string, unknown>;
  const entries = Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`);
  return `{${entries.join(',')}}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function getDeclaredColumnType(definition: string): string {
  const first = definition.trim().split(/\s+/)[0] ?? '';
  return first.toLowerCase();
}

function getDeclaredDefault(definition: string): string | null {
  return inspectDeclaredColumnDefault(definition).value;
}

function findQuotedTokenEnd(
  definition: string,
  start: number,
  opener: string,
): number | null {
  const closer = opener === '[' ? ']' : opener;
  for (let index = start + 1; index < definition.length; index += 1) {
    if (definition[index] !== closer) continue;
    if (opener !== '[' && definition[index + 1] === closer) {
      index += 1;
      continue;
    }
    return index + 1;
  }
  return null;
}

function isSqlQuoteOpener(char: string): boolean {
  return char === "'" || char === '"' || char === '`' || char === '[';
}

function isSqlIdentifierStart(char: string): boolean {
  return /[A-Za-z_]/u.test(char) || char.charCodeAt(0) >= 0x80;
}

function isSqlIdentifierContinue(char: string): boolean {
  return /[A-Za-z0-9_$]/u.test(char) || char.charCodeAt(0) >= 0x80;
}

function isSqliteWhitespace(char: string): boolean {
  return char === ' '
    || char === '\t'
    || char === '\n'
    || char === '\f'
    || char === '\r';
}

function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) + 0x20));
}
