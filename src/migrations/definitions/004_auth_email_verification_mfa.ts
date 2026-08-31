/**
 * 004_auth_email_verification_mfa.ts
 *
 * Adds auth email-verification columns and first-class MFA storage. This
 * migration is additive and mirrors the auth plugin's runtime compatibility
 * checks for existing databases.
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from '../migrator';

export const migration: Migration = {
  version: '004',
  description: 'Auth email verification and MFA foundation',
  safety: 'safe',
  downSafety: 'destructive',

  up(db: Database) {
    db.run('PRAGMA foreign_keys = ON');
    ensureColumn(db, 'users', 'email_verified_at', 'INTEGER');
    ensureColumn(db, 'users', 'email_verification_required', 'INTEGER NOT NULL DEFAULT 0');
    ensureColumn(db, 'users', 'mfa_required', 'INTEGER NOT NULL DEFAULT 0');

    db.run('CREATE INDEX IF NOT EXISTS idx_auth_action_tokens_user_type_created ON _auth_action_tokens(user_id, type, created_at)');

    db.run(`
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
    db.run('CREATE INDEX IF NOT EXISTS idx_auth_mfa_methods_user_status ON _auth_mfa_methods(user_id, status)');
    db.run('CREATE INDEX IF NOT EXISTS idx_auth_mfa_methods_user_primary ON _auth_mfa_methods(user_id, is_primary)');

    db.run(`
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
    db.run('CREATE INDEX IF NOT EXISTS idx_auth_mfa_challenges_user ON _auth_mfa_challenges(user_id, created_at)');

    db.run(`
      CREATE TABLE IF NOT EXISTS _auth_mfa_recovery_codes (
        code_id     TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        code_hash   TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        consumed_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_auth_mfa_recovery_codes_user ON _auth_mfa_recovery_codes(user_id)');
  },

  down(db: Database) {
    db.run('DROP TABLE IF EXISTS _auth_mfa_recovery_codes');
    db.run('DROP TABLE IF EXISTS _auth_mfa_challenges');
    db.run('DROP TABLE IF EXISTS _auth_mfa_methods');
  },
};

function ensureColumn(
  db: Database,
  table: string,
  column: string,
  definition: string
): void {
  const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some((row) => row.name === column)) {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
