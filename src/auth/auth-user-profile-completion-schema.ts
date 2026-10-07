/** Fixed completion substrate; old tenant/domain continuation foreign keys are untouched. */
import type { ReactiveDB } from '../sync/reactive-db';
export const PROFILE_COMPLETION_SCHEMA = [
  { name: '_auth_profile_completion_policy', type: 'table', sql: `CREATE TABLE IF NOT EXISTS _auth_profile_completion_policy (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    policy_fingerprint TEXT NOT NULL CHECK (length(policy_fingerprint) = 64),
    updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
  )` },
  { name: '_auth_profile_completion_enrollments', type: 'table', sql: `CREATE TABLE IF NOT EXISTS _auth_profile_completion_enrollments (
    user_id TEXT PRIMARY KEY,
    origin TEXT NOT NULL CHECK (origin IN ('signup', 'invitation', 'existing')),
    policy_fingerprint TEXT NOT NULL CHECK (length(policy_fingerprint) = 64),
    completed_fingerprint TEXT CHECK (completed_fingerprint IS NULL OR length(completed_fingerprint) = 64),
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    CHECK ((completed_fingerprint IS NULL) = (completed_at IS NULL))
  )` },
  { name: '_auth_profile_completion_continuations', type: 'table', sql: `CREATE TABLE IF NOT EXISTS _auth_profile_completion_continuations (
    continuation_id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose = 'profile_completion'),
    token_hash TEXT NOT NULL UNIQUE,
    auth_generation INTEGER NOT NULL CHECK (auth_generation >= 0),
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER,
    created_at INTEGER NOT NULL,
    mfa_verified_at INTEGER CHECK (mfa_verified_at IS NULL OR mfa_verified_at >= 0),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
  )` },
  { name: '_auth_profile_completion_contexts', type: 'table', sql: `CREATE TABLE IF NOT EXISTS _auth_profile_completion_contexts (
    continuation_id TEXT PRIMARY KEY,
    policy_fingerprint TEXT NOT NULL CHECK (length(policy_fingerprint) = 64),
    session_binding_json TEXT CHECK (session_binding_json IS NULL OR length(session_binding_json) <= 1024),
    FOREIGN KEY (continuation_id) REFERENCES _auth_profile_completion_continuations(continuation_id) ON DELETE CASCADE
  )` },
  { name: 'idx_auth_profile_completion_user', type: 'index', sql: `CREATE INDEX IF NOT EXISTS idx_auth_profile_completion_user
    ON _auth_profile_completion_continuations(user_id, expires_at)` },
  { name: 'idx_auth_profile_completion_expiry', type: 'index', sql: `CREATE INDEX IF NOT EXISTS idx_auth_profile_completion_expiry
    ON _auth_profile_completion_continuations(expires_at, consumed_at)` },
] as const;

export function inspectProfileCompletionSchema(db: Pick<ReactiveDB, 'prepare'>): 'ready' | 'missing' | 'invalid' {
  let missing = false;
  for (const object of PROFILE_COMPLETION_SCHEMA) {
    const actual = db.prepare('SELECT type, sql FROM sqlite_master WHERE name = ?').get(object.name) as { type: string; sql: string | null } | null;
    if (!actual) { missing = true; continue; }
    if (actual.type !== object.type || !actual.sql || normalized(actual.sql) !== normalized(object.sql)) return 'invalid';
  }
  return missing ? 'missing' : 'ready';
}
export function reconcileProfileCompletionSchema(db: ReactiveDB, allowed: boolean): 'ready' | 'missing' | 'invalid' {
  const status = inspectProfileCompletionSchema(db);
  if (status !== 'missing' || !allowed) return status;
  return db.transaction(() => {
    if (inspectProfileCompletionSchema(db) === 'invalid') return 'invalid';
    for (const object of PROFILE_COMPLETION_SCHEMA) db.exec(object.sql);
    return inspectProfileCompletionSchema(db);
  });
}
function normalized(sql: string): string { return sql.replace(/\bIF\s+NOT\s+EXISTS\s+/gi, '').replace(/\s+/g, ' ').trim(); }
