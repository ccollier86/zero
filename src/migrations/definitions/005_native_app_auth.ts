/** Frozen initial native OIDC schema. Later changes belong in new migrations. */

import type { Database } from 'bun:sqlite';
import type { Migration } from '../migrator';

export const migration: Migration = {
  version: '005',
  description: 'Native app OpenID Connect authentication',
  safety: 'safe',
  downSafety: 'destructive',
  up(db: Database) {
    db.run('PRAGMA foreign_keys = ON');
    db.exec(V005_TABLES);
    for (const statement of V005_INDEXES) db.run(statement);
  },
  down(db: Database) {
    db.run('DROP TABLE IF EXISTS _auth_native_sessions');
    db.run('DROP TABLE IF EXISTS _auth_native_codes');
    db.run('DROP TABLE IF EXISTS _auth_native_requests');
  },
};

const V005_TABLES = `
CREATE TABLE IF NOT EXISTS _auth_native_requests (
  request_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, scope TEXT NOT NULL,
  state TEXT NOT NULL, nonce TEXT NOT NULL, code_challenge TEXT NOT NULL,
  prompt TEXT, bound_user_id TEXT, created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, consumed_at INTEGER,
  FOREIGN KEY (bound_user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS _auth_native_codes (
  code_id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, request_id TEXT NOT NULL,
  user_id TEXT NOT NULL, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL, nonce TEXT NOT NULL, code_challenge TEXT NOT NULL,
  auth_generation INTEGER NOT NULL, created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, consumed_at INTEGER,
  FOREIGN KEY (request_id) REFERENCES _auth_native_requests(request_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS _auth_native_sessions (
  token_id TEXT PRIMARY KEY, family_id TEXT NOT NULL, user_id TEXT NOT NULL,
  client_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, scope TEXT NOT NULL,
  auth_generation INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL, consumed_at INTEGER, revoked_at INTEGER, replaced_by TEXT,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);`;

const V005_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_auth_native_request_hash ON _auth_native_requests(request_hash)',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_request_expiry ON _auth_native_requests(expires_at)',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_request_active ON _auth_native_requests(expires_at) WHERE consumed_at IS NULL',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_request_client_active ON _auth_native_requests(client_id, expires_at) WHERE consumed_at IS NULL',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_request_created ON _auth_native_requests(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_request_client_created ON _auth_native_requests(client_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_code_hash ON _auth_native_codes(code_hash)',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_code_expiry ON _auth_native_codes(expires_at)',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_code_active ON _auth_native_codes(expires_at) WHERE consumed_at IS NULL',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_session_hash ON _auth_native_sessions(token_hash)',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_session_family ON _auth_native_sessions(family_id)',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_session_user ON _auth_native_sessions(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_session_expiry ON _auth_native_sessions(expires_at)',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_session_active ON _auth_native_sessions(client_id, expires_at) WHERE consumed_at IS NULL AND revoked_at IS NULL',
] as const;
