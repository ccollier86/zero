/** Immutable request-admission schema owned by migration 012. */

import type { ReactiveDB } from '../../sync/reactive-db';

export function defineAuthRequestAdmissionTables(
  db: Pick<ReactiveDB, 'exec'>,
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_request_admissions (
      admission_id TEXT PRIMARY KEY,
      flow         TEXT NOT NULL,
      source_hash  TEXT,
      subject_hash TEXT,
      created_at   INTEGER NOT NULL,
      CHECK (flow IN ('bootstrap', 'registration', 'login'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_request_admissions_flow_created
    ON _auth_request_admissions(flow, created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_request_admissions_source_created
    ON _auth_request_admissions(flow, source_hash, created_at)
    WHERE source_hash IS NOT NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_request_admissions_subject_created
    ON _auth_request_admissions(flow, subject_hash, created_at)
    WHERE subject_hash IS NOT NULL`);
}
