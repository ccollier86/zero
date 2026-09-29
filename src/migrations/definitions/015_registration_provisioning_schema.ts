/** Immutable schema helpers owned by migrations 015 and 016. */

interface HistoricalRegistrationSchemaDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): {
    all(...values: unknown[]): unknown[];
  };
}

export function defineRegistrationIntentTableV015(
  db: HistoricalRegistrationSchemaDatabase,
): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _auth_registration_intents (
    user_id TEXT PRIMARY KEY,
    mfa_enrollment_requested INTEGER NOT NULL DEFAULT 0,
    tenant_id TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
  )`);
  const columns = db.prepare('PRAGMA table_info(_auth_registration_intents)')
    .all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'tenant_id')) {
    db.exec('ALTER TABLE _auth_registration_intents ADD COLUMN tenant_id TEXT');
  }
}

export function defineRegistrationProvisioningTableV015(
  db: HistoricalRegistrationSchemaDatabase,
): void {
  db.exec(`
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
  `);
  ensureProvisioningColumn(
    db,
    'lease_owner_hash',
    'TEXT CHECK (lease_owner_hash IS NULL OR length(lease_owner_hash) = 64)',
  );
  ensureProvisioningColumn(db, 'lease_expires_at', 'INTEGER');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_registration_provisioning_lease
    ON _auth_registration_provisioning(lease_expires_at)`);
}

function ensureProvisioningColumn(
  db: HistoricalRegistrationSchemaDatabase,
  column: 'lease_owner_hash' | 'lease_expires_at',
  definition: string,
): void {
  const columns = db.prepare('PRAGMA table_info(_auth_registration_provisioning)')
    .all() as Array<{ name: string }>;
  if (columns.some((candidate) => candidate.name === column)) return;
  db.exec(`ALTER TABLE _auth_registration_provisioning
    ADD COLUMN ${column} ${definition}`);
}

export function authTokenEligibleUserSqlV016(alias: string): string {
  assertSqlIdentifier(alias);
  return `${alias}.status = 'active'
    AND ${alias}.password_change_required = 0
    AND (${alias}.email_verification_required = 0
      OR COALESCE(${alias}.email_verified_at, 0) > 0)`;
}

export function recoverableRegistrationUserSqlV016(alias: string): string {
  assertSqlIdentifier(alias);
  return recoverableRegistrationUserBaseSql(
    alias,
    'registration_intent.tenant_id IS NULL',
  );
}

export function recoverableTenantRegistrationUserSqlV016(
  userAlias: string,
  tenantAlias: string,
): string {
  assertSqlIdentifier(userAlias);
  assertSqlIdentifier(tenantAlias);
  return recoverableRegistrationUserBaseSql(
    userAlias,
    `registration_intent.tenant_id = ${tenantAlias}.tenant_id`,
  );
}

function recoverableRegistrationUserBaseSql(
  alias: string,
  intentScopeSql: string,
): string {
  return `${alias}.status = 'active'
    AND ${alias}.password_change_required = 0
    AND ${alias}.email_verification_required = 1
    AND (${alias}.email_verified_at IS NULL OR ${alias}.email_verified_at <= 0)
    AND EXISTS (
      SELECT 1 FROM _auth_registration_intents registration_intent
      WHERE registration_intent.user_id = ${alias}.user_id
        AND ${intentScopeSql}
    )`;
}

function assertSqlIdentifier(value: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid SQL identifier: ${value}`);
  }
}
