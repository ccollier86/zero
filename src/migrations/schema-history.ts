/**
 * schema-history.ts
 *
 * Persists normalized schema snapshots after successful migration events.
 * Snapshot creation and hashing live in schema-snapshot.ts.
 */

import type { Database } from 'bun:sqlite';
import { stableStringify } from './schema-snapshot';
import type { MigrationDirection, SchemaSnapshot } from './types';

export interface SchemaHistoryRecord {
  id: number;
  migration_version: string;
  direction: MigrationDirection;
  schema_hash: string;
  schema_json: string;
  created_at: string;
}

export class SchemaHistory {
  constructor(private readonly db: Database) {
    this.ensureTable();
  }

  /** Record the current schema snapshot for a migration event. */
  record(params: {
    migrationVersion: string;
    direction: MigrationDirection;
    schemaHash: string;
    snapshot: SchemaSnapshot;
  }): void {
    this.db.prepare(`
      INSERT INTO _zero_schema_history
        (migration_version, direction, schema_hash, schema_json, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(
      params.migrationVersion,
      params.direction,
      params.schemaHash,
      stableStringify(params.snapshot),
    );
  }

  /** Return the latest stored schema snapshot, if one exists. */
  latest(): SchemaHistoryRecord | null {
    return (this.db
      .prepare('SELECT * FROM _zero_schema_history ORDER BY id DESC LIMIT 1')
      .get() as SchemaHistoryRecord | null) ?? null;
  }

  private ensureTable(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS _zero_schema_history (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        migration_version TEXT NOT NULL,
        direction         TEXT NOT NULL,
        schema_hash       TEXT NOT NULL,
        schema_json       TEXT NOT NULL,
        created_at        TEXT NOT NULL
      )
    `);
    this.db.run('CREATE INDEX IF NOT EXISTS idx_zero_schema_history_migration ON _zero_schema_history(migration_version)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_zero_schema_history_hash ON _zero_schema_history(schema_hash)');
  }
}
