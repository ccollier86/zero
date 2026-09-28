/** Durable marker for registrations whose downstream provisioning is unfinished. */

import type { ReactiveDB } from '../sync/reactive-db';

export const REGISTRATION_PROVISIONING_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS _auth_registration_provisioning (
    registration_id TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL UNIQUE,
    tenant_id       TEXT,
    is_bootstrap    INTEGER NOT NULL CHECK (is_bootstrap IN (0, 1)),
    lease_owner_hash TEXT CHECK (
      lease_owner_hash IS NULL OR length(lease_owner_hash) = 64
    ),
    lease_expires_at INTEGER,
    created_at      INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
  )
`;

/**
 * Define the current receipt shape and repair databases created by an earlier
 * prerelease build of migration 015. Nullable lease fields intentionally make
 * those historical receipts "unowned", so startup can recover them safely.
 */
export function defineRegistrationProvisioningTable(db: ReactiveDB): void {
  db.exec(REGISTRATION_PROVISIONING_TABLE_SQL);
  ensureColumn(
    db,
    'lease_owner_hash',
    'TEXT CHECK (lease_owner_hash IS NULL OR length(lease_owner_hash) = 64)',
  );
  ensureColumn(db, 'lease_expires_at', 'INTEGER');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auth_registration_provisioning_lease
    ON _auth_registration_provisioning(lease_expires_at)
  `);
}

function ensureColumn(
  db: ReactiveDB,
  column: 'lease_owner_hash' | 'lease_expires_at',
  definition: string,
): void {
  const columns = db.prepare(
    'PRAGMA table_info(_auth_registration_provisioning)',
  ).all() as Array<{ name: string }>;
  if (columns.some((candidate) => candidate.name === column)) return;
  db.exec(`ALTER TABLE _auth_registration_provisioning ADD COLUMN ${column} ${definition}`);
}
