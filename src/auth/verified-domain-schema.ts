/** Private persistence for exact verified-domain request onboarding. */

import type { ReactiveDB } from '../sync/reactive-db';

export function defineVerifiedDomainTables(db: ReactiveDB): void {
  ensureColumn(db, 'users', 'email_generation', 'INTEGER NOT NULL DEFAULT 1');
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_auth_users_email_generation
    AFTER UPDATE OF email ON users
    WHEN OLD.email IS NOT NEW.email
    BEGIN
      UPDATE users
      SET email_generation = OLD.email_generation + 1
      WHERE user_id = NEW.user_id;
    END
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_tenant_domain_claims (
      claim_id             TEXT PRIMARY KEY,
      tenant_id            TEXT NOT NULL,
      domain               TEXT NOT NULL UNIQUE,
      status               TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'verified', 'grace', 'lost')),
      proof_method         TEXT NOT NULL DEFAULT 'dns-txt'
                           CHECK (proof_method = 'dns-txt'),
      challenge_digest     TEXT,
      challenge_expires_at INTEGER,
      verification_digest  TEXT,
      verified_at          INTEGER,
      last_checked_at      INTEGER,
      next_check_at        INTEGER,
      valid_until          INTEGER,
      revision             INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      lease_owner          TEXT,
      lease_expires_at     INTEGER,
      created_by           TEXT,
      created_at           INTEGER NOT NULL,
      updated_at           INTEGER NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES _auth_tenants(tenant_id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL,
      CHECK ((challenge_digest IS NULL) = (challenge_expires_at IS NULL))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_domain_claims_tenant
    ON _auth_tenant_domain_claims(tenant_id, created_at, claim_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_domain_claims_due
    ON _auth_tenant_domain_claims(status, next_check_at, lease_expires_at)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_tenant_domain_policies (
      claim_id          TEXT PRIMARY KEY,
      enabled           INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
      admission         TEXT NOT NULL DEFAULT 'request-to-join'
                        CHECK (admission = 'request-to-join'),
      request_role_key  TEXT,
      revision          INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      updated_by        TEXT,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL,
      FOREIGN KEY (claim_id) REFERENCES _auth_tenant_domain_claims(claim_id)
        ON DELETE CASCADE,
      FOREIGN KEY (updated_by) REFERENCES users(user_id) ON DELETE SET NULL,
      CHECK (enabled = 0 OR request_role_key IS NOT NULL)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_domain_mailbox_tokens (
      token_id                 TEXT PRIMARY KEY,
      application_id          TEXT NOT NULL,
      user_id                  TEXT NOT NULL,
      email                    TEXT NOT NULL,
      email_generation         INTEGER NOT NULL CHECK (email_generation >= 1),
      auth_generation          INTEGER NOT NULL CHECK (auth_generation >= 0),
      identity_kind            TEXT NOT NULL CHECK (identity_kind IN ('session', 'continuation')),
      identity_continuation_id TEXT,
      token_hash               TEXT NOT NULL UNIQUE,
      outbox_job_id            TEXT NOT NULL,
      expires_at               INTEGER NOT NULL,
      consumed_at              INTEGER,
      created_at               INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (identity_continuation_id)
        REFERENCES _auth_session_continuations(continuation_id) ON DELETE CASCADE,
      CHECK (
        (identity_kind = 'session' AND identity_continuation_id IS NULL)
        OR (identity_kind = 'continuation' AND identity_continuation_id IS NOT NULL)
      )
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_domain_mailbox_tokens_user
    ON _auth_domain_mailbox_tokens(user_id, expires_at, consumed_at)`);
  // One durable job may have a bounded token per provider attempt. Keeping
  // siblings is required when a provider accepts a message but its response
  // is lost: the already-delivered link must remain usable.
  db.exec('DROP INDEX IF EXISTS idx_auth_domain_mailbox_tokens_outbox');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_domain_mailbox_tokens_outbox
    ON _auth_domain_mailbox_tokens(outbox_job_id, created_at)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_mailbox_proofs (
      proof_id          TEXT PRIMARY KEY,
      application_id   TEXT NOT NULL,
      user_id           TEXT NOT NULL,
      email             TEXT NOT NULL,
      email_generation  INTEGER NOT NULL CHECK (email_generation >= 1),
      source            TEXT NOT NULL CHECK (source = 'email-link'),
      proved_at         INTEGER NOT NULL,
      expires_at        INTEGER NOT NULL,
      revoked_at        INTEGER,
      created_at        INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_mailbox_proofs_live
    ON _auth_mailbox_proofs(user_id, email_generation, expires_at, revoked_at)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_domain_onboarding_transactions (
      transaction_id           TEXT PRIMARY KEY,
      application_id           TEXT NOT NULL,
      user_id                  TEXT NOT NULL,
      email                    TEXT NOT NULL,
      email_generation         INTEGER NOT NULL CHECK (email_generation >= 1),
      auth_generation          INTEGER NOT NULL CHECK (auth_generation >= 0),
      identity_kind            TEXT NOT NULL CHECK (identity_kind IN ('session', 'continuation')),
      identity_continuation_id TEXT,
      mailbox_proof_id         TEXT NOT NULL,
      domain                   TEXT NOT NULL,
      claim_id                 TEXT NOT NULL,
      claim_revision           INTEGER NOT NULL CHECK (claim_revision >= 1),
      policy_revision          INTEGER NOT NULL CHECK (policy_revision >= 1),
      tenant_id                TEXT NOT NULL,
      request_role_key         TEXT NOT NULL,
      token_hash               TEXT NOT NULL UNIQUE,
      expires_at               INTEGER NOT NULL,
      consumed_at              INTEGER,
      created_at               INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (identity_continuation_id)
        REFERENCES _auth_session_continuations(continuation_id) ON DELETE CASCADE,
      FOREIGN KEY (mailbox_proof_id) REFERENCES _auth_mailbox_proofs(proof_id)
        ON DELETE CASCADE,
      FOREIGN KEY (claim_id) REFERENCES _auth_tenant_domain_claims(claim_id)
        ON DELETE CASCADE,
      FOREIGN KEY (tenant_id) REFERENCES _auth_tenants(tenant_id) ON DELETE CASCADE,
      CHECK (
        (identity_kind = 'session' AND identity_continuation_id IS NULL)
        OR (identity_kind = 'continuation' AND identity_continuation_id IS NOT NULL)
      )
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_domain_transactions_cleanup
    ON _auth_domain_onboarding_transactions(expires_at, consumed_at)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_domain_join_request_provenance (
      join_request_id  TEXT PRIMARY KEY,
      tenant_id        TEXT NOT NULL,
      user_id          TEXT NOT NULL,
      claim_id         TEXT NOT NULL,
      domain           TEXT NOT NULL,
      request_role_key TEXT NOT NULL,
      mailbox_proof_id TEXT,
      blocked_until    INTEGER,
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL,
      FOREIGN KEY (join_request_id) REFERENCES _auth_tenant_join_requests(join_request_id)
        ON DELETE CASCADE,
      FOREIGN KEY (tenant_id) REFERENCES _auth_tenants(tenant_id) ON DELETE CASCADE,
      FOREIGN KEY (claim_id) REFERENCES _auth_tenant_domain_claims(claim_id)
        ON DELETE RESTRICT,
      FOREIGN KEY (mailbox_proof_id) REFERENCES _auth_mailbox_proofs(proof_id)
        ON DELETE SET NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_tenant_membership_provenance (
      membership_id    TEXT PRIMARY KEY,
      source           TEXT NOT NULL CHECK (source IN ('domain-request')),
      source_id        TEXT NOT NULL,
      claim_id         TEXT NOT NULL,
      domain           TEXT NOT NULL,
      recorded_at      INTEGER NOT NULL,
      FOREIGN KEY (membership_id) REFERENCES _auth_tenant_memberships(membership_id)
        ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES _auth_tenant_join_requests(join_request_id)
        ON DELETE RESTRICT,
      FOREIGN KEY (claim_id) REFERENCES _auth_tenant_domain_claims(claim_id)
        ON DELETE RESTRICT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_tenant_admission_blocks (
      block_id     TEXT PRIMARY KEY,
      tenant_id   TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      reason      TEXT NOT NULL,
      blocked_by  TEXT,
      blocked_at  INTEGER NOT NULL,
      unblocked_at INTEGER,
      FOREIGN KEY (tenant_id) REFERENCES _auth_tenants(tenant_id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (blocked_by) REFERENCES users(user_id) ON DELETE SET NULL
    )
  `);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_tenant_admission_blocks_live
    ON _auth_tenant_admission_blocks(tenant_id, user_id)
    WHERE unblocked_at IS NULL`);

  ensureVerifiedDomainAdmissionFlow(db);
  ensureVerifiedDomainOutboxSupport(db);
}

/**
 * Migration-019/runtime release support.
 *
 * Migration 017 intentionally keeps its original globally-unique claim table.
 * Releasing a claim must retain its immutable evidence row, so this additive
 * upgrade replaces that constraint with one-active-claim uniqueness and
 * rebuilds every private child table atomically without deleting history.
 */
export function defineVerifiedDomainReleaseTables(db: ReactiveDB): void {
  const columns = db.prepare('PRAGMA table_info(_auth_tenant_domain_claims)').all() as Array<{
    name: string;
  }>;
  if (columns.length === 0) return;
  if (!columns.some((column) => column.name === 'released_at')) {
    assertKnownClaimDependents(db);
    runSchemaTransaction(db, () => rebuildReleaseClaimGraph(db));
  }
  defineReleaseClaimIndexes(db);
  defineReleasedDomainProvenanceTables(db);
  ensureVerifiedDomainJoinRequestProvenanceBinding(db);
  defineReleasedClaimImmutabilityTriggers(db);
}

/**
 * Bind operational domain provenance to the exact retained-request revision.
 *
 * Rows written before this fence are deliberately marked `legacy-unbound`
 * instead of being guessed current. A reviewer must never inherit a fixed
 * domain role from evidence which may belong to an older generic revision.
 */
export function ensureVerifiedDomainJoinRequestProvenanceBinding(
  db: ReactiveDB,
): void {
  const operational = tableColumns(db, '_auth_domain_join_request_provenance');
  if (operational.size > 0) {
    if (!operational.has('source')) {
      db.exec(`ALTER TABLE _auth_domain_join_request_provenance
        ADD COLUMN source TEXT NOT NULL DEFAULT 'legacy-unbound'
        CHECK (source IN ('verified-domain', 'legacy-unbound'))`);
    }
    if (!operational.has('request_revision')) {
      db.exec(`ALTER TABLE _auth_domain_join_request_provenance
        ADD COLUMN request_revision INTEGER CHECK (request_revision >= 1)`);
    }
  }

  const released = tableColumns(db, '_auth_released_domain_join_provenance');
  if (released.size > 0) {
    if (!released.has('source')) {
      db.exec(`ALTER TABLE _auth_released_domain_join_provenance
        ADD COLUMN source TEXT NOT NULL DEFAULT 'legacy-unbound'
        CHECK (source IN ('verified-domain', 'legacy-unbound'))`);
    }
    if (!released.has('request_revision')) {
      db.exec(`ALTER TABLE _auth_released_domain_join_provenance
        ADD COLUMN request_revision INTEGER CHECK (request_revision >= 1)`);
    }
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_auth_released_domain_join_binding_immutable
      BEFORE UPDATE OF source, request_revision
      ON _auth_released_domain_join_provenance
      BEGIN
        SELECT RAISE(ABORT, 'AUTH_RELEASED_DOMAIN_PROVENANCE_IMMUTABLE');
      END
    `);
  }
}

function rebuildReleaseClaimGraph(db: ReactiveDB): void {
  const backups = [
    '_auth_v019_claims_backup',
    '_auth_v019_policies_backup',
    '_auth_v019_transactions_backup',
    '_auth_v019_join_provenance_backup',
    '_auth_v019_membership_provenance_backup',
  ] as const;
  for (const table of backups) db.exec(`DROP TABLE IF EXISTS ${table}`);

  db.exec(`CREATE TABLE _auth_v019_claims_backup AS
    SELECT * FROM _auth_tenant_domain_claims`);
  db.exec(`CREATE TABLE _auth_v019_policies_backup AS
    SELECT * FROM _auth_tenant_domain_policies`);
  db.exec(`CREATE TABLE _auth_v019_transactions_backup AS
    SELECT * FROM _auth_domain_onboarding_transactions`);
  db.exec(`CREATE TABLE _auth_v019_join_provenance_backup AS
    SELECT * FROM _auth_domain_join_request_provenance`);
  db.exec(`CREATE TABLE _auth_v019_membership_provenance_backup AS
    SELECT * FROM _auth_tenant_membership_provenance`);

  // Children must disappear first. Foreign keys stay enabled throughout the
  // migration, so an unknown dependent fails the parent drop instead of being
  // silently orphaned.
  db.exec('DROP TABLE _auth_tenant_membership_provenance');
  db.exec('DROP TABLE _auth_domain_join_request_provenance');
  db.exec('DROP TABLE _auth_domain_onboarding_transactions');
  db.exec('DROP TABLE _auth_tenant_domain_policies');
  db.exec('DROP TABLE _auth_tenant_domain_claims');

  createReleaseClaimGraph(db);

  db.exec(`
    INSERT INTO _auth_tenant_domain_claims (
      claim_id, tenant_id, domain, status, proof_method,
      challenge_digest, challenge_expires_at, verification_digest,
      verified_at, last_checked_at, next_check_at, valid_until,
      revision, lease_owner, lease_expires_at, created_by,
      created_at, updated_at, released_at, released_by, quarantine_until
    )
    SELECT claim_id, tenant_id, domain, status, proof_method,
      challenge_digest, challenge_expires_at, verification_digest,
      verified_at, last_checked_at, next_check_at, valid_until,
      revision, lease_owner, lease_expires_at, created_by,
      created_at, updated_at, NULL, NULL, NULL
    FROM _auth_v019_claims_backup
  `);
  db.exec(`INSERT INTO _auth_tenant_domain_policies
    SELECT * FROM _auth_v019_policies_backup`);
  db.exec(`INSERT INTO _auth_domain_onboarding_transactions
    SELECT * FROM _auth_v019_transactions_backup`);
  db.exec(`INSERT INTO _auth_domain_join_request_provenance
    SELECT * FROM _auth_v019_join_provenance_backup`);
  db.exec(`INSERT INTO _auth_tenant_membership_provenance
    SELECT * FROM _auth_v019_membership_provenance_backup`);

  for (const table of [...backups].reverse()) db.exec(`DROP TABLE ${table}`);
  const violations = db.prepare('PRAGMA foreign_key_check').all();
  if (violations.length > 0) {
    throw new Error('[auth] Verified-domain release migration failed foreign-key validation.');
  }
}

function createReleaseClaimGraph(db: ReactiveDB): void {
  db.exec(`
    CREATE TABLE _auth_tenant_domain_claims (
      claim_id             TEXT PRIMARY KEY,
      tenant_id            TEXT NOT NULL,
      domain               TEXT NOT NULL,
      status               TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'verified', 'grace', 'lost')),
      proof_method         TEXT NOT NULL DEFAULT 'dns-txt'
                           CHECK (proof_method = 'dns-txt'),
      challenge_digest     TEXT,
      challenge_expires_at INTEGER,
      verification_digest  TEXT,
      verified_at          INTEGER,
      last_checked_at      INTEGER,
      next_check_at        INTEGER,
      valid_until          INTEGER,
      revision             INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      lease_owner          TEXT,
      lease_expires_at     INTEGER,
      created_by           TEXT,
      created_at           INTEGER NOT NULL,
      updated_at           INTEGER NOT NULL,
      released_at          INTEGER,
      released_by          TEXT,
      quarantine_until     INTEGER,
      FOREIGN KEY (tenant_id) REFERENCES _auth_tenants(tenant_id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL,
      FOREIGN KEY (released_by) REFERENCES users(user_id) ON DELETE SET NULL,
      CHECK ((challenge_digest IS NULL) = (challenge_expires_at IS NULL)),
      CHECK (
        (released_at IS NULL AND released_by IS NULL AND quarantine_until IS NULL)
        OR (released_at IS NOT NULL AND quarantine_until IS NOT NULL)
      ),
      CHECK (quarantine_until IS NULL OR quarantine_until >= released_at),
      CHECK (
        released_at IS NULL OR (
          challenge_digest IS NULL AND challenge_expires_at IS NULL
          AND verification_digest IS NULL AND next_check_at IS NULL
          AND valid_until IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL
        )
      )
    )
  `);
  db.exec(`
    CREATE TABLE _auth_tenant_domain_policies (
      claim_id          TEXT PRIMARY KEY,
      enabled           INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
      admission         TEXT NOT NULL DEFAULT 'request-to-join'
                        CHECK (admission = 'request-to-join'),
      request_role_key  TEXT,
      revision          INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      updated_by        TEXT,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL,
      FOREIGN KEY (claim_id) REFERENCES _auth_tenant_domain_claims(claim_id)
        ON DELETE CASCADE,
      FOREIGN KEY (updated_by) REFERENCES users(user_id) ON DELETE SET NULL,
      CHECK (enabled = 0 OR request_role_key IS NOT NULL)
    )
  `);
  db.exec(`
    CREATE TABLE _auth_domain_onboarding_transactions (
      transaction_id           TEXT PRIMARY KEY,
      application_id           TEXT NOT NULL,
      user_id                  TEXT NOT NULL,
      email                    TEXT NOT NULL,
      email_generation         INTEGER NOT NULL CHECK (email_generation >= 1),
      auth_generation          INTEGER NOT NULL CHECK (auth_generation >= 0),
      identity_kind            TEXT NOT NULL CHECK (identity_kind IN ('session', 'continuation')),
      identity_continuation_id TEXT,
      mailbox_proof_id         TEXT NOT NULL,
      domain                   TEXT NOT NULL,
      claim_id                 TEXT NOT NULL,
      claim_revision           INTEGER NOT NULL CHECK (claim_revision >= 1),
      policy_revision          INTEGER NOT NULL CHECK (policy_revision >= 1),
      tenant_id                TEXT NOT NULL,
      request_role_key         TEXT NOT NULL,
      token_hash               TEXT NOT NULL UNIQUE,
      expires_at               INTEGER NOT NULL,
      consumed_at              INTEGER,
      created_at               INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (identity_continuation_id)
        REFERENCES _auth_session_continuations(continuation_id) ON DELETE CASCADE,
      FOREIGN KEY (mailbox_proof_id) REFERENCES _auth_mailbox_proofs(proof_id)
        ON DELETE CASCADE,
      FOREIGN KEY (claim_id) REFERENCES _auth_tenant_domain_claims(claim_id)
        ON DELETE CASCADE,
      FOREIGN KEY (tenant_id) REFERENCES _auth_tenants(tenant_id) ON DELETE CASCADE,
      CHECK (
        (identity_kind = 'session' AND identity_continuation_id IS NULL)
        OR (identity_kind = 'continuation' AND identity_continuation_id IS NOT NULL)
      )
    )
  `);
  db.exec(`
    CREATE TABLE _auth_domain_join_request_provenance (
      join_request_id  TEXT PRIMARY KEY,
      tenant_id        TEXT NOT NULL,
      user_id          TEXT NOT NULL,
      claim_id         TEXT NOT NULL,
      domain           TEXT NOT NULL,
      request_role_key TEXT NOT NULL,
      mailbox_proof_id TEXT,
      blocked_until    INTEGER,
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL,
      FOREIGN KEY (join_request_id) REFERENCES _auth_tenant_join_requests(join_request_id)
        ON DELETE CASCADE,
      FOREIGN KEY (tenant_id) REFERENCES _auth_tenants(tenant_id) ON DELETE CASCADE,
      FOREIGN KEY (claim_id) REFERENCES _auth_tenant_domain_claims(claim_id)
        ON DELETE RESTRICT,
      FOREIGN KEY (mailbox_proof_id) REFERENCES _auth_mailbox_proofs(proof_id)
        ON DELETE SET NULL
    )
  `);
  db.exec(`
    CREATE TABLE _auth_tenant_membership_provenance (
      membership_id    TEXT PRIMARY KEY,
      source           TEXT NOT NULL CHECK (source IN ('domain-request')),
      source_id        TEXT NOT NULL,
      claim_id         TEXT NOT NULL,
      domain           TEXT NOT NULL,
      recorded_at      INTEGER NOT NULL,
      FOREIGN KEY (membership_id) REFERENCES _auth_tenant_memberships(membership_id)
        ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES _auth_tenant_join_requests(join_request_id)
        ON DELETE RESTRICT,
      FOREIGN KEY (claim_id) REFERENCES _auth_tenant_domain_claims(claim_id)
        ON DELETE RESTRICT
    )
  `);
  defineReleaseClaimIndexes(db);
}

function defineReleaseClaimIndexes(db: Pick<ReactiveDB, 'exec'>): void {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_domain_claims_tenant
    ON _auth_tenant_domain_claims(tenant_id, released_at, created_at, claim_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_domain_claims_due
    ON _auth_tenant_domain_claims(released_at, status, next_check_at, lease_expires_at)`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_domain_claims_active_domain
    ON _auth_tenant_domain_claims(domain) WHERE released_at IS NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_domain_claims_quarantine
    ON _auth_tenant_domain_claims(domain, quarantine_until)
    WHERE released_at IS NOT NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_domain_transactions_cleanup
    ON _auth_domain_onboarding_transactions(expires_at, consumed_at)`);
}

function defineReleasedDomainProvenanceTables(db: Pick<ReactiveDB, 'exec'>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_released_domain_join_provenance (
      claim_id         TEXT NOT NULL,
      join_request_id  TEXT NOT NULL,
      tenant_id        TEXT NOT NULL,
      user_id          TEXT NOT NULL,
      domain           TEXT NOT NULL,
      request_role_key TEXT NOT NULL,
      released_at      INTEGER NOT NULL,
      blocked_until    INTEGER NOT NULL,
      released_by      TEXT,
      PRIMARY KEY (claim_id, join_request_id),
      FOREIGN KEY (claim_id) REFERENCES _auth_tenant_domain_claims(claim_id)
        ON DELETE RESTRICT,
      FOREIGN KEY (join_request_id) REFERENCES _auth_tenant_join_requests(join_request_id)
        ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id) REFERENCES _auth_tenants(tenant_id) ON DELETE CASCADE,
      FOREIGN KEY (released_by) REFERENCES users(user_id) ON DELETE SET NULL,
      CHECK (blocked_until >= released_at)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_released_domain_join_tenant
    ON _auth_released_domain_join_provenance(
      tenant_id, released_at DESC, claim_id, join_request_id
    )`);
}

function defineReleasedClaimImmutabilityTriggers(db: Pick<ReactiveDB, 'exec'>): void {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_auth_released_domain_claim_immutable
    BEFORE UPDATE OF
      claim_id, tenant_id, domain, status, proof_method, challenge_digest,
      challenge_expires_at, verification_digest, verified_at, last_checked_at,
      next_check_at, valid_until, revision, lease_owner, lease_expires_at,
      created_at, updated_at, released_at, quarantine_until
    ON _auth_tenant_domain_claims
    WHEN OLD.released_at IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'AUTH_RELEASED_DOMAIN_CLAIM_IMMUTABLE');
    END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_auth_released_domain_claim_actor_null_only
    BEFORE UPDATE OF created_by, released_by ON _auth_tenant_domain_claims
    WHEN OLD.released_at IS NOT NULL AND (
      (NEW.created_by IS NOT OLD.created_by AND NEW.created_by IS NOT NULL)
      OR (NEW.released_by IS NOT OLD.released_by AND NEW.released_by IS NOT NULL)
    )
    BEGIN
      SELECT RAISE(ABORT, 'AUTH_RELEASED_DOMAIN_CLAIM_IMMUTABLE');
    END
  `);
  // The operational provenance row follows the retained join request and may
  // point at a fresh claim after cooldown. Release history is frozen in the
  // dedicated snapshot table below instead of making legitimate retry fail.
  db.exec('DROP TRIGGER IF EXISTS trg_auth_released_domain_join_provenance_immutable');
  db.exec('DROP TRIGGER IF EXISTS trg_auth_released_domain_join_history_immutable');
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_auth_released_domain_join_history_immutable
    BEFORE UPDATE OF
      claim_id, join_request_id, tenant_id, user_id, domain,
      request_role_key, source, request_revision, released_at, blocked_until
    ON _auth_released_domain_join_provenance
    BEGIN
      SELECT RAISE(ABORT, 'AUTH_RELEASED_DOMAIN_PROVENANCE_IMMUTABLE');
    END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_auth_released_domain_join_history_actor_null_only
    BEFORE UPDATE OF released_by ON _auth_released_domain_join_provenance
    WHEN NEW.released_by IS NOT OLD.released_by AND NEW.released_by IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'AUTH_RELEASED_DOMAIN_PROVENANCE_IMMUTABLE');
    END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_auth_released_domain_membership_provenance_immutable
    BEFORE UPDATE OF membership_id, source, source_id, claim_id, domain, recorded_at
    ON _auth_tenant_membership_provenance
    WHEN EXISTS (
      SELECT 1 FROM _auth_tenant_domain_claims claim
      WHERE claim.claim_id = OLD.claim_id AND claim.released_at IS NOT NULL
    )
    BEGIN
      SELECT RAISE(ABORT, 'AUTH_RELEASED_DOMAIN_PROVENANCE_IMMUTABLE');
    END
  `);
}

function assertKnownClaimDependents(db: ReactiveDB): void {
  const expected = new Set([
    '_auth_tenant_domain_policies',
    '_auth_domain_onboarding_transactions',
    '_auth_domain_join_request_provenance',
    '_auth_tenant_membership_provenance',
  ]);
  const tables = db.prepare(`SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{ name: string }>;
  for (const { name } of tables) {
    const escaped = name.replaceAll('"', '""');
    const foreignKeys = db.prepare(`PRAGMA foreign_key_list("${escaped}")`).all() as Array<{
      table: string;
    }>;
    if (foreignKeys.some((foreignKey) => (
      foreignKey.table === '_auth_tenant_domain_claims'
    )) && !expected.has(name)) {
      throw new Error(
        `[auth] Cannot upgrade verified-domain release schema with unknown claim dependent: ${name}`,
      );
    }
  }
}

/** Widen the private request-admission enum without rewriting migration 013. */
export function ensureVerifiedDomainAdmissionFlow(db: ReactiveDB): void {
  const row = db.prepare(`SELECT sql FROM sqlite_master
    WHERE type = 'table' AND name = '_auth_request_admissions'`).get() as {
      sql: string;
    } | null;
  if (!row || row.sql.includes("'domain-onboarding'")) return;
  runSchemaTransaction(db, () => {
    db.exec('ALTER TABLE _auth_request_admissions RENAME TO _auth_request_admissions_pre_domain');
    db.exec(`
      CREATE TABLE _auth_request_admissions (
        admission_id TEXT PRIMARY KEY,
        flow         TEXT NOT NULL,
        source_hash  TEXT,
        subject_hash TEXT,
        created_at   INTEGER NOT NULL,
        CHECK (flow IN (
          'bootstrap', 'registration', 'login', 'invitation', 'join-request',
          'domain-onboarding'
        ))
      )
    `);
    db.exec(`INSERT INTO _auth_request_admissions
      SELECT * FROM _auth_request_admissions_pre_domain`);
    db.exec('DROP TABLE _auth_request_admissions_pre_domain');
    defineAdmissionIndexes(db);
  });
}

/** Add a secret-free, identity-bound domain-mail job to the durable outbox. */
export function ensureVerifiedDomainOutboxSupport(db: ReactiveDB): void {
  const columns = db.prepare('PRAGMA table_info(_auth_email_outbox)').all() as Array<{
    name: string;
  }>;
  if (columns.length === 0
    || columns.some((column) => column.name === 'domain_user_id')) return;
  runSchemaTransaction(db, () => {
    db.exec('ALTER TABLE _auth_email_outbox RENAME TO _auth_email_outbox_pre_domain');
    db.exec(`
      CREATE TABLE _auth_email_outbox (
        job_id                         TEXT PRIMARY KEY,
        kind                           TEXT NOT NULL CHECK (kind IN (
                                         'password_reset', 'email_verification',
                                         'tenant_invitation', 'domain_mailbox_proof'
                                       )),
        recipient                      TEXT NOT NULL,
        recipient_hash                 TEXT NOT NULL,
        native_continuation             TEXT,
        invitation_id                  TEXT,
        secret_envelope                TEXT,
        domain_user_id                 TEXT,
        domain_email_generation        INTEGER,
        domain_auth_generation         INTEGER,
        domain_identity_kind           TEXT,
        domain_identity_continuation_id TEXT,
        status                         TEXT NOT NULL CHECK (status IN (
                                         'pending', 'processing', 'delivered',
                                         'suppressed', 'dead'
                                       )),
        attempts                       INTEGER NOT NULL DEFAULT 0,
        available_at                   INTEGER NOT NULL,
        lease_owner                    TEXT,
        lease_expires_at               INTEGER,
        created_at                     INTEGER NOT NULL,
        updated_at                     INTEGER NOT NULL,
        completed_at                   INTEGER,
        last_error_code                TEXT,
        FOREIGN KEY (invitation_id)
          REFERENCES _auth_tenant_invitations(invitation_id) ON DELETE SET NULL,
        FOREIGN KEY (domain_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
        FOREIGN KEY (domain_identity_continuation_id)
          REFERENCES _auth_session_continuations(continuation_id) ON DELETE CASCADE,
        CHECK (
          (kind = 'tenant_invitation' AND invitation_id IS NOT NULL)
          OR (kind != 'tenant_invitation' AND invitation_id IS NULL
              AND secret_envelope IS NULL)
        ),
        CHECK (
          kind != 'tenant_invitation' OR secret_envelope IS NOT NULL
          OR status IN ('delivered', 'suppressed', 'dead')
        ),
        CHECK (
          (kind = 'domain_mailbox_proof'
            AND domain_user_id IS NOT NULL
            AND domain_email_generation IS NOT NULL
            AND domain_auth_generation IS NOT NULL
            AND domain_identity_kind IN ('session', 'continuation')
            AND ((domain_identity_kind = 'session'
                    AND domain_identity_continuation_id IS NULL)
              OR (domain_identity_kind = 'continuation'
                    AND domain_identity_continuation_id IS NOT NULL)))
          OR (kind != 'domain_mailbox_proof'
            AND domain_user_id IS NULL
            AND domain_email_generation IS NULL
            AND domain_auth_generation IS NULL
            AND domain_identity_kind IS NULL
            AND domain_identity_continuation_id IS NULL)
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
        invitation_id, secret_envelope, status, attempts, available_at,
        lease_owner, lease_expires_at, created_at, updated_at, completed_at,
        last_error_code
      FROM _auth_email_outbox_pre_domain
    `);
    db.exec('DROP TABLE _auth_email_outbox_pre_domain');
    db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_email_outbox_due
      ON _auth_email_outbox(status, available_at, created_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_email_outbox_recipient
      ON _auth_email_outbox(recipient_hash, kind, created_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_email_outbox_terminal
      ON _auth_email_outbox(completed_at)`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_email_outbox_invitation
      ON _auth_email_outbox(invitation_id) WHERE invitation_id IS NOT NULL`);
  });
}

function ensureColumn(
  db: ReactiveDB,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((candidate) => candidate.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function tableColumns(db: ReactiveDB, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>).map((column) => column.name));
}

function defineAdmissionIndexes(db: Pick<ReactiveDB, 'exec'>): void {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_request_admissions_flow_created
    ON _auth_request_admissions(flow, created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_request_admissions_source_created
    ON _auth_request_admissions(flow, source_hash, created_at)
    WHERE source_hash IS NOT NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_request_admissions_subject_created
    ON _auth_request_admissions(flow, subject_hash, created_at)
    WHERE subject_hash IS NOT NULL`);
}

function runSchemaTransaction(db: ReactiveDB, callback: () => void): void {
  const result = (db as unknown as {
    transaction<T>(fn: () => T): T | (() => T);
  }).transaction(callback);
  if (typeof result === 'function') result();
}
