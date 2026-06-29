/**
 * 003_platform_tokens.ts
 *
 * Adds generic Zero action and resume token tables. These tables are
 * framework-owned, hash-only, and separate from auth so app-owned public flows
 * can use tokens without requiring a user account.
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from '../migrator';

export const migration: Migration = {
  version: '003',
  description: 'Generic platform action and resume tokens',
  safety: 'safe',
  downSafety: 'destructive',

  up(db: Database) {
    db.run(`
      CREATE TABLE IF NOT EXISTS _zero_action_tokens (
        token_id     TEXT PRIMARY KEY,
        purpose      TEXT NOT NULL,
        token_hash   TEXT NOT NULL UNIQUE,
        subject_type TEXT,
        subject_id   TEXT,
        scope        TEXT,
        expires_at   INTEGER NOT NULL,
        consumed_at  INTEGER,
        created_at   INTEGER NOT NULL,
        created_by   TEXT,
        metadata     TEXT
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_zero_action_tokens_hash ON _zero_action_tokens(token_hash)');
    db.run('CREATE INDEX IF NOT EXISTS idx_zero_action_tokens_lookup ON _zero_action_tokens(purpose, subject_type, subject_id, scope, created_at)');
    db.run('CREATE INDEX IF NOT EXISTS idx_zero_action_tokens_expiry ON _zero_action_tokens(expires_at)');

    db.run(`
      CREATE TABLE IF NOT EXISTS _zero_resume_tokens (
        token_id      TEXT PRIMARY KEY,
        flow          TEXT NOT NULL,
        token_hash    TEXT NOT NULL UNIQUE,
        resource_type TEXT NOT NULL,
        resource_id   TEXT NOT NULL,
        subject_type  TEXT,
        subject_id    TEXT,
        expires_at    INTEGER NOT NULL,
        revoked_at    INTEGER,
        last_used_at  INTEGER,
        created_at    INTEGER NOT NULL,
        created_by    TEXT,
        rotated_from  TEXT,
        metadata      TEXT
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_zero_resume_tokens_hash ON _zero_resume_tokens(token_hash)');
    db.run('CREATE INDEX IF NOT EXISTS idx_zero_resume_tokens_resource ON _zero_resume_tokens(flow, resource_type, resource_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_zero_resume_tokens_subject ON _zero_resume_tokens(subject_type, subject_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_zero_resume_tokens_expiry ON _zero_resume_tokens(expires_at)');
  },

  down(db: Database) {
    db.run('DROP TABLE IF EXISTS _zero_resume_tokens');
    db.run('DROP TABLE IF EXISTS _zero_action_tokens');
  },
};
