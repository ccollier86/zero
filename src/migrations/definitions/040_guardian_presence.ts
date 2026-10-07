/** Immutable SYSTEM presence schema; no feature toggles or runtime helpers affect its checksum. */
import type { Migration } from '../types';

export const migration: Migration = {
  version: '040', description: 'Guardian scoped presence owner, intent and publication', safety: 'safe', backupRequired: false,
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS guardian_presence (
      id TEXT PRIMARY KEY, scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL, user_id TEXT NOT NULL,
      status_key TEXT NOT NULL, connected INTEGER NOT NULL, revision INTEGER NOT NULL,
      owner_epoch INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_guardian_presence_scope_user ON guardian_presence(scope_kind,scope_id,user_id);
    CREATE TABLE IF NOT EXISTS guardian_presence_owner (
      owner_key TEXT PRIMARY KEY, owner_epoch INTEGER NOT NULL, fresh_until INTEGER NOT NULL, retired INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS _guardian_presence_authority (
      owner_key TEXT PRIMARY KEY CHECK(owner_key='primary'), installation_id TEXT NOT NULL,
      owner_id TEXT NOT NULL, owner_epoch INTEGER NOT NULL CHECK(owner_epoch>0),
      lease_until INTEGER NOT NULL CHECK(lease_until>=0), next_revision INTEGER NOT NULL CHECK(next_revision>0)
    );
    CREATE TABLE IF NOT EXISTS _guardian_presence_intents (
      scope_kind TEXT NOT NULL CHECK(scope_kind IN ('application','tenant')), scope_id TEXT NOT NULL,
      user_id TEXT NOT NULL, status_key TEXT NOT NULL, expires_at INTEGER,
      revision INTEGER NOT NULL CHECK(revision>0), updated_at INTEGER NOT NULL,
      PRIMARY KEY(scope_kind,scope_id,user_id), FOREIGN KEY(user_id) REFERENCES users(user_id)
    );
    CREATE TABLE IF NOT EXISTS _guardian_presence_outbox (
      event_id TEXT PRIMARY KEY, scope_kind TEXT NOT NULL CHECK(scope_kind IN ('application','tenant')),
      scope_id TEXT NOT NULL, owner_epoch INTEGER NOT NULL, publication_revision INTEGER NOT NULL,
      payload_json TEXT NOT NULL, retry_at INTEGER NOT NULL DEFAULT 0, last_error TEXT,
      UNIQUE(scope_kind,scope_id,owner_epoch,publication_revision)
    );
    CREATE INDEX IF NOT EXISTS idx_guardian_presence_outbox_retry ON _guardian_presence_outbox(retry_at,publication_revision);`);
  },
  down(db) {
    db.exec('DROP TABLE IF EXISTS _guardian_presence_outbox; DROP TABLE IF EXISTS _guardian_presence_intents; DROP TABLE IF EXISTS _guardian_presence_authority; DROP TABLE IF EXISTS guardian_presence_owner; DROP TABLE IF EXISTS guardian_presence;');
  },
};
