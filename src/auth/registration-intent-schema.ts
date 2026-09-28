/** Internal durable registration choices that must not be caller-controlled on resend. */

import type { ReactiveDB } from '../sync/reactive-db';

export const LEGACY_REGISTRATION_INTENT_TABLE_SQL = `CREATE TABLE IF NOT EXISTS _auth_registration_intents (
  user_id TEXT PRIMARY KEY,
  mfa_enrollment_requested INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
)`;

export const REGISTRATION_INTENT_TABLE_SQL = `CREATE TABLE IF NOT EXISTS _auth_registration_intents (
  user_id TEXT PRIMARY KEY,
  mfa_enrollment_requested INTEGER NOT NULL DEFAULT 0,
  tenant_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
)`;

/** Define the current intent shape and upgrade pre-016 databases in place. */
export function defineRegistrationIntentTable(db: ReactiveDB): void {
  db.exec(REGISTRATION_INTENT_TABLE_SQL);
  const columns = db.prepare(
    'PRAGMA table_info(_auth_registration_intents)',
  ).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'tenant_id')) {
    db.exec('ALTER TABLE _auth_registration_intents ADD COLUMN tenant_id TEXT');
  }
}
