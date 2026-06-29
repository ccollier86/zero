/**
 * migrator.ts
 *
 * Standalone migration runner for the platform's SQLite databases.
 *
 * Design goals:
 *   1. Runs independently of the full server (no Elysia needed)
 *   2. Tracks applied migrations in a `_migrations` table
 *   3. Runs migrations inside transactions (atomic per-migration)
 *   4. Explicit WAL checkpoint after all migrations complete
 *   5. Supports both schema DDL and data migrations
 *   6. File-based migrations with numeric ordering (001_, 002_, etc.)
 *
 * Usage:
 *   bun run src/migrations/run.ts            # run pending
 *   bun run src/migrations/run.ts --status   # show applied/pending
 *   bun run src/migrations/run.ts --to 003   # run up to version 003
 */

import { Database } from 'bun:sqlite';
import { dirname, join } from 'node:path';
import { MigrationArtifacts } from './migration-artifacts';
import { createMigrationBackup } from './migration-backup';
import { MigrationLedger } from './migration-ledger';
import { SchemaHistory } from './schema-history';
import { inspectDatabaseSchema } from './schema-inspector';
import { hashMigration, hashSchemaSnapshot } from './schema-snapshot';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type {
  Migration,
  MigrationSafety,
  MigratorConfig,
  MigrationStatus,
} from './types';

export type {
  Migration,
  MigrationSafety,
  MigratorConfig,
  MigrationStatus,
} from './types';

// ─── Migrator ─────────────────────────────────────────────────────────────

export class Migrator {
  private db: Database;
  private migrations: Migration[];
  private log: (...args: unknown[]) => void;
  private dbPath: string;
  private allowDestructive: boolean;
  private allowDestructiveDown: boolean;
  private backupDir: string;
  private createBackups: boolean;
  private ledger: MigrationLedger;
  private history: SchemaHistory;
  private artifacts: MigrationArtifacts;

  constructor(config: MigratorConfig) {
    this.db = new Database(config.dbPath);
    this.dbPath = config.dbPath;
    this.migrations = config.migrations;
    this.log = config.log ?? defaultMigratorLog;
    this.allowDestructive = config.allowDestructive ?? false;
    this.allowDestructiveDown = config.allowDestructiveDown ?? false;
    this.backupDir = config.backupDir ?? join(dirname(config.dbPath), 'backups');
    this.createBackups = config.createBackups ?? true;

    if (config.applyPragmas !== false) {
      this.applyPragmas();
    }

    this.ledger = new MigrationLedger(this.db);
    this.history = new SchemaHistory(this.db);
    this.artifacts = new MigrationArtifacts(this.db);
  }

  // ─── Public API ───────────────────────────────────────────────────────

  /**
   * Run all pending migrations up to `toVersion` (inclusive).
   * If `toVersion` is omitted, runs all pending.
   *
   * Each migration runs in its own transaction. If a migration fails,
   * it rolls back that single migration and throws — previously applied
   * migrations in this run remain committed.
   *
   * Returns the list of versions that were applied.
   */
  run(toVersion?: string): string[] {
    const applied = this.ledger.appliedVersions();
    const pending = this.migrations.filter((m) => !applied.has(m.version));

    if (pending.length === 0) {
      this.log('[migrator] All migrations already applied');
      this.checkpoint();
      return [];
    }

    const target = toVersion
      ? pending.filter((m) => m.version <= toVersion)
      : pending;

    if (target.length === 0) {
      this.log('[migrator] No pending migrations up to version', toVersion);
      this.checkpoint();
      return [];
    }

    const appliedVersions: string[] = [];
    const batch = this.ledger.nextBatch();

    for (const migration of target) {
      const safety = getMigrationSafety(migration);
      this.assertCanRunMigration(migration, safety);
      this.backupIfNeeded(migration, safety);
      this.log(`[migrator] Applying ${migration.version}: ${migration.description}`);
      const start = performance.now();
      const checksum = hashMigration(migration);

      // Each migration is atomic — success or full rollback
      const txn = this.db.transaction(() => {
        migration.up(this.db);

        const durationMs = Math.round(performance.now() - start);
        const snapshot = inspectDatabaseSchema(this.db);
        const schemaHash = hashSchemaSnapshot(snapshot);
        this.ledger.recordApplied({
          migration,
          checksum,
          safety,
          batch,
          durationMs,
          schemaHash,
        });
        this.history.record({
          migrationVersion: migration.version,
          direction: 'up',
          schemaHash,
          snapshot,
        });

        return durationMs;
      });

      try {
        const durationMs = txn();
        appliedVersions.push(migration.version);
        this.log(`[migrator]   ✓ ${migration.version} (${durationMs}ms)`);
      } catch (err) {
        this.log(`[migrator]   ✗ ${migration.version} FAILED:`, err);
        this.ledger.recordFailed({
          migration,
          checksum,
          safety,
          batch,
          durationMs: Math.round(performance.now() - start),
          schemaHash: null,
          direction: 'up',
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    }

    // Explicit WAL checkpoint after all migrations
    this.checkpoint();

    this.log(
      `[migrator] Done. Applied ${appliedVersions.length} migration(s):`,
      appliedVersions.join(', '),
    );
    return appliedVersions;
  }

  /**
   * Roll back applied migrations down to `toVersion` (exclusive).
   * If omitted, rolls back only the latest applied migration.
   */
  rollback(toVersion?: string): string[] {
    const latest = this.ledger.latestByVersion();
    const applied = this.migrations.filter((migration) => {
      const record = latest.get(migration.version);
      return record?.status === 'applied' && record.direction === 'up';
    });
    const target = toVersion
      ? applied.filter((migration) => migration.version > toVersion)
      : applied.slice(-1);
    const rollbackList = target.reverse();

    if (rollbackList.length === 0) {
      this.log('[migrator] No applied migrations to roll back');
      this.checkpoint();
      return [];
    }

    const batch = this.ledger.nextBatch();
    const rolledBack: string[] = [];

    for (const migration of rollbackList) {
      if (!migration.down) {
        throw new Error(`[migrator] Migration ${migration.version} has no down() rollback.`);
      }

      const safety = migration.downSafety ?? 'destructive';
      if (isDestructive(safety) && !this.allowDestructiveDown) {
        throw new Error(
          `[migrator] Rollback for ${migration.version} is ${safety}. ` +
          'Re-run with --allow-destructive-down to confirm.'
        );
      }

      this.backupIfNeeded(migration, safety);
      this.log(`[migrator] Rolling back ${migration.version}: ${migration.description}`);
      const start = performance.now();
      const checksum = hashMigration(migration);

      const txn = this.db.transaction(() => {
        migration.down!(this.db);
        const durationMs = Math.round(performance.now() - start);
        const snapshot = inspectDatabaseSchema(this.db);
        const schemaHash = hashSchemaSnapshot(snapshot);
        this.ledger.recordRolledBack({
          migration,
          checksum,
          safety,
          batch,
          durationMs,
          schemaHash,
        });
        this.history.record({
          migrationVersion: migration.version,
          direction: 'down',
          schemaHash,
          snapshot,
        });
        return durationMs;
      });

      try {
        const durationMs = txn();
        rolledBack.push(migration.version);
        this.log(`[migrator]   ↶ ${migration.version} (${durationMs}ms)`);
      } catch (err) {
        this.ledger.recordFailed({
          migration,
          checksum,
          safety,
          batch,
          durationMs: Math.round(performance.now() - start),
          schemaHash: null,
          direction: 'down',
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    }

    this.checkpoint();
    return rolledBack;
  }

  /**
   * Get the status of all known migrations (applied and pending).
   */
  status(): MigrationStatus[] {
    const applied = this.ledger.latestByVersion();

    return this.migrations.map((m) => {
      const record = applied.get(m.version);
      const checksum = hashMigration(m);
      const isApplied = record?.status === 'applied' && record.direction === 'up';
      return {
        version: m.version,
        description: m.description,
        applied: isApplied,
        appliedAt: record?.applied_at ?? null,
        durationMs: record?.duration_ms ?? null,
        safety: getMigrationSafety(m),
        checksum,
        storedChecksum: record?.checksum ?? null,
        checksumMatches: record ? record.checksum === checksum : null,
        hasDown: typeof m.down === 'function',
        lastStatus: record?.status ?? null,
      };
    });
  }

  /**
   * Canonical list alias for migration status rows.
   */
  list(): MigrationStatus[] {
    return this.status();
  }

  /**
   * Force a WAL checkpoint — flushes all WAL pages to the main database file.
   * Call this after migrations or before clean shutdown.
   */
  checkpoint(): void {
    const result = this.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as
      | { busy: number; checkpointed: number; log: number }
      | null;

    if (result && result.busy > 0) {
      this.log('[migrator] WAL checkpoint: some pages busy, retrying with PASSIVE...');
      this.db.run('PRAGMA wal_checkpoint(PASSIVE)');
    } else {
      this.log('[migrator] WAL checkpoint complete');
    }
  }

  /**
   * Close the database. Always call after migrations are done.
   */
  dispose(): void {
    this.checkpoint();
    this.db.close();
  }

  /**
   * Expose the raw Database for advanced use (e.g., running raw SQL checks).
   */
  get database(): Database {
    return this.db;
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private applyPragmas(): void {
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('PRAGMA synchronous = NORMAL');
    this.db.run('PRAGMA foreign_keys = ON');
  }

  private assertCanRunMigration(migration: Migration, safety: MigrationSafety): void {
    if (isDestructive(safety) && !this.allowDestructive) {
      throw new Error(
        `[migrator] Migration ${migration.version} is ${safety}. ` +
        'Re-run with --allow-destructive to confirm.'
      );
    }
    if (migration.backupRequired && !this.createBackups && isFileBacked(this.dbPath)) {
      throw new Error(
        `[migrator] Migration ${migration.version} requires a backup. ` +
        'Enable backups or run only in a disposable environment.'
      );
    }
  }

  private backupIfNeeded(migration: Migration, safety: MigrationSafety): void {
    const needsBackup = migration.backupRequired || isDestructive(safety);
    if (!needsBackup || !this.createBackups || !isFileBacked(this.dbPath)) return;

    const backup = createMigrationBackup(this.dbPath, this.backupDir, migration.version);
    if (backup) {
      this.artifacts.record({
        migrationVersion: migration.version,
        kind: 'backup',
        path: backup.path,
        hash: backup.hash,
      });
      this.log(`[migrator] Backup created: ${backup.path}`);
    }
  }
}

function getMigrationSafety(migration: Migration): MigrationSafety {
  return migration.safety ?? 'safe';
}

function isDestructive(safety: MigrationSafety): boolean {
  return safety === 'destructive' || safety === 'manual';
}

function isFileBacked(dbPath: string): boolean {
  return dbPath !== ':memory:' && dbPath !== 'memory';
}

function defaultMigratorLog(...args: unknown[]): void {
  emitPlatformCode(OBS_CODES.MIGRATOR_LOG, {
    message: args.map(String).join(' '),
  });
}
