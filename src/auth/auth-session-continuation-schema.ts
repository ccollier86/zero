import type { ReactiveDB } from '../sync/reactive-db';

/** Define one-time, identity-only continuations used before app-session issue. */
export function defineAuthSessionContinuationTables(db: ReactiveDB): void {
  migrateLegacyContinuationTable(db);
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

/** Upgrade the original selection-only constraint without dropping live proofs. */
function migrateLegacyContinuationTable(db: ReactiveDB): void {
  const current = db.prepare(`
    SELECT sql FROM sqlite_master
    WHERE type = 'table' AND name = '_auth_session_continuations'
  `).get() as { sql: string } | null;
  if (!current || current.sql.includes('tenant_onboarding')) return;

  db.transaction(() => {
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
