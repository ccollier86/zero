/** Durable, internal queue for privacy-safe auth email requests. */

export const AUTH_EMAIL_OUTBOX_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS _auth_email_outbox (
    job_id             TEXT PRIMARY KEY,
    kind               TEXT NOT NULL CHECK (kind IN ('password_reset', 'email_verification')),
    recipient          TEXT NOT NULL,
    recipient_hash     TEXT NOT NULL,
    native_continuation TEXT,
    status             TEXT NOT NULL CHECK (
      status IN ('pending', 'processing', 'delivered', 'suppressed', 'dead')
    ),
    attempts           INTEGER NOT NULL DEFAULT 0,
    available_at       INTEGER NOT NULL,
    lease_owner        TEXT,
    lease_expires_at   INTEGER,
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL,
    completed_at       INTEGER,
    last_error_code    TEXT
  )
`;

export const AUTH_EMAIL_OUTBOX_INDEX_SQL = [
  `CREATE INDEX IF NOT EXISTS idx_auth_email_outbox_due
    ON _auth_email_outbox(status, available_at, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_auth_email_outbox_recipient
    ON _auth_email_outbox(recipient_hash, kind, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_auth_email_outbox_terminal
    ON _auth_email_outbox(completed_at)`,
] as const;

export function createAuthEmailOutboxSchema(exec: (sql: string) => unknown): void {
  exec(AUTH_EMAIL_OUTBOX_TABLE_SQL);
  for (const sql of AUTH_EMAIL_OUTBOX_INDEX_SQL) exec(sql);
}
