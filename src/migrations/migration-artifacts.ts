/**
 * migration-artifacts.ts
 *
 * Records migration-related artifacts such as backups and generated plans.
 * Artifact creation remains in the caller; this file owns the audit table.
 */

import type { Database } from 'bun:sqlite';

export type MigrationArtifactKind = 'backup' | 'schema-before' | 'schema-after' | 'plan';

export class MigrationArtifacts {
  constructor(private readonly db: Database) {
    this.ensureTable();
  }

  /** Record a migration artifact for auditability. */
  record(params: {
    migrationVersion: string;
    kind: MigrationArtifactKind;
    path?: string;
    hash?: string;
  }): void {
    this.db.prepare(`
      INSERT INTO _zero_migration_artifacts
        (migration_version, kind, path, hash, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(
      params.migrationVersion,
      params.kind,
      params.path ?? null,
      params.hash ?? null,
    );
  }

  private ensureTable(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS _zero_migration_artifacts (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        migration_version TEXT NOT NULL,
        kind              TEXT NOT NULL,
        path              TEXT,
        hash              TEXT,
        created_at        TEXT NOT NULL
      )
    `);
    this.db.run('CREATE INDEX IF NOT EXISTS idx_zero_migration_artifacts_migration ON _zero_migration_artifacts(migration_version)');
  }
}
