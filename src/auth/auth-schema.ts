/**
 * auth-schema.ts
 *
 * Owns auth table creation and compatibility upgrades. This module has no
 * route, token, email, or request-context responsibilities.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import { repairNativeAuthSchema } from './oidc/native-auth-schema-repair';
import {
  createNativeAuthIndexStatements,
  createNativeAuthTableStatements,
} from './oidc/native-auth-schema-sql';
import { REGISTRATION_INTENT_TABLE_SQL } from './registration-intent-schema';
import { createAuthEmailOutboxSchema } from './auth-email-outbox-schema';

/**
 * Define all auth tables on the shared ReactiveDB.
 *
 * Public tables go through defineTable() for change tracking. Internal tables
 * use raw SQL and `_` prefixes so they are not broadcast to sync subscribers.
 */
export function defineAuthTables(db: ReactiveDB): void {
  // Create/upgrade users before defineTable() prepares statements for all
  // lifecycle columns. Existing databases may have been created before these
  // columns existed.
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id                  TEXT PRIMARY KEY,
      username                 TEXT UNIQUE NOT NULL,
      email                    TEXT UNIQUE NOT NULL,
      first_name               TEXT,
      last_name                TEXT,
      role                     TEXT NOT NULL DEFAULT 'user',
      status                   TEXT NOT NULL DEFAULT 'active',
      password_change_required INTEGER NOT NULL DEFAULT 0,
      email_verified_at        INTEGER,
      email_verification_required INTEGER NOT NULL DEFAULT 0,
      mfa_required             INTEGER NOT NULL DEFAULT 0,
      created_at               INTEGER NOT NULL,
      updated_at               INTEGER
    )
  `);
  ensureColumn(db, 'users', 'status', "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn(db, 'users', 'password_change_required', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'email_verified_at', 'INTEGER');
  ensureColumn(db, 'users', 'email_verification_required', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'mfa_required', 'INTEGER NOT NULL DEFAULT 0');

  db.defineTable('users', {
    user_id: 'text primary key',
    username: 'text unique not null',
    email: 'text unique not null',
    first_name: 'text',
    last_name: 'text',
    role: "text not null default 'user'",
    status: "text not null default 'active'",
    password_change_required: 'integer not null default 0',
    email_verified_at: 'integer',
    email_verification_required: 'integer not null default 0',
    mfa_required: 'integer not null default 0',
    created_at: 'integer not null',
    updated_at: 'integer',
  });

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_properties (
      user_id TEXT NOT NULL,
      key     TEXT NOT NULL,
      value   TEXT,
      PRIMARY KEY (user_id, key),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS _credentials (
      user_id       TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS _refresh_tokens (
      token_id   TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON _refresh_tokens(token_hash)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON _refresh_tokens(user_id)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_action_tokens (
      token_id    TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      type        TEXT NOT NULL,
      token_hash  TEXT NOT NULL,
      expires_at  INTEGER NOT NULL,
      consumed_at INTEGER,
      created_at  INTEGER NOT NULL,
      created_by  TEXT,
      metadata    TEXT,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_auth_action_tokens_hash ON _auth_action_tokens(token_hash)'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_auth_action_tokens_user ON _auth_action_tokens(user_id)'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_auth_action_tokens_user_type_created ON _auth_action_tokens(user_id, type, created_at)'
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_mfa_methods (
      method_id         TEXT PRIMARY KEY,
      user_id           TEXT NOT NULL,
      type              TEXT NOT NULL,
      label             TEXT,
      status            TEXT NOT NULL,
      is_primary        INTEGER NOT NULL DEFAULT 0,
      secret_ciphertext TEXT,
      created_at        INTEGER NOT NULL,
      verified_at       INTEGER,
      disabled_at       INTEGER,
      last_used_at      INTEGER,
      metadata          TEXT,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_auth_mfa_methods_user_status ON _auth_mfa_methods(user_id, status)'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_auth_mfa_methods_user_primary ON _auth_mfa_methods(user_id, is_primary)'
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_mfa_challenges (
      challenge_id TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      method_id    TEXT,
      method_type  TEXT NOT NULL,
      code_hash    TEXT,
      expires_at   INTEGER NOT NULL,
      attempts     INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL,
      consumed_at  INTEGER,
      created_at   INTEGER NOT NULL,
      metadata     TEXT,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_auth_mfa_challenges_user ON _auth_mfa_challenges(user_id, created_at)'
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_mfa_recovery_codes (
      code_id     TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      code_hash   TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      consumed_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_auth_mfa_recovery_codes_user ON _auth_mfa_recovery_codes(user_id)'
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.exec(REGISTRATION_INTENT_TABLE_SQL);
  createAuthEmailOutboxSchema((sql) => db.exec(sql));

  for (const statement of createNativeAuthTableStatements()) db.exec(statement);
  ensureColumn(db, '_auth_native_requests', 'bound_user_id',
    'TEXT REFERENCES users(user_id) ON DELETE CASCADE');
  db.transaction(() => repairNativeAuthSchema(db));
  for (const statement of createNativeAuthIndexStatements()) db.exec(statement);
}

function ensureColumn(
  db: ReactiveDB,
  table: string,
  column: string,
  definition: string
): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
