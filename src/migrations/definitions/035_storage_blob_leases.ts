/** Add durable per-checksum leases for cross-runtime CAS mutation safety. */

import type { Database } from 'bun:sqlite';
import type { Migration } from '../types';

export const migration: Migration = {
  version: '035',
  description: 'Storage shared-CAS cross-runtime leases',
  safety: 'safe',
  backupRequired: false,

  up(db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS _storage_blob_leases (
        checksum     TEXT PRIMARY KEY,
        lease_token  TEXT NOT NULL,
        acquired_at  INTEGER NOT NULL,
        expires_at   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_storage_blob_leases_expiry
        ON _storage_blob_leases(expires_at);
    `);
  },

  down(db: Database) {
    db.exec('DROP TABLE IF EXISTS _storage_blob_leases');
  },
};
