/** Frozen v010 server-owned tenant authority snapshot migration. */

import type { Database } from 'bun:sqlite';
import type { Migration } from '../types';

const AUTHORITY_COLUMNS = [
  ['scope_kind', 'TEXT'],
  ['scope_id', 'TEXT'],
  ['tenant_id', 'TEXT'],
  ['membership_id', 'TEXT'],
  ['tenant_authorization_generation', 'INTEGER'],
  ['membership_authorization_generation', 'INTEGER'],
] as const;

export const migration: Migration = {
  version: '010',
  description: 'Tenant-bound native authorization and refresh families',
  safety: 'safe',

  up(db: Database) {
    ensureNativeTenantAuthorityColumns({
      exec: (sql) => db.exec(sql),
      prepare: (sql) => ({ all: () => db.query(sql).all() }),
    });
    db.run(`CREATE INDEX IF NOT EXISTS idx_auth_native_session_tenant
      ON _auth_native_sessions(tenant_id, user_id) WHERE tenant_id IS NOT NULL`);
  },
};

interface NativeSchemaDatabaseV010 {
  exec(sql: string): unknown;
  prepare(sql: string): { all(...values: unknown[]): unknown[] };
}

function ensureNativeTenantAuthorityColumns(db: NativeSchemaDatabaseV010): void {
  for (const table of [
    '_auth_native_requests',
    '_auth_native_codes',
    '_auth_native_sessions',
  ]) {
    for (const [column, definition] of AUTHORITY_COLUMNS) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
      }>;
      if (!columns.some((candidate) => candidate.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    }
  }
}
