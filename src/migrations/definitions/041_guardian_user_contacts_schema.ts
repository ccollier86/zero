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

/** Fixed schema admission and additive queue-purpose upgrade; no provider activity. */
import type { ReactiveDB } from '../../sync/reactive-db';

const AUTH_EMAIL_OUTBOX_INDEX_SQL = [
  'CREATE INDEX IF NOT EXISTS idx_auth_email_outbox_due ON _auth_email_outbox(status, available_at, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_auth_email_outbox_recipient ON _auth_email_outbox(recipient_hash, kind, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_auth_email_outbox_terminal ON _auth_email_outbox(completed_at)',
];

export function inspectUserContactSchema(db: Pick<ReactiveDB, 'prepare'>): 'ready' | 'missing' | 'invalid' {
  let missing = false;
  for (const object of USER_CONTACT_SCHEMA_OBJECTS) {
    const actual = db.prepare('SELECT type, sql FROM sqlite_master WHERE name = ?').get(object.name) as { type: string; sql: string | null } | null;
    if (!actual) { missing = true; continue; }
    if (actual.type !== object.type || !actual.sql || normalized(actual.sql) !== normalized(object.sql)) return 'invalid';
  }
  const queue = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '_auth_email_outbox'").get() as { sql: string } | null;
  if (!queue) missing = true;
  else {
    const kinds = queueKinds(queue.sql);
    if (!kinds) return 'invalid';
    if (!kinds.includes("'profile_contact_verification'")) missing = true;
  }
  return missing ? 'missing' : 'ready';
}

/** Preserve every queue column, foreign key and queued job while widening only its known enum. */
export function widenContactEmailOutbox(db: Pick<ReactiveDB, 'prepare' | 'exec'>): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '_auth_email_outbox'").get() as { sql: string } | null;
  if (!row) throw new Error('[auth] Contact email queue schema is unavailable.');
  const pattern = /CHECK\s*\(\s*kind\s+IN\s*\(([^)]*)\)\s*\)/i;
  const kinds = queueKinds(row.sql);
  if (!kinds) throw new Error('[auth] Contact email queue schema is incompatible.');
  if (kinds.includes("'profile_contact_verification'")) return;
  const columns = db.prepare('PRAGMA table_info(_auth_email_outbox)').all() as Array<{ name: string }>;
  const safeColumns = new Set(['job_id', 'kind', 'recipient', 'recipient_hash', 'native_continuation', 'invitation_id', 'secret_envelope',
    'domain_user_id', 'domain_email_generation', 'domain_auth_generation', 'domain_identity_kind', 'domain_identity_continuation_id',
    'status', 'attempts', 'available_at', 'lease_owner', 'lease_expires_at', 'created_at', 'updated_at', 'completed_at', 'last_error_code']);
  if (columns.some(column => !safeColumns.has(column.name))) throw new Error('[auth] Contact email queue schema is incompatible.');
  const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = '_auth_email_outbox' AND sql IS NOT NULL").all() as Array<{ sql: string }>;
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND tbl_name = '_auth_email_outbox' LIMIT 1").get()) {
    throw new Error('[auth] Contact email queue schema has an unsupported trigger; migration cannot discard it.');
  }
  db.exec('ALTER TABLE _auth_email_outbox RENAME TO _auth_email_outbox_pre_contacts');
  db.exec(row.sql.replace(pattern, `CHECK (kind IN (${[...kinds, "'profile_contact_verification'"].join(', ')}))`));
  const names = columns.map(column => `"${column.name}"`).join(', ');
  db.exec(`INSERT INTO _auth_email_outbox (${names}) SELECT ${names} FROM _auth_email_outbox_pre_contacts`);
  db.exec('DROP TABLE _auth_email_outbox_pre_contacts');
  for (const index of indexes) db.exec(index.sql);
  for (const sql of AUTH_EMAIL_OUTBOX_INDEX_SQL) db.exec(sql);
}

function queueKinds(sql: string): string[] | null {
  const matched = /CHECK\s*\(\s*kind\s+IN\s*\(([^)]*)\)\s*\)/i.exec(sql);
  if (!matched) return null;
  const kinds = matched[1]!.split(',').map(value => value.trim());
  const allowed = ["'password_reset'", "'email_verification'", "'tenant_invitation'", "'domain_mailbox_proof'", "'profile_contact_verification'"];
  return new Set(kinds).size !== kinds.length || kinds.some(kind => !allowed.includes(kind))
    || !kinds.includes("'password_reset'") || !kinds.includes("'email_verification'") ? null : kinds;
}

function normalized(sql: string): string {
  return sql.replace(/\bIF\s+NOT\s+EXISTS\s+/gi, '').replace(/\s+/g, ' ').trim();
}
