/** Internal SQLite schema for durable public auth request admission. */

import type { ReactiveDB } from '../sync/reactive-db';
import type { AuthRequestAdmissionFlow } from './auth-request-admission-types';

export function defineAuthRequestAdmissionTables(db: Pick<ReactiveDB, 'exec'>): void {
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

/**
 * Current public-auth admission flows.
 *
 * `defineAuthRequestAdmissionTables()` above intentionally remains migration
 * 012's three-flow schema. Runtime creation and new migrations use this
 * exhaustive current list instead of mutating that historical dependency.
 */
export const AUTH_REQUEST_ADMISSION_FLOWS = [
  'bootstrap',
  'registration',
  'login',
  'invitation',
  'join-request',
  'domain-onboarding',
] as const satisfies readonly AuthRequestAdmissionFlow[];

type MissingAuthRequestAdmissionFlow = Exclude<
  AuthRequestAdmissionFlow,
  (typeof AUTH_REQUEST_ADMISSION_FLOWS)[number]
>;

// A new AuthRequestAdmissionFlow cannot compile until the durable schema list
// above is widened too.
const AUTH_REQUEST_ADMISSION_FLOW_COVERAGE:
  [MissingAuthRequestAdmissionFlow] extends [never] ? true : never = true;

const CURRENT_AUTH_REQUEST_ADMISSION_TABLE_BODY = `(
      admission_id TEXT PRIMARY KEY,
      flow         TEXT NOT NULL,
      source_hash  TEXT,
      subject_hash TEXT,
      created_at   INTEGER NOT NULL,
      CHECK (flow IN (${AUTH_REQUEST_ADMISSION_FLOWS.map((flow) => `'${flow}'`).join(', ')}))
    )`;

/**
 * Create or upgrade the runtime admission table to the complete current flow
 * contract while preserving every pseudonymous accounting row.
 */
export function defineCurrentAuthRequestAdmissionTables(db: ReactiveDB): void {
  void AUTH_REQUEST_ADMISSION_FLOW_COVERAGE;
  const statement = db.prepare(`
    SELECT sql FROM sqlite_master
    WHERE type = 'table' AND name = '_auth_request_admissions'
  `);
  let row: { sql: string } | null;
  try {
    row = statement.get() as { sql: string } | null;
  } finally {
    statement.finalize();
  }
  const expectedSql = normalizeSql(
    `CREATE TABLE _auth_request_admissions ${CURRENT_AUTH_REQUEST_ADMISSION_TABLE_BODY}`,
  );

  if (!row) {
    createCurrentAuthRequestAdmissionTable(db);
    defineCurrentAuthRequestAdmissionIndexes(db);
    return;
  }

  if (normalizeSql(row.sql) !== expectedSql) {
    db.transaction(() => {
      db.exec(`ALTER TABLE _auth_request_admissions
        RENAME TO _auth_request_admissions_pre_v022`);
      createCurrentAuthRequestAdmissionTable(db);
      db.exec(`
        INSERT INTO _auth_request_admissions (
          admission_id, flow, source_hash, subject_hash, created_at
        )
        SELECT admission_id, flow, source_hash, subject_hash, created_at
        FROM _auth_request_admissions_pre_v022
      `);
      db.exec('DROP TABLE _auth_request_admissions_pre_v022');
      defineCurrentAuthRequestAdmissionIndexes(db);
    });
    return;
  }

  defineCurrentAuthRequestAdmissionIndexes(db);
}

function createCurrentAuthRequestAdmissionTable(db: Pick<ReactiveDB, 'exec'>): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _auth_request_admissions
    ${CURRENT_AUTH_REQUEST_ADMISSION_TABLE_BODY}`);
}

function defineCurrentAuthRequestAdmissionIndexes(db: Pick<ReactiveDB, 'exec'>): void {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_request_admissions_flow_created
    ON _auth_request_admissions(flow, created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_request_admissions_source_created
    ON _auth_request_admissions(flow, source_hash, created_at)
    WHERE source_hash IS NOT NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_request_admissions_subject_created
    ON _auth_request_admissions(flow, subject_hash, created_at)
    WHERE subject_hash IS NOT NULL`);
}

function normalizeSql(sql: string): string {
  return sql.toLowerCase().replace(/\s+/g, '');
}
