/** Persist server-owned MFA assurance across web and native session families. */

import type { Database } from 'bun:sqlite';
import type { Migration } from '../types';
import { replaceAuthorityUpdateTrigger } from './024_authority_revision_refresh';

export const migration: Migration = {
  version: '025',
  description: 'Durable MFA assurance for browser and native sessions',
  safety: 'safe',
  backupRequired: false,

  up(db: Database) {
    // All additions are nullable by design: an existing session has not
    // proved MFA merely because the application upgraded its schema.
    ensureColumn(db, '_auth_sessions', 'mfa_verified_at');
    ensureColumn(db, '_auth_session_continuations', 'mfa_verified_at');
    ensureColumn(db, '_auth_native_codes', 'mfa_verified_at');
    ensureColumn(db, '_auth_native_sessions', 'mfa_verified_at');
    replaceAuthorityUpdateTrigger({
      db,
      table: '_auth_sessions',
      updateColumns: [],
      version: 2,
    });
    replaceAuthorityUpdateTrigger({
      db,
      table: '_auth_native_sessions',
      updateColumns: [],
      version: 2,
    });
  },
};

/** Keep the historical migration independent from mutable runtime schema code. */
function ensureColumn(db: Database, table: string, column: string): void {
  const columns = db.query(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (columns.some((candidate) => candidate.name === column)) return;
  db.exec(`ALTER TABLE ${table}
    ADD COLUMN ${column} INTEGER
      CHECK (${column} IS NULL OR ${column} >= 0)`);
}
