/**
 * Frozen v009 tenant/session contract.
 *
 * Later migrations own later columns: v024 adds tenant kind and v025 adds
 * durable MFA assurance. Never call mutable runtime schema helpers here.
 */

import type { Database } from 'bun:sqlite';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { Migration } from '../migrator';
import {
  defineAuthTenancyTablesV009 as defineTenancyTables,
} from './009_auth_tenancy_schema';

export const migration: Migration = {
  version: '009',
  description: 'Tenant control plane and durable browser auth sessions',
  safety: 'safe',

  up(db: Database) {
    // These schema helpers use only the SQLite-compatible exec/prepare/
    // transaction surface. Keeping the one narrow adapter here avoids a second
    // hand-copied schema that could drift from AuthRuntime startup.
    const schemaDb = db as unknown as ReactiveDB;
    defineTenancyTables(schemaDb, { registrationProvisioning: false });
    defineAuthSessionTables(schemaDb);
    defineAuthSessionContinuationTables(schemaDb);
  },
};

function defineAuthSessionTables(db: ReactiveDB): void {
  defineAuthSessionTablesV009(db as unknown as Database);
}

function defineAuthSessionContinuationTables(db: ReactiveDB): void {
  defineAuthSessionContinuationTablesV009(db as unknown as Database);
}

function defineAuthSessionTablesV009(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_sessions (
      session_id                         TEXT PRIMARY KEY,
      user_id                            TEXT NOT NULL,
      kind                               TEXT NOT NULL
                                         CHECK (kind = 'web'),
      status                             TEXT NOT NULL DEFAULT 'active'
                                         CHECK (status IN ('active', 'revoked')),
      generation                         INTEGER NOT NULL DEFAULT 0
                                         CHECK (generation >= 0),
      scope_kind                         TEXT NOT NULL
                                         CHECK (scope_kind IN ('application', 'tenant')),
      scope_id                           TEXT NOT NULL,
      tenant_id                          TEXT,
      membership_id                      TEXT,
      tenant_authorization_generation    INTEGER,
      membership_authorization_generation INTEGER,
      provenance                         TEXT NOT NULL
                                         CHECK (provenance = 'local'),
      authenticated_at                   INTEGER NOT NULL,
      created_at                         INTEGER NOT NULL,
      last_seen_at                       INTEGER NOT NULL,
      expires_at                         INTEGER NOT NULL,
      revoked_at                         INTEGER,
      revocation_reason                  TEXT,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
      CHECK (
        (scope_kind = 'application'
          AND scope_id = 'application'
          AND tenant_id IS NULL
          AND membership_id IS NULL
          AND tenant_authorization_generation IS NULL
          AND membership_authorization_generation IS NULL)
        OR
        (scope_kind = 'tenant'
          AND scope_id = tenant_id
          AND tenant_id IS NOT NULL
          AND membership_id IS NOT NULL
          AND tenant_authorization_generation IS NOT NULL
          AND membership_authorization_generation IS NOT NULL)
      )
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_status
    ON _auth_sessions(user_id, status, expires_at)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_tenant_membership
    ON _auth_sessions(tenant_id, membership_id, status)
  `);

  if (tableExists(db, '_refresh_tokens')) {
    if (!hasColumn(db, '_refresh_tokens', 'session_id')) {
      db.exec(`
        ALTER TABLE _refresh_tokens
        ADD COLUMN session_id TEXT
          REFERENCES _auth_sessions(session_id) ON DELETE CASCADE
      `);
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session
      ON _refresh_tokens(session_id)
    `);
  }
}

function defineAuthSessionContinuationTablesV009(db: Database): void {
  migrateLegacyContinuationTableV009(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_session_continuations (
      continuation_id TEXT PRIMARY KEY,
      application_id  TEXT NOT NULL,
      user_id         TEXT NOT NULL,
      purpose         TEXT NOT NULL
                      CHECK (purpose IN ('tenant_selection', 'tenant_onboarding')),
      token_hash      TEXT NOT NULL UNIQUE,
      auth_generation INTEGER NOT NULL CHECK (auth_generation >= 0),
      expires_at      INTEGER NOT NULL,
      consumed_at     INTEGER,
      created_at      INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auth_session_continuations_user_purpose
    ON _auth_session_continuations(user_id, purpose, expires_at)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auth_session_continuations_cleanup
    ON _auth_session_continuations(expires_at, consumed_at)
  `);
}

function migrateLegacyContinuationTableV009(db: Database): void {
  const current = db.query(`
    SELECT sql FROM sqlite_master
    WHERE type = 'table' AND name = '_auth_session_continuations'
  `).get() as { sql: string } | null;
  if (!current || current.sql.includes('tenant_onboarding')) return;

  withSavepoint(db, 'zero_auth_continuations_v009', () => {
    db.exec('DROP INDEX IF EXISTS idx_auth_session_continuations_user_purpose');
    db.exec('DROP INDEX IF EXISTS idx_auth_session_continuations_cleanup');
    db.exec(`
      ALTER TABLE _auth_session_continuations
      RENAME TO _auth_session_continuations_legacy
    `);
    db.exec(`
      CREATE TABLE _auth_session_continuations (
        continuation_id TEXT PRIMARY KEY,
        application_id  TEXT NOT NULL,
        user_id         TEXT NOT NULL,
        purpose         TEXT NOT NULL
                        CHECK (purpose IN ('tenant_selection', 'tenant_onboarding')),
        token_hash      TEXT NOT NULL UNIQUE,
        auth_generation INTEGER NOT NULL CHECK (auth_generation >= 0),
        expires_at      INTEGER NOT NULL,
        consumed_at     INTEGER,
        created_at      INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )
    `);
    db.exec(`
      INSERT INTO _auth_session_continuations (
        continuation_id, application_id, user_id, purpose, token_hash,
        auth_generation, expires_at, consumed_at, created_at
      )
      SELECT continuation_id, application_id, user_id, purpose, token_hash,
        auth_generation, expires_at, consumed_at, created_at
      FROM _auth_session_continuations_legacy
    `);
    db.exec('DROP TABLE _auth_session_continuations_legacy');
  });
}

function tableExists(db: Database, table: string): boolean {
  return Boolean(db.query(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
}

function hasColumn(db: Database, table: string, column: string): boolean {
  return (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .some((candidate) => candidate.name === column);
}

function withSavepoint(db: Database, name: string, operation: () => void): void {
  db.exec(`SAVEPOINT ${name}`);
  try {
    operation();
    db.exec(`RELEASE SAVEPOINT ${name}`);
  } catch (error) {
    db.exec(`ROLLBACK TO SAVEPOINT ${name}`);
    db.exec(`RELEASE SAVEPOINT ${name}`);
    throw error;
  }
}
