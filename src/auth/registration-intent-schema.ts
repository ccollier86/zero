/** Internal durable registration choices that must not be caller-controlled on resend. */

export const REGISTRATION_INTENT_TABLE_SQL = `CREATE TABLE IF NOT EXISTS _auth_registration_intents (
  user_id TEXT PRIMARY KEY,
  mfa_enrollment_requested INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
)`;
