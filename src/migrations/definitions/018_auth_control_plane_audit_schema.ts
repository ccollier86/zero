import type { ReactiveDB } from '../../sync/reactive-db';

/**
 * Immutable v018 append-only audit schema.
 *
 * Internal append-only audit schema. It is intentionally raw and `_`-prefixed,
 * so ReactiveDB/Sync never publishes it as application data.
 */
export function defineAuthAuditTables(db: ReactiveDB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_audit_events (
      event_id             TEXT PRIMARY KEY,
      occurred_at          INTEGER NOT NULL,
      action               TEXT NOT NULL,
      outcome              TEXT NOT NULL CHECK (outcome IN ('succeeded', 'denied', 'failed')),
      reason               TEXT,
      scope_kind           TEXT NOT NULL CHECK (scope_kind IN ('application', 'tenant')),
      tenant_id            TEXT,
      actor_user_id        TEXT,
      actor_membership_id  TEXT,
      actor_session_id     TEXT,
      actor_session_kind   TEXT CHECK (actor_session_kind IS NULL OR actor_session_kind IN ('web', 'native')),
      actor_client_id      TEXT,
      actor_provenance     TEXT NOT NULL CHECK (actor_provenance IN (
        'authenticated-request', 'bootstrap', 'account-recovery', 'registration', 'system'
      )),
      request_id           TEXT,
      correlation_id       TEXT,
      target_type          TEXT,
      target_id            TEXT,
      metadata_json        TEXT NOT NULL DEFAULT '{}',
      CHECK (
        (scope_kind = 'tenant' AND tenant_id IS NOT NULL)
        OR (scope_kind = 'application' AND tenant_id IS NULL)
      )
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auth_audit_events_time
    ON _auth_audit_events (occurred_at DESC, event_id DESC)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auth_audit_events_tenant_time
    ON _auth_audit_events (tenant_id, occurred_at DESC, event_id DESC)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auth_audit_events_action_time
    ON _auth_audit_events (action, occurred_at DESC, event_id DESC)
  `);

  // A singleton gate makes deletion an explicit retention operation instead
  // of an ordinary table mutation. Audit rows can never be updated in place.
  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_audit_retention_gate (
      gate_id       INTEGER PRIMARY KEY CHECK (gate_id = 1),
      enabled       INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
      cutoff_at     INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.exec(`
    INSERT OR IGNORE INTO _auth_audit_retention_gate (gate_id, enabled, cutoff_at)
    VALUES (1, 0, 0)
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_auth_audit_events_no_update
    BEFORE UPDATE ON _auth_audit_events
    BEGIN
      SELECT RAISE(ABORT, 'auth audit events are append-only');
    END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_auth_audit_events_retention_delete_only
    BEFORE DELETE ON _auth_audit_events
    WHEN NOT EXISTS (
      SELECT 1 FROM _auth_audit_retention_gate
      WHERE gate_id = 1 AND enabled = 1 AND OLD.occurred_at < cutoff_at
    )
    BEGIN
      SELECT RAISE(ABORT, 'auth audit deletion requires an eligible retention pass');
    END
  `);
}
