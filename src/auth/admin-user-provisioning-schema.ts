/** Durable exact-state receipts for administrator-created setup accounts. */

import type { ReactiveDB } from '../sync/reactive-db';

export const ADMIN_USER_PROVISIONING_TABLE = '_auth_admin_user_provisioning';

export const ADMIN_USER_PROVISIONING_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ${ADMIN_USER_PROVISIONING_TABLE} (
    provisioning_id TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL UNIQUE,
    user_fingerprint TEXT NOT NULL,
    auth_generation INTEGER NOT NULL CHECK (auth_generation >= 0),
    setup_token_id   TEXT,
    lease_owner_hash TEXT NOT NULL CHECK (length(lease_owner_hash) = 64),
    lease_expires_at INTEGER NOT NULL,
    created_at       INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
  )
`;

/** Define the current private administrator-user provisioning schema. */
export function defineAdminUserProvisioningTable(db: ReactiveDB): void {
  db.exec(ADMIN_USER_PROVISIONING_TABLE_SQL);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auth_admin_user_provisioning_lease
    ON ${ADMIN_USER_PROVISIONING_TABLE}(lease_expires_at)
  `);
}
