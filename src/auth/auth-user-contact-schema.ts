/** Fixed schema admission and additive queue-purpose upgrade; no provider activity. */
import type { ReactiveDB } from '../sync/reactive-db';
import { USER_CONTACT_SCHEMA_OBJECTS } from './auth-user-contact-schema-sql';
import { AUTH_EMAIL_OUTBOX_INDEX_SQL } from './auth-email-outbox-schema';

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

export function reconcileUserContactSchema(db: ReactiveDB, allowed: boolean): 'ready' | 'missing' | 'invalid' {
  const status = inspectUserContactSchema(db);
  if (status !== 'missing' || !allowed) return status;
  return db.transaction(() => {
    if (inspectUserContactSchema(db) === 'invalid') return 'invalid';
    widenContactEmailOutbox(db);
    for (const object of USER_CONTACT_SCHEMA_OBJECTS) db.exec(object.sql);
    return inspectUserContactSchema(db);
  });
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
