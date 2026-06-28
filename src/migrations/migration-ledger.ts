/**
 * migration-ledger.ts
 *
 * Append-only migration event ledger. This file owns persistence of migration
 * run/rollback/failure records and legacy `_migrations` import.
 */

import type { Database } from 'bun:sqlite';
import type {
  Migration,
  MigrationDirection,
  MigrationEventStatus,
  MigrationLedgerRecord,
  MigrationSafety,
} from './types';

interface LegacyMigrationRecord {
  version: string;
  description: string;
  applied_at: string;
  checksum: string;
  duration_ms: number;
}

export class MigrationLedger {
  constructor(private readonly db: Database) {
    this.ensureTables();
    this.importLegacyRecords();
  }

  /** Return the latest event per migration version. */
  latestByVersion(): Map<string, MigrationLedgerRecord> {
    const rows = this.db
      .prepare('SELECT * FROM _zero_migrations ORDER BY id ASC')
      .all() as MigrationLedgerRecord[];
    const latest = new Map<string, MigrationLedgerRecord>();
    for (const row of rows) latest.set(row.version, row);
    return latest;
  }

  /** Return versions whose latest event is applied. */
  appliedVersions(): Set<string> {
    const applied = new Set<string>();
    for (const [version, record] of this.latestByVersion()) {
      if (record.status === 'applied' && record.direction === 'up') {
        applied.add(version);
      }
    }
    return applied;
  }

  /** Return the next run batch number. */
  nextBatch(): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(batch), 0) + 1 AS next_batch FROM _zero_migrations')
      .get() as { next_batch: number };
    return row.next_batch;
  }

  /** Record a successful up migration. */
  recordApplied(params: RecordMigrationEventParams): void {
    this.record({ ...params, direction: 'up', status: 'applied', error: null });
    this.recordLegacyApplied(params);
  }

  /** Record a successful down migration. */
  recordRolledBack(params: RecordMigrationEventParams): void {
    this.record({ ...params, direction: 'down', status: 'rolled_back', error: null });
  }

  /** Record a failed migration attempt. */
  recordFailed(params: RecordMigrationEventParams & {
    direction: MigrationDirection;
    error: string;
  }): void {
    this.record({ ...params, status: 'failed' });
  }

  private ensureTables(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS _zero_migrations (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        version     TEXT NOT NULL,
        description TEXT NOT NULL,
        checksum    TEXT NOT NULL,
        safety      TEXT NOT NULL,
        direction   TEXT NOT NULL,
        batch       INTEGER NOT NULL,
        status      TEXT NOT NULL,
        applied_at  TEXT NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        error       TEXT,
        schema_hash TEXT
      )
    `);
    this.db.run('CREATE INDEX IF NOT EXISTS idx_zero_migrations_version ON _zero_migrations(version, id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_zero_migrations_batch ON _zero_migrations(batch)');

    // Kept for backward compatibility with existing tooling and app startup.
    this.db.run(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version     TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at  TEXT NOT NULL,
        checksum    TEXT NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0
      )
    `);
  }

  private importLegacyRecords(): void {
    const hasZeroRows = (this.db
      .prepare('SELECT COUNT(*) AS count FROM _zero_migrations')
      .get() as { count: number }).count > 0;
    if (hasZeroRows) return;

    const legacy = this.db
      .prepare('SELECT * FROM _migrations ORDER BY version')
      .all() as LegacyMigrationRecord[];

    for (const record of legacy) {
      this.db.prepare(`
        INSERT INTO _zero_migrations
          (version, description, checksum, safety, direction, batch, status, applied_at, duration_ms, error, schema_hash)
        VALUES (?, ?, ?, 'safe', 'up', 0, 'applied', ?, ?, NULL, NULL)
      `).run(
        record.version,
        record.description,
        record.checksum,
        record.applied_at,
        record.duration_ms,
      );
    }
  }

  private record(params: PersistMigrationEventParams): void {
    this.db.prepare(`
      INSERT INTO _zero_migrations
        (version, description, checksum, safety, direction, batch, status, applied_at, duration_ms, error, schema_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?)
    `).run(
      params.migration.version,
      params.migration.description,
      params.checksum,
      params.safety,
      params.direction,
      params.batch,
      params.status,
      params.durationMs,
      params.error,
      params.schemaHash,
    );
  }

  private recordLegacyApplied(params: RecordMigrationEventParams): void {
    this.db.prepare(`
      INSERT INTO _migrations (version, description, applied_at, checksum, duration_ms)
      VALUES (?, ?, datetime('now'), ?, ?)
      ON CONFLICT(version) DO UPDATE SET
        description = excluded.description,
        checksum = excluded.checksum,
        duration_ms = excluded.duration_ms
    `).run(
      params.migration.version,
      params.migration.description,
      params.checksum,
      params.durationMs,
    );
  }
}

export interface RecordMigrationEventParams {
  migration: Migration;
  checksum: string;
  safety: MigrationSafety;
  batch: number;
  durationMs: number;
  schemaHash: string | null;
}

interface PersistMigrationEventParams extends RecordMigrationEventParams {
  direction: MigrationDirection;
  status: MigrationEventStatus;
  error: string | null;
}
