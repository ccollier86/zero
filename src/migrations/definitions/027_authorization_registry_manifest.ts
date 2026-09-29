/** Fence the resolved static role/permission registry across app runtimes. */

import type { Database } from 'bun:sqlite';
import type { Migration } from '../types';

export const migration: Migration = {
  version: '027',
  description: 'Persist authorization registry manifest identity',
  safety: 'safe',
  backupRequired: false,

  up(db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS _auth_authorization_manifest (
        singleton        INTEGER PRIMARY KEY CHECK (singleton = 1),
        version          INTEGER NOT NULL CHECK (version = 1),
        registry_version INTEGER NOT NULL CHECK (registry_version >= 1),
        fingerprint      TEXT NOT NULL CHECK (length(fingerprint) = 64),
        manifest_json    TEXT NOT NULL,
        updated_at       INTEGER NOT NULL CHECK (updated_at >= 0)
      )
    `);
    // Keep this historical migration independent from the mutable runtime
    // authority-table registry. Migration 020 installs the shared clock for a
    // normal sequential upgrade; the IF NOT EXISTS statements also make 027
    // deterministic when it is exercised in isolation.
    db.exec(`
      CREATE TABLE IF NOT EXISTS _auth_authority_revision (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
      )
    `);
    db.exec(`
      INSERT OR IGNORE INTO _auth_authority_revision (singleton, revision)
      VALUES (1, 0)
    `);
    // Frozen v027 refresh. Migration 020 deliberately retains its historical
    // selective session triggers. This migration owns the current fail-closed
    // session definitions, the tenant-kind fence, and the new manifest target.
    const targets: readonly AuthorityTargetV027[] = [
      { table: '_auth_sessions', updateColumns: [], updateTriggerVersion: 2 },
      {
        table: '_auth_tenants',
        updateColumns: ['kind', 'status', 'authorization_generation'],
        updateTriggerVersion: 2,
      },
      { table: '_auth_native_sessions', updateColumns: [], updateTriggerVersion: 2 },
      {
        table: '_auth_authorization_manifest',
        updateColumns: ['version', 'registry_version', 'fingerprint', 'manifest_json'],
      },
    ];
    for (const target of targets) {
      if (!tableExists(db, target.table)) continue;
      installAuthorityTriggersV027(db, target);
    }
  },
};

interface AuthorityTargetV027 {
  readonly table: string;
  readonly updateColumns: readonly string[];
  readonly updateTriggerVersion?: number;
}

function installAuthorityTriggersV027(
  db: Database,
  target: AuthorityTargetV027,
): void {
  const table = quoteIdentifier(target.table);
  const safeName = target.table.replace(/[^A-Za-z0-9_]/g, '_');
  for (const operation of ['insert', 'delete', 'update'] as const) {
    const triggerVersion = operation === 'update'
      ? target.updateTriggerVersion ?? 1
      : 1;
    const trigger = quoteIdentifier(
      `trg_zero_authority_${safeName}_${operation}_v${triggerVersion}`,
    );
    const updateColumns = operation === 'update' && target.updateColumns.length > 0
      ? ` OF ${target.updateColumns.map(quoteIdentifier).join(', ')}`
      : '';
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS ${trigger}
      AFTER ${operation.toUpperCase()}${updateColumns} ON ${table}
      BEGIN
        UPDATE _auth_authority_revision
        SET revision = revision + 1
        WHERE singleton = 1;
      END
    `);
    for (let version = 1; version < triggerVersion; version += 1) {
      db.exec(`DROP TRIGGER IF EXISTS ${quoteIdentifier(
        `trg_zero_authority_${safeName}_${operation}_v${version}`,
      )}`);
    }
  }
}

function tableExists(db: Database, table: string): boolean {
  return Boolean(db.query(`SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = ? LIMIT 1`).get(table));
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}
