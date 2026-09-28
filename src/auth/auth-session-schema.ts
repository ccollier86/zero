import type { ReactiveDB } from '../sync/reactive-db';

/**
 * Define the private durable parent-session table and migrate refresh links.
 * Tenant foreign keys are deliberately enforced by the live tenancy service:
 * single-tenant installations do not define the optional tenant tables.
 */
export function defineAuthSessionTables(db: ReactiveDB): void {
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

  const refreshTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_refresh_tokens'",
  ).get() as { name: string } | null;
  if (refreshTable) ensureRefreshSessionColumn(db);
}

/** Add the nullable migration link after old installations already have refresh rows. */
export function ensureRefreshSessionColumn(db: ReactiveDB): void {
  const columns = db.prepare('PRAGMA table_info(_refresh_tokens)').all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === 'session_id')) {
    db.exec(`
      ALTER TABLE _refresh_tokens
      ADD COLUMN session_id TEXT REFERENCES _auth_sessions(session_id) ON DELETE CASCADE
    `);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session
    ON _refresh_tokens(session_id)
  `);
}
