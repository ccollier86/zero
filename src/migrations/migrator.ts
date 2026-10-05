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
import { unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MigrationArtifacts } from './migration-artifacts';
import { createMigrationBackup, type MigrationBackup } from './migration-backup';
import { MigrationLedger } from './migration-ledger';
import { SchemaHistory } from './schema-history';
import { inspectDatabaseSchema } from './schema-inspector';
import { hashMigration, hashSchemaSnapshot } from './schema-snapshot';
import {
  assertSynchronousMigrationHandler,
  runSynchronousMigrationHandler,
} from './migration-handler-boundary';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type {
  Migration,
  MigrationLedgerRecord,
  MigrationRegistry,
  MigrationSafety,
  MigratorConfig,
  MigrationStatus,
} from './types';

export type {
  Migration,
  MigrationRegistry,
  MigrationSafety,
  MigratorConfig,
  MigrationStatus,
} from './types';

// ─── Migrator ─────────────────────────────────────────────────────────────

export class Migrator {
  private db: Database;
  private readonly migrations: MigrationRegistry;
  private log: (...args: unknown[]) => void;
  private dbPath: string;
  private ownsDatabase: boolean;
  private allowDestructive: boolean;
  private allowDestructiveDown: boolean;
  private backupDir: string;
  private createBackups: boolean;
  private busyTimeoutMs: number;
  private ledger: MigrationLedger;
  private history: SchemaHistory;
  private artifacts: MigrationArtifacts;

  constructor(config: MigratorConfig) {
    if (!config.database && !config.dbPath) {
      throw new Error('[migrator] dbPath is required when database is not provided.');
    }
    const migrations = createMigrationRegistry(config.migrations);
    this.busyTimeoutMs = normalizeBusyTimeout(config.busyTimeoutMs ?? 30_000);

    this.db = config.database ?? new Database(config.dbPath!);
    this.dbPath = config.dbPath ?? ':memory:';
    this.ownsDatabase = config.database ? config.ownsDatabase ?? false : true;
    this.migrations = migrations;
    this.log = config.log ?? defaultMigratorLog;
    this.allowDestructive = config.allowDestructive ?? false;
    this.allowDestructiveDown = config.allowDestructiveDown ?? false;
    this.backupDir = config.backupDir ?? join(dirname(this.dbPath), 'backups');
    this.createBackups = config.createBackups ?? true;

    try {
      // busy_timeout is connection-local and is required even when callers opt
      // out of the other platform pragmas. Concurrent replicas serialize on an
      // IMMEDIATE migration transaction instead of failing on a transient lock.
      this.db.run(`PRAGMA busy_timeout = ${this.busyTimeoutMs}`);

      if (config.applyPragmas ?? !config.database) {
        this.applyPragmas();
      }

      this.ledger = new MigrationLedger(this.db);
      this.history = new SchemaHistory(this.db);
      this.artifacts = new MigrationArtifacts(this.db);
    } catch (error) {
      if (this.ownsDatabase) {
        try {
          this.db.close();
        } catch {
          // Preserve the initialization failure rather than masking it.
        }
      }
      throw error;
    }
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
    const durableStates = this.ledger.stateByVersion();
    this.assertRegistryCoversDurableStates(durableStates);
    for (const migration of this.migrations) {
      const state = durableStates.get(migration.version);
      if (state) {
        assertMigrationChecksum(migration, hashMigration(migration), state.checksum);
      }
    }
    const applied = new Set(
      [...durableStates]
        .filter(([, state]) => isAppliedState(state))
        .map(([version]) => version),
    );
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
    let batch: number | null = null;

    for (const migration of target) {
      const safety = getMigrationSafety(migration);
      this.assertCanRunMigration(migration, safety);
      const backup = this.backupIfNeeded(migration, safety);
      this.log(`[migrator] Applying ${migration.version}: ${migration.description}`);
      const start = performance.now();
      const checksum = hashMigration(migration);
      let attemptStarted = false;
      let attemptBatch: number | null = null;

      // Each migration is atomic — success or full rollback
      const txn = this.db.transaction((): MigrationAttemptResult => {
        const state = this.ledger.stateForVersion(migration.version);
        if (state) assertMigrationChecksum(migration, checksum, state.checksum);
        if (isAppliedState(state)) {
          return { changed: false, durationMs: state.duration_ms };
        }
        this.assertForwardDependenciesApplied(migration);

        attemptBatch = batch ?? this.ledger.nextBatch();
        batch = attemptBatch;
        attemptStarted = true;
        if (backup) this.recordBackupArtifact(migration, backup);
        runSynchronousMigrationHandler(migration.up, this.db, 'up', migration);

        const durationMs = Math.round(performance.now() - start);
        const snapshot = inspectDatabaseSchema(this.db);
        const schemaHash = hashSchemaSnapshot(snapshot);
        this.ledger.recordApplied({
          migration,
          checksum,
          safety,
          batch: attemptBatch,
          durationMs,
          schemaHash,
        });
        this.history.record({
          migrationVersion: migration.version,
          direction: 'up',
          schemaHash,
          snapshot,
        });

        return { changed: true, durationMs };
      });

      try {
        const result = txn.immediate();
        if (result.changed) {
          appliedVersions.push(migration.version);
          this.log(`[migrator]   ✓ ${migration.version} (${result.durationMs}ms)`);
        } else {
          this.discardUnusedBackup(backup);
          this.log(`[migrator]   ↷ ${migration.version} already applied by another runner`);
        }
      } catch (err) {
        this.log(`[migrator]   ✗ ${migration.version} FAILED:`, err);
        if (attemptStarted && attemptBatch !== null) {
          this.tryRecordFailureUnlessSuperseded({
            migration,
            checksum,
            safety,
            batch: attemptBatch,
            durationMs: Math.round(performance.now() - start),
            schemaHash: null,
            direction: 'up',
            error: err instanceof Error ? err.message : String(err),
          }, backup);
        } else {
          this.discardUnusedBackup(backup);
        }
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
    const latest = this.ledger.stateByVersion();
    this.assertRegistryCoversDurableStates(latest);
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

    let batch: number | null = null;
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

      const backup = this.backupIfNeeded(migration, safety);
      this.log(`[migrator] Rolling back ${migration.version}: ${migration.description}`);
      const start = performance.now();
      const checksum = hashMigration(migration);
      let attemptStarted = false;
      let attemptBatch: number | null = null;

      const txn = this.db.transaction((): MigrationAttemptResult => {
        const state = this.ledger.stateForVersion(migration.version);
        if (!isAppliedState(state)) {
          return { changed: false, durationMs: state?.duration_ms ?? 0 };
        }
        assertMigrationChecksum(migration, checksum, state.checksum);
        this.assertRollbackDependenciesCleared(migration);

        attemptBatch = batch ?? this.ledger.nextBatch();
        batch = attemptBatch;
        attemptStarted = true;
        if (backup) this.recordBackupArtifact(migration, backup);
        runSynchronousMigrationHandler(migration.down!, this.db, 'down', migration);
        const durationMs = Math.round(performance.now() - start);
        const snapshot = inspectDatabaseSchema(this.db);
        const schemaHash = hashSchemaSnapshot(snapshot);
        this.ledger.recordRolledBack({
          migration,
          checksum,
          safety,
          batch: attemptBatch,
          durationMs,
          schemaHash,
        });
        this.history.record({
          migrationVersion: migration.version,
          direction: 'down',
          schemaHash,
          snapshot,
        });
        return { changed: true, durationMs };
      });

      try {
        const result = txn.immediate();
        if (result.changed) {
          rolledBack.push(migration.version);
          this.log(`[migrator]   ↶ ${migration.version} (${result.durationMs}ms)`);
        } else {
          this.discardUnusedBackup(backup);
          this.log(`[migrator]   ↷ ${migration.version} already rolled back by another runner`);
        }
      } catch (err) {
        if (attemptStarted && attemptBatch !== null) {
          this.tryRecordFailureUnlessSuperseded({
            migration,
            checksum,
            safety,
            batch: attemptBatch,
            durationMs: Math.round(performance.now() - start),
            schemaHash: null,
            direction: 'down',
            error: err instanceof Error ? err.message : String(err),
          }, backup);
        } else {
          this.discardUnusedBackup(backup);
        }
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
    const events = this.ledger.latestByVersion();
    const states = this.ledger.stateByVersion();

    return this.migrations.map((m) => {
      const event = events.get(m.version);
      const state = states.get(m.version);
      const checksum = hashMigration(m);
      const isApplied = isAppliedState(state);
      return {
        version: m.version,
        description: m.description,
        applied: isApplied,
        appliedAt: state?.applied_at ?? null,
        durationMs: state?.duration_ms ?? null,
        safety: getMigrationSafety(m),
        checksum,
        storedChecksum: state?.checksum ?? event?.checksum ?? null,
        checksumMatches: state
          ? state.checksum === checksum
          : event
            ? event.checksum === checksum
            : null,
        hasDown: typeof m.down === 'function',
        lastStatus: event?.status ?? null,
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
    let result: { busy: number; checkpointed: number; log: number } | null;
    try {
      result = this.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as
        | { busy: number; checkpointed: number; log: number }
        | null;
    } catch {
      this.log('[migrator] WAL checkpoint skipped for non-WAL database');
      return;
    }

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
    if (this.ownsDatabase) this.db.close();
  }

  /**
   * Expose the raw Database for advanced use (e.g., running raw SQL checks).
   */
  get database(): Database {
    return this.db;
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private applyPragmas(): void {
    // SQLite's journal_mode transition can return SQLITE_BUSY immediately even
    // with busy_timeout configured. Retry that connection-initialization edge
    // so simultaneous replica startup reaches the serialized migration lock.
    this.runWithBusyRetry(() => this.db.run('PRAGMA journal_mode = WAL'));
    this.db.run('PRAGMA synchronous = NORMAL');
    this.db.run('PRAGMA foreign_keys = ON');
  }

  private runWithBusyRetry(operation: () => void): void {
    const deadline = performance.now() + this.busyTimeoutMs;
    while (true) {
      try {
        operation();
        return;
      } catch (error) {
        if (!isSqliteBusy(error) || performance.now() >= deadline) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
  }

  private tryRecordFailureUnlessSuperseded(
    params: Parameters<MigrationLedger['recordFailed']>[0],
    backup: MigrationBackup | null,
  ): void {
    try {
      const recordFailure = this.db.transaction(() => {
        if (backup) this.recordBackupArtifact(params.migration, backup);
        const state = this.ledger.stateForVersion(params.migration.version);
        const reachedTarget = params.direction === 'up'
          ? isAppliedState(state)
          : state !== null && !isAppliedState(state);
        if (reachedTarget) return;
        this.ledger.recordFailed(params);
      });
      recordFailure.immediate();
    } catch (recordError) {
      // A secondary audit-write failure must not replace the migration error
      // that the caller needs in order to diagnose or recover the schema.
      this.log('[migrator] Could not record failed migration event:', recordError);
    }
  }

  private assertForwardDependenciesApplied(migration: Migration): void {
    const index = this.migrations.indexOf(migration);
    const states = this.ledger.stateByVersion();
    for (const dependency of this.migrations.slice(0, index)) {
      if (isAppliedState(states.get(dependency.version))) continue;
      throw new Error(
        `[migrator] Cannot apply ${migration.version} while earlier migration ` +
        `${dependency.version} is not applied. Another migration operation may ` +
        'have changed the database; retry after it finishes.',
      );
    }
  }

  private assertRegistryCoversDurableStates(
    states: Map<string, MigrationLedgerRecord>,
  ): void {
    const configured = new Set(this.migrations.map((migration) => migration.version));
    for (const [version, state] of states) {
      if (configured.has(version)) continue;
      const detail = isAppliedState(state)
        ? `unknown applied migration ${version}`
        : `unknown recorded migration ${version}`;
      throw new Error(
        `[migrator] Database contains ${detail} that is not present in this registry. ` +
        'Use the complete migration registry from the database\'s current release.',
      );
    }
  }

  private assertRollbackDependenciesCleared(migration: Migration): void {
    const index = this.migrations.indexOf(migration);
    const configuredIndexes = new Map(
      this.migrations.map((entry, entryIndex) => [entry.version, entryIndex]),
    );
    for (const [version, state] of this.ledger.stateByVersion()) {
      if (!isAppliedState(state) || version === migration.version) continue;
      const appliedIndex = configuredIndexes.get(version);
      if (appliedIndex !== undefined && appliedIndex < index) continue;

      const detail = appliedIndex === undefined
        ? `unknown applied migration ${version}`
        : `later applied migration ${version}`;
      throw new Error(
        `[migrator] Cannot roll back ${migration.version} while ${detail} remains applied. ` +
        'Another migration operation may have changed the database; retry with the complete ' +
        'migration registry after it finishes.',
      );
    }
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

  private backupIfNeeded(
    migration: Migration,
    safety: MigrationSafety,
  ): MigrationBackup | null {
    const needsBackup = migration.backupRequired || isDestructive(safety);
    if (!needsBackup || !this.createBackups || !isFileBacked(this.dbPath)) return null;

    const backup = createMigrationBackup(
      this.db, this.dbPath, this.backupDir, migration.version,
    );
    if (backup) {
      this.log(`[migrator] Backup created: ${backup.path}`);
    }
    return backup;
  }

  private recordBackupArtifact(migration: Migration, backup: MigrationBackup): void {
    this.artifacts.record({
      migrationVersion: migration.version,
      kind: 'backup',
      path: backup.path,
      hash: backup.hash,
    });
  }

  private discardUnusedBackup(backup: MigrationBackup | null): void {
    if (!backup) return;
    try {
      unlinkSync(backup.path);
    } catch (error) {
      this.log(`[migrator] Could not remove unused backup ${backup.path}:`, error);
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

interface MigrationAttemptResult {
  changed: boolean;
  durationMs: number;
}

function isAppliedState(
  record: MigrationLedgerRecord | null | undefined,
): record is MigrationLedgerRecord & { status: 'applied'; direction: 'up' } {
  return record?.status === 'applied' && record.direction === 'up';
}

function assertMigrationChecksum(
  migration: Migration,
  expected: string,
  stored: string,
): void {
  if (expected === stored) return;
  throw new Error(
    `[migrator] Migration ${migration.version} changed after it was applied. ` +
    'Restore the original migration and add a new version instead.',
  );
}

function normalizeBusyTimeout(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('[migrator] busyTimeoutMs must be a non-negative finite number.');
  }
  return Math.floor(value);
}

/**
 * Compose migration lists into a detached, immutable registry.
 *
 * The returned array and each migration entry are frozen snapshots, so later
 * mutation of a caller-owned array or migration object cannot change a live
 * migrator's ordering, checksums, or executable steps.
 */
export function createMigrationRegistry(
  ...registries: ReadonlyArray<readonly Migration[]>
): MigrationRegistry {
  const migrations = registries.flatMap((registry) =>
    registry.map((migration) => Object.freeze({ ...migration }))
  );
  validateMigrationRegistry(migrations);
  return Object.freeze(migrations);
}

function validateMigrationRegistry(migrations: readonly Readonly<Migration>[]): void {
  let previous: string | null = null;
  for (const migration of migrations) {
    assertSynchronousMigrationHandler(migration.up, 'up');
    if (migration.down !== undefined) assertSynchronousMigrationHandler(migration.down, 'down');
    if (migration.version.trim().length === 0) {
      throw new Error('[migrator] Migration versions must not be empty.');
    }
    if (previous !== null && migration.version <= previous) {
      const detail = migration.version === previous ? 'duplicate' : 'out-of-order';
      throw new Error(
        `[migrator] Migration registry contains ${detail} version ${migration.version}. ` +
        'Versions must be unique and strictly increasing.',
      );
    }
    previous = migration.version;
  }
}

function isSqliteBusy(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const sqliteError = error as { code?: unknown; errno?: unknown };
  return sqliteError.code === 'SQLITE_BUSY' || sqliteError.code === 'SQLITE_LOCKED' ||
    sqliteError.errno === 5 || sqliteError.errno === 6;
}
