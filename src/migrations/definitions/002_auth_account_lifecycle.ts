/**
 * 002_auth_account_lifecycle.ts
 *
 * Adds auth account lifecycle state for password reset/setup flows. This
 * migration is safe for existing databases and mirrors the auth plugin's
 * runtime compatibility checks.
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from '../migrator';

export const migration: Migration = {
  version: '002',
  description: 'Auth account lifecycle columns and action tokens',
  safety: 'safe',
  downSafety: 'destructive',

  up(db: Database) {
    db.run('PRAGMA foreign_keys = ON');
    ensureColumn(db, 'users', 'status', "TEXT NOT NULL DEFAULT 'active'");
    ensureColumn(db, 'users', 'password_change_required', 'INTEGER NOT NULL DEFAULT 0');

    db.run(`
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
    db.run('CREATE INDEX IF NOT EXISTS idx_auth_action_tokens_hash ON _auth_action_tokens(token_hash)');
    db.run('CREATE INDEX IF NOT EXISTS idx_auth_action_tokens_user ON _auth_action_tokens(user_id)');
  },

  down(db: Database) {
    db.run('DROP TABLE IF EXISTS _auth_action_tokens');
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
