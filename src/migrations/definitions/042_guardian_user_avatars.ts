/** Append-only avatar storage snapshot; never imports mutable runtime schema helpers. */
import type { Migration } from '../types';
const objects = [
  { name: '_auth_avatar_namespace', type: 'table', sql: `CREATE TABLE _auth_avatar_namespace (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1), drive_id TEXT NOT NULL UNIQUE
  )` },
  { name: '_auth_avatar_assets', type: 'table', sql: `CREATE TABLE _auth_avatar_assets (
    asset_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
    state TEXT NOT NULL CHECK (state IN ('pending', 'current', 'retired')),
    checksum TEXT, byte_length INTEGER, width INTEGER, height INTEGER,
    created_at INTEGER NOT NULL, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0
  )` },
  { name: '_auth_user_avatars', type: 'table', sql: `CREATE TABLE _auth_user_avatars (
    user_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL UNIQUE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (asset_id) REFERENCES _auth_avatar_assets(asset_id)
  )` },
  { name: '_auth_avatar_stages', type: 'table', sql: `CREATE TABLE _auth_avatar_stages (
    stage_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expected_revision INTEGER NOT NULL,
    authority_json TEXT NOT NULL, receipt_hash TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
    state TEXT NOT NULL CHECK (state IN ('allocated', 'processing', 'consumed', 'retired')),
    expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, lease_token TEXT,
    lease_until INTEGER NOT NULL DEFAULT 0, asset_id TEXT
  )` },
  { name: 'idx_auth_avatar_stage_expiry', type: 'index', sql: `CREATE INDEX idx_auth_avatar_stage_expiry
    ON _auth_avatar_stages (expires_at, lease_until)` },
  { name: 'idx_auth_avatar_asset_cleanup', type: 'index', sql: `CREATE INDEX idx_auth_avatar_asset_cleanup
    ON _auth_avatar_assets (state, lease_until, created_at)` },
];
export const migration: Migration = { version: '042', description: 'Guardian immutable user avatars and staging receipts', safety: 'safe', backupRequired: false,
  up(db) {
    const inspect = (required: boolean) => {
      for (const object of objects) {
        const actual = db.query('SELECT type, sql FROM sqlite_master WHERE name = ?').get(object.name) as { type: string; sql: string | null } | null;
        if (!actual) { if (required) throw new Error('Guardian avatar schema installation is incomplete'); continue; }
        if (actual.type !== object.type || !actual.sql || normalized(actual.sql) !== normalized(object.sql)) throw new Error('Guardian avatar schema is incompatible');
      }
    };
    inspect(false);
    for (const object of objects) db.exec(object.sql.replace(/^CREATE (TABLE|INDEX)/u, 'CREATE $1 IF NOT EXISTS'));
    inspect(true);
  } };
function normalized(sql: string): string { return sql.replace(/\bIF\s+NOT\s+EXISTS\s+/gi, '').replace(/\s+/g, ' ').trim(); }
