/** Fixed private SYSTEM contact state. No contact values are Sync tables. */
export const USER_CONTACT_SCHEMA_OBJECTS = [
  { name: '_auth_user_contacts', type: 'table', sql: `CREATE TABLE IF NOT EXISTS _auth_user_contacts (
    user_id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
    phone TEXT CHECK (phone IS NULL OR length(phone) BETWEEN 3 AND 16),
    phone_generation INTEGER NOT NULL DEFAULT 1 CHECK (phone_generation BETWEEN 1 AND 9007199254740991),
    email_proof_generation INTEGER,
    email_proved_at INTEGER,
    email_attested_generation INTEGER,
    email_attested_at INTEGER,
    phone_proof_generation INTEGER,
    phone_proved_at INTEGER,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    CHECK ((email_proof_generation IS NULL) = (email_proved_at IS NULL)),
    CHECK ((email_attested_generation IS NULL) = (email_attested_at IS NULL)),
    CHECK ((phone_proof_generation IS NULL) = (phone_proved_at IS NULL))
  )` },
  { name: '_auth_contact_challenges', type: 'table', sql: `CREATE TABLE IF NOT EXISTS _auth_contact_challenges (
    challenge_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('email_verify', 'email_change', 'phone_verify')),
    contact_value TEXT NOT NULL CHECK (length(contact_value) BETWEEN 1 AND 254),
    contact_generation INTEGER NOT NULL CHECK (contact_generation >= 1),
    auth_generation INTEGER NOT NULL CHECK (auth_generation >= 0),
    authority_json TEXT NOT NULL CHECK (length(authority_json) <= 8192),
    adapter_id TEXT,
    adapter_reference TEXT CHECK (adapter_reference IS NULL OR length(adapter_reference) BETWEEN 1 AND 1024),
    outbox_job_id TEXT UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'verified', 'cancelled')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
    delivery_attempts INTEGER NOT NULL DEFAULT 0 CHECK (delivery_attempts BETWEEN 0 AND 10),
    lease_owner TEXT,
    lease_expires_at INTEGER,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
    CHECK ((kind = 'phone_verify' AND adapter_id IS NOT NULL AND outbox_job_id IS NULL)
      OR (kind != 'phone_verify' AND adapter_id IS NULL AND adapter_reference IS NULL AND outbox_job_id IS NOT NULL))
  )` },
  { name: 'idx_auth_contact_challenges_user', type: 'index', sql: `CREATE INDEX IF NOT EXISTS idx_auth_contact_challenges_user
    ON _auth_contact_challenges(user_id, kind, created_at)` },
  { name: 'idx_auth_contact_challenges_due', type: 'index', sql: `CREATE INDEX IF NOT EXISTS idx_auth_contact_challenges_due
    ON _auth_contact_challenges(kind, status, lease_expires_at, expires_at)` },
  // Share the pre-existing exact generation trigger; do not install a second incrementer.
  { name: 'trg_auth_users_email_generation', type: 'trigger', sql: `CREATE TRIGGER IF NOT EXISTS trg_auth_users_email_generation
    AFTER UPDATE OF email ON users
    WHEN OLD.email IS NOT NEW.email
    BEGIN
      UPDATE users SET email_generation = OLD.email_generation + 1 WHERE user_id = NEW.user_id;
    END` },
  { name: 'trg_auth_contacts_email_revision_v1', type: 'trigger', sql: `CREATE TRIGGER IF NOT EXISTS trg_auth_contacts_email_revision_v1
    AFTER UPDATE OF email ON users
    WHEN OLD.email IS NOT NEW.email
    BEGIN
      INSERT INTO _auth_user_contacts(user_id, revision, updated_at) VALUES (NEW.user_id, 2, COALESCE(NEW.updated_at, NEW.created_at))
      ON CONFLICT(user_id) DO UPDATE SET revision = revision + 1, updated_at = excluded.updated_at;
      UPDATE _auth_contact_challenges SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL,
        adapter_reference = NULL, updated_at = COALESCE(NEW.updated_at, NEW.created_at)
        WHERE user_id = NEW.user_id AND status IN ('pending', 'delivered');
    END` },
] as const;
