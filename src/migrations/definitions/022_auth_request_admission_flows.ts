/** Keep durable public-auth admission storage aligned with every admitted flow. */

import type { Database } from 'bun:sqlite';
import type { Migration } from '../types';

export const migration: Migration = {
  version: '022',
  description: 'Complete public authentication request admission flows',
  safety: 'safe',
  backupRequired: false,

  up(db: Database) {
    // Keep the complete schema in this migration body. Migration checksums hash
    // `up.toString()`, so importing a mutable runtime helper here would make an
    // already-applied migration change behavior without changing its checksum.
    const tableBody = `(
      admission_id TEXT PRIMARY KEY,
      flow         TEXT NOT NULL,
      source_hash  TEXT,
      subject_hash TEXT,
      created_at   INTEGER NOT NULL,
      CHECK (flow IN ('bootstrap', 'registration', 'login', 'invitation', 'join-request', 'domain-onboarding'))
    )`;
    const normalizeSql = (sql: string) => sql.toLowerCase().replace(/\s+/g, '');
    const expectedSql = normalizeSql(
      `CREATE TABLE _auth_request_admissions ${tableBody}`,
    );
    const row = db.query(`
      SELECT sql FROM sqlite_master
      WHERE type = 'table' AND name = '_auth_request_admissions'
    `).get() as { sql: string } | null;

    if (!row) {
      db.exec(`CREATE TABLE _auth_request_admissions ${tableBody}`);
    } else if (normalizeSql(row.sql) !== expectedSql) {
      db.exec(`ALTER TABLE _auth_request_admissions
        RENAME TO _auth_request_admissions_pre_v022`);
      db.exec(`CREATE TABLE _auth_request_admissions ${tableBody}`);
      db.exec(`
        INSERT INTO _auth_request_admissions (
          admission_id, flow, source_hash, subject_hash, created_at
        )
        SELECT admission_id, flow, source_hash, subject_hash, created_at
        FROM _auth_request_admissions_pre_v022
      `);
      db.exec('DROP TABLE _auth_request_admissions_pre_v022');
    }

    db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_request_admissions_flow_created
      ON _auth_request_admissions(flow, created_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_request_admissions_source_created
      ON _auth_request_admissions(flow, source_hash, created_at)
      WHERE source_hash IS NOT NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_request_admissions_subject_created
      ON _auth_request_admissions(flow, subject_hash, created_at)
      WHERE subject_hash IS NOT NULL`);
  },
};
