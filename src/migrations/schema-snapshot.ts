/**
 * schema-snapshot.ts
 *
 * Normalizes declared table schemas and hashes schema snapshots. This file is
 * pure data transformation; it does not inspect or mutate SQLite.
 */

import { createHash } from 'node:crypto';
import type { TableSchema } from '../sync/types';
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
      const isPrimaryKey = /\bprimary\s+key\b/i.test(value);
      if (isPrimaryKey && primaryKey === null) primaryKey = columnName;

      columns[columnName] = {
        name: columnName,
        definition,
        type: getDeclaredColumnType(value),
        notNull: /\bnot\s+null\b/i.test(value) || isPrimaryKey,
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
  return sql
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .toLowerCase();
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
  const match = /\bdefault\s+(.+?)(?:\s+(?:primary|not|null|unique|check|references|collate)\b|$)/i.exec(definition);
  return match?.[1]?.trim() ?? null;
}
