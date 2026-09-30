/** Add private user-bound Guardian API credentials. */

import type { Database } from 'bun:sqlite';
import type { Migration } from '../types';

export const migration: Migration = {
  version: '029',
  description: 'Guardian user-bound API keys',
  safety: 'safe',
  backupRequired: false,

  up(db: Database) {
    // Keep the complete v029 schema frozen in this numbered definition. The
    // runtime helper may evolve as Guardian grows, but an already-applied
    // migration must always retain the same behavior and checksum.
    db.exec(`
      CREATE TABLE IF NOT EXISTS _auth_api_keys (
        key_id                    TEXT PRIMARY KEY,
        user_id                   TEXT NOT NULL,
        label                     TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 100),
        secret_hash               TEXT NOT NULL UNIQUE CHECK (length(secret_hash) = 64),
        secret_hint               TEXT NOT NULL CHECK (length(secret_hint) = 4),
        scope_kind                TEXT NOT NULL CHECK (scope_kind IN ('application', 'tenant')),
        scope_id                  TEXT NOT NULL,
        tenant_id                 TEXT,
        membership_id             TEXT,
        issued_auth_generation    INTEGER NOT NULL CHECK (issued_auth_generation >= 0),
        key_generation            INTEGER NOT NULL DEFAULT 1 CHECK (key_generation >= 1),
        created_by_user_id        TEXT,
        created_via               TEXT NOT NULL CHECK (created_via IN ('self', 'administrator')),
        created_at                INTEGER NOT NULL,
        expires_at                INTEGER NOT NULL CHECK (expires_at > created_at),
        last_used_at              INTEGER,
        revoked_at                INTEGER,
        revoked_by_user_id        TEXT,
        rotated_from_key_id       TEXT,
        CHECK (
          (scope_kind = 'application'
            AND scope_id = 'application'
            AND tenant_id IS NULL
            AND membership_id IS NULL)
          OR
          (scope_kind = 'tenant'
            AND tenant_id IS NOT NULL
            AND membership_id IS NOT NULL
            AND scope_id = tenant_id)
        ),
        CHECK (revoked_at IS NULL OR revoked_at >= created_at),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
        FOREIGN KEY (created_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
        FOREIGN KEY (revoked_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
        FOREIGN KEY (rotated_from_key_id) REFERENCES _auth_api_keys(key_id) ON DELETE SET NULL,
        FOREIGN KEY (membership_id, tenant_id, user_id)
          REFERENCES _auth_tenant_memberships(membership_id, tenant_id, user_id)
          ON DELETE CASCADE
      )
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_auth_api_keys_user_scope_active
      ON _auth_api_keys(user_id, scope_kind, scope_id, revoked_at, expires_at)
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_auth_api_keys_user_scope_created
      ON _auth_api_keys(user_id, scope_kind, scope_id, created_at DESC, key_id DESC)
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_auth_api_keys_membership_active
      ON _auth_api_keys(membership_id, revoked_at, expires_at)
      WHERE membership_id IS NOT NULL
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_auth_api_keys_expiry
      ON _auth_api_keys(expires_at, key_id)
      WHERE revoked_at IS NULL
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_auth_api_keys_tenant_created
      ON _auth_api_keys(tenant_id, created_at DESC, key_id DESC)
      WHERE tenant_id IS NOT NULL
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_auth_api_keys_created
      ON _auth_api_keys(created_at DESC, key_id DESC)
    `);
  },
};
