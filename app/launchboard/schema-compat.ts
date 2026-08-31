/**
 * schema-compat.ts
 *
 * Handles LaunchBoard-only local schema compatibility for the in-repo demo
 * app. This file may inspect and reset stale LaunchBoard tables before Zero
 * boots; it must not mutate platform/auth tables or own general migrations.
 */

import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';

import type { SQLiteStorageConfig } from '@zero/framework/server';

const LAUNCHBOARD_TABLES = [
  'launch_cards',
  'launch_columns',
  'launch_boards',
  'launch_categories',
] as const;

interface TableInfoRow {
  name: string;
}

/**
 * Reset stale anonymous LaunchBoard tables when the local demo database was
 * created before owner-scoped auth was introduced.
 *
 * The reset is intentionally narrow: only LaunchBoard tables are dropped, and
 * only when at least one existing LaunchBoard table lacks `owner_id`.
 */
export function resetLegacyLaunchBoardTables(config: SQLiteStorageConfig): void {
  for (const filePath of resolveDatabaseFiles(config)) {
    resetLegacyLaunchBoardFile(filePath);
  }
}

/** Create LaunchBoard owner indexes on the active app database. */
export function ensureLaunchBoardIndexes(db: Database): void {
  db.run('CREATE INDEX IF NOT EXISTS idx_launch_categories_owner ON launch_categories(owner_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_launch_boards_owner ON launch_boards(owner_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_launch_columns_owner ON launch_columns(owner_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_launch_cards_owner ON launch_cards(owner_id)');
}

function resolveDatabaseFiles(config: SQLiteStorageConfig): string[] {
  if (config.mode === 'ephemeral' || config.mode === 'memory' || config.mode === ':memory:') {
    return [];
  }

  const files = new Set<string>();
  if (config.path) files.add(config.path);
  if (config.snapshotPath) files.add(config.snapshotPath);
  return [...files];
}

function resetLegacyLaunchBoardFile(filePath: string): void {
  if (!existsSync(filePath)) return;

  const db = new Database(filePath, { create: false, readwrite: true });
  try {
    if (!needsLaunchBoardReset(db)) return;

    for (const table of LAUNCHBOARD_TABLES) {
      db.run(`DROP TABLE IF EXISTS ${table}`);
    }

    if (tableExists(db, '_changes')) {
      const placeholders = LAUNCHBOARD_TABLES.map(() => '?').join(', ');
      db.prepare(`DELETE FROM _changes WHERE tbl IN (${placeholders})`).run(...LAUNCHBOARD_TABLES);
    }

    db.run('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
}

function needsLaunchBoardReset(db: Database): boolean {
  for (const table of LAUNCHBOARD_TABLES) {
    const columns = getTableColumns(db, table);
    if (columns.length > 0 && !columns.includes('owner_id')) return true;
  }

  return false;
}

function tableExists(db: Database, table: string): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(table) as TableInfoRow | null;
  return Boolean(row);
}

function getTableColumns(db: Database, table: string): string[] {
  if (!tableExists(db, table)) return [];
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as TableInfoRow[];
  return rows.map((row) => row.name);
}
