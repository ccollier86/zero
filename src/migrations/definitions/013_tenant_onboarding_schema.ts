/** Frozen v013 tenant-onboarding schema. */

interface HistoricalTenantOnboardingDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): {
    get(...values: unknown[]): unknown;
    all(...values: unknown[]): unknown[];
  };
  transaction<T>(callback: () => T): T | (() => T);
}

/**
 * Upgrade migration-012 admission rows without rewriting the frozen migration.
 * SQLite cannot widen a CHECK constraint in place, so preserve every existing
 * pseudonymous row while rebuilding only this internal table.
 */
export function ensureTenantOnboardingAdmissionFlows(db: HistoricalTenantOnboardingDatabase): void {
  const row = db.prepare(`
    SELECT sql FROM sqlite_master
    WHERE type = 'table' AND name = '_auth_request_admissions'
  `).get() as { sql: string } | null;
  if (!row || row.sql.includes("'invitation'")) return;

  runSchemaTransaction(db, () => {
    db.exec('ALTER TABLE _auth_request_admissions RENAME TO _auth_request_admissions_v012');
    db.exec(`
      CREATE TABLE _auth_request_admissions (
        admission_id TEXT PRIMARY KEY,
        flow         TEXT NOT NULL,
        source_hash  TEXT,
        subject_hash TEXT,
        created_at   INTEGER NOT NULL,
        CHECK (flow IN (
          'bootstrap', 'registration', 'login', 'invitation', 'join-request'
        ))
      )
    `);
    db.exec(`
      INSERT INTO _auth_request_admissions (
        admission_id, flow, source_hash, subject_hash, created_at
      )
      SELECT admission_id, flow, source_hash, subject_hash, created_at
      FROM _auth_request_admissions_v012
    `);
    db.exec('DROP TABLE _auth_request_admissions_v012');
    defineTenantOnboardingAdmissionIndexes(db);
  });
}

/** Server-only invitation and join-request control-plane tables. */
export function defineAuthTenantOnboardingTablesV013(db: HistoricalTenantOnboardingDatabase): void {
  ensureTenantOnboardingAdmissionFlows(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_tenant_invitations (
      invitation_id       TEXT PRIMARY KEY,
      tenant_id           TEXT NOT NULL,
      email               TEXT NOT NULL,
      token_hash          TEXT NOT NULL UNIQUE,
      role_keys_json      TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
      issued_by           TEXT NOT NULL,
      accepted_by_user_id TEXT,
      expires_at          INTEGER NOT NULL,
      created_at          INTEGER NOT NULL,
      updated_at          INTEGER NOT NULL,
      accepted_at         INTEGER,
      revoked_at          INTEGER,
      FOREIGN KEY (tenant_id) REFERENCES _auth_tenants(tenant_id) ON DELETE CASCADE,
      FOREIGN KEY (issued_by) REFERENCES users(user_id) ON DELETE RESTRICT,
      FOREIGN KEY (accepted_by_user_id) REFERENCES users(user_id) ON DELETE RESTRICT
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auth_tenant_invitations_tenant_status
    ON _auth_tenant_invitations(tenant_id, status, created_at, invitation_id)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auth_tenant_invitations_tenant_email
    ON _auth_tenant_invitations(tenant_id, email COLLATE NOCASE, status)
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_tenant_invitations_pending_email
    ON _auth_tenant_invitations(tenant_id, email COLLATE NOCASE)
    WHERE status = 'pending'
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_tenant_join_requests (
      join_request_id       TEXT PRIMARY KEY,
      tenant_id             TEXT NOT NULL,
      user_id               TEXT NOT NULL,
      email                 TEXT NOT NULL,
      status                TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'denied', 'cancelled')),
      request_revision      INTEGER NOT NULL DEFAULT 1
                            CHECK (request_revision >= 1),
      requested_at          INTEGER NOT NULL,
      created_at            INTEGER NOT NULL,
      updated_at            INTEGER NOT NULL,
      reviewed_at           INTEGER,
      reviewed_by           TEXT,
      last_decision         TEXT CHECK (last_decision IN ('approved', 'denied')),
      approved_membership_id TEXT,
      FOREIGN KEY (tenant_id) REFERENCES _auth_tenants(tenant_id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
      FOREIGN KEY (reviewed_by) REFERENCES users(user_id) ON DELETE RESTRICT,
      FOREIGN KEY (approved_membership_id)
        REFERENCES _auth_tenant_memberships(membership_id) ON DELETE SET NULL,
      UNIQUE (tenant_id, user_id)
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auth_tenant_join_requests_tenant_status
    ON _auth_tenant_join_requests(tenant_id, status, requested_at, join_request_id)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auth_tenant_join_requests_user
    ON _auth_tenant_join_requests(user_id, updated_at, join_request_id)
  `);

  // The bearer binding and applicant identity are immutable even to future
  // direct-SQL adapters. Lifecycle columns remain service-owned.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_auth_tenant_invitation_binding_immutable
    BEFORE UPDATE OF tenant_id, email, token_hash, role_keys_json, issued_by
    ON _auth_tenant_invitations
    BEGIN
      SELECT RAISE(ABORT, 'AUTH_TENANT_INVITATION_BINDING_IMMUTABLE');
    END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_auth_tenant_join_request_binding_immutable
    BEFORE UPDATE OF tenant_id, user_id, email
    ON _auth_tenant_join_requests
    BEGIN
      SELECT RAISE(ABORT, 'AUTH_TENANT_JOIN_REQUEST_BINDING_IMMUTABLE');
    END
  `);

  ensureTenantInvitationOutboxSupport(db);
}

/**
 * Migration 007 intentionally remains the historical two-kind outbox. The
 * tenant-onboarding migration widens it in place while retaining every queued
 * and terminal account-email job.
 */
export function ensureTenantInvitationOutboxSupport(db: HistoricalTenantOnboardingDatabase): void {
  const columns = db.prepare('PRAGMA table_info(_auth_email_outbox)').all() as unknown as Array<{ name: string }>;
  if (columns.length === 0
    || columns.some((column) => column.name === 'secret_envelope')) return;

  runSchemaTransaction(db, () => {
    db.exec('ALTER TABLE _auth_email_outbox RENAME TO _auth_email_outbox_v007');
    db.exec(`
      CREATE TABLE _auth_email_outbox (
        job_id              TEXT PRIMARY KEY,
        kind                TEXT NOT NULL CHECK (kind IN (
                              'password_reset',
                              'email_verification',
                              'tenant_invitation'
                            )),
        recipient           TEXT NOT NULL,
        recipient_hash      TEXT NOT NULL,
        native_continuation TEXT,
        invitation_id       TEXT,
        secret_envelope     TEXT,
        status              TEXT NOT NULL CHECK (
                              status IN (
                                'pending', 'processing', 'delivered',
                                'suppressed', 'dead'
                              )
                            ),
        attempts            INTEGER NOT NULL DEFAULT 0,
        available_at        INTEGER NOT NULL,
        lease_owner         TEXT,
        lease_expires_at    INTEGER,
        created_at          INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL,
        completed_at        INTEGER,
        last_error_code     TEXT,
        FOREIGN KEY (invitation_id)
          REFERENCES _auth_tenant_invitations(invitation_id) ON DELETE SET NULL,
        CHECK (
          (kind = 'tenant_invitation' AND invitation_id IS NOT NULL)
          OR
          (kind != 'tenant_invitation' AND invitation_id IS NULL
            AND secret_envelope IS NULL)
        ),
        CHECK (
          kind != 'tenant_invitation'
          OR secret_envelope IS NOT NULL
          OR status IN ('delivered', 'suppressed', 'dead')
        )
      )
    `);
    db.exec(`
      INSERT INTO _auth_email_outbox (
        job_id, kind, recipient, recipient_hash, native_continuation,
        invitation_id, secret_envelope, status, attempts, available_at,
        lease_owner, lease_expires_at, created_at, updated_at, completed_at,
        last_error_code
      )
      SELECT job_id, kind, recipient, recipient_hash, native_continuation,
        NULL, NULL, status, attempts, available_at, lease_owner,
        lease_expires_at, created_at, updated_at, completed_at,
        last_error_code
      FROM _auth_email_outbox_v007
    `);
    db.exec('DROP TABLE _auth_email_outbox_v007');
    db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_email_outbox_due
      ON _auth_email_outbox(status, available_at, created_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_email_outbox_recipient
      ON _auth_email_outbox(recipient_hash, kind, created_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_email_outbox_terminal
      ON _auth_email_outbox(completed_at)`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_email_outbox_invitation
      ON _auth_email_outbox(invitation_id)
      WHERE invitation_id IS NOT NULL`);
  });
}

/**
 * HistoricalTenantOnboardingDatabase executes transaction callbacks immediately, while bun:sqlite's
 * Database#transaction returns an executable transaction function. Migration
 * definitions intentionally reuse this runtime schema module, so support both
 * contracts without allowing a migration to silently skip a schema rebuild.
 */
function runSchemaTransaction(db: HistoricalTenantOnboardingDatabase, callback: () => void): void {
  const result = (db as unknown as {
    transaction<T>(fn: () => T): T | (() => T);
  }).transaction(callback);
  if (typeof result === 'function') result();
}

function defineTenantOnboardingAdmissionIndexes(db: Pick<HistoricalTenantOnboardingDatabase, 'exec'>): void {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_request_admissions_flow_created
    ON _auth_request_admissions(flow, created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_request_admissions_source_created
    ON _auth_request_admissions(flow, source_hash, created_at)
    WHERE source_hash IS NOT NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_request_admissions_subject_created
    ON _auth_request_admissions(flow, subject_hash, created_at)
    WHERE subject_hash IS NOT NULL`);
}
