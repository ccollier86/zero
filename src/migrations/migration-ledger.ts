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

  /** Return the latest event for one migration version. */
  latestForVersion(version: string): MigrationLedgerRecord | null {
    return (this.db.prepare(`
      SELECT * FROM _zero_migrations
      WHERE version = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(version) as MigrationLedgerRecord | null) ?? null;
  }

  /**
   * Return the durable migration state, ignoring failed attempts. A failed
   * rollback does not make an applied migration pending, and a failed retry
   * does not erase the last successful up/down event.
   */
  stateByVersion(): Map<string, MigrationLedgerRecord> {
    const rows = this.db.prepare(`
      SELECT * FROM _zero_migrations
      WHERE status IN ('applied', 'rolled_back')
      ORDER BY id ASC
    `).all() as MigrationLedgerRecord[];
    const state = new Map<string, MigrationLedgerRecord>();
    for (const row of rows) state.set(row.version, row);
    return state;
  }

  /** Return the durable state for one migration version. */
  stateForVersion(version: string): MigrationLedgerRecord | null {
    return (this.db.prepare(`
      SELECT * FROM _zero_migrations
      WHERE version = ? AND status IN ('applied', 'rolled_back')
      ORDER BY id DESC
      LIMIT 1
    `).get(version) as MigrationLedgerRecord | null) ?? null;
  }

  /** Return versions whose latest event is applied. */
  appliedVersions(): Set<string> {
    const applied = new Set<string>();
    for (const [version, record] of this.stateByVersion()) {
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
    this.db.prepare('DELETE FROM _migrations WHERE version = ?')
      .run(params.migration.version);
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
    const importLegacy = this.db.transaction(() => {
      // Reconcile each legacy-only version while holding SQLite's writer lock.
      // The per-version check handles partially imported databases and prevents
      // two concurrently constructed migrators from duplicating imported rows.
      const legacy = this.db
        .prepare('SELECT * FROM _migrations ORDER BY version')
        .all() as LegacyMigrationRecord[];

      for (const record of legacy) {
        const alreadyImported = this.db.prepare(`
          SELECT 1 FROM _zero_migrations WHERE version = ? LIMIT 1
        `).get(record.version);
        if (alreadyImported) continue;

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

      // The event ledger is authoritative once it knows a version. Repair the
      // compatibility table as well as importing from it: older Zero releases
      // did not remove `_migrations` rows after a successful rollback.
      for (const [version, state] of this.stateByVersion()) {
        if (state.status === 'applied' && state.direction === 'up') {
          this.db.prepare(`
            INSERT INTO _migrations
              (version, description, applied_at, checksum, duration_ms)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(version) DO UPDATE SET
              description = excluded.description,
              checksum = excluded.checksum,
              duration_ms = excluded.duration_ms
            WHERE _migrations.description IS NOT excluded.description
               OR _migrations.checksum IS NOT excluded.checksum
               OR _migrations.duration_ms IS NOT excluded.duration_ms
          `).run(
            version,
            state.description,
            state.applied_at,
            state.checksum,
            state.duration_ms,
          );
        } else {
          this.db.prepare('DELETE FROM _migrations WHERE version = ?').run(version);
        }
      }
    });
    importLegacy.immediate();
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
