/** Add isolated exact-state receipts for administrator-created accounts. */

import type { Database } from 'bun:sqlite';
import type { Migration } from '../types';

export const migration: Migration = {
  version: '028',
  description: 'Durable administrator user provisioning receipts',
  safety: 'safe',
  backupRequired: false,

  up(db: Database) {
    // This schema is deliberately frozen here rather than imported from the
    // mutable runtime helper. Administrator provisioning is a distinct
    // authority boundary and must never reuse registration receipts.
    db.exec(`
      CREATE TABLE IF NOT EXISTS _auth_admin_user_provisioning (
        provisioning_id TEXT PRIMARY KEY,
        user_id          TEXT NOT NULL UNIQUE,
        user_fingerprint TEXT NOT NULL,
        auth_generation INTEGER NOT NULL CHECK (auth_generation >= 0),
        setup_token_id   TEXT,
        lease_owner_hash TEXT NOT NULL CHECK (length(lease_owner_hash) = 64),
        lease_expires_at INTEGER NOT NULL,
        created_at       INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_auth_admin_user_provisioning_lease
      ON _auth_admin_user_provisioning(lease_expires_at)
    `);
  },
};
