/** Immutable authority-revision trigger contract owned by migration 020. */

interface AuthorityRevisionDatabaseV020 {
  exec(sql: string): unknown;
  prepare(sql: string): {
    get(...values: unknown[]): unknown;
  };
}

interface AuthorityTableTargetV020 {
  readonly table: string;
  readonly updateColumns: readonly string[];
  readonly updateTriggerVersion?: number;
}

const AUTHORITY_TABLES_V020: readonly AuthorityTableTargetV020[] = [
  {
    table: 'users',
    updateColumns: [
      'email',
      'role',
      'status',
      'password_change_required',
      'email_verification_required',
      'email_verified_at',
      'mfa_required',
      'email_generation',
    ],
    updateTriggerVersion: 2,
  },
  { table: 'user_properties', updateColumns: [] },
  { table: '_auth_user_generations', updateColumns: ['generation'] },
  {
    table: '_auth_sessions',
    updateColumns: [
      'status',
      'generation',
      'scope_kind',
      'scope_id',
      'tenant_id',
      'membership_id',
      'tenant_authorization_generation',
      'membership_authorization_generation',
    ],
  },
  {
    table: '_auth_tenants',
    updateColumns: ['status', 'authorization_generation'],
  },
  {
    table: '_auth_tenant_memberships',
    updateColumns: [
      'tenant_id',
      'user_id',
      'status',
      'role_key',
      'authorization_generation',
    ],
  },
  {
    table: '_auth_installed_profile',
    updateColumns: ['version', 'generation', 'tenancy', 'authorization'],
  },
  {
    table: '_auth_application_authorization_state',
    updateColumns: ['user_id', 'authorization_generation'],
  },
  { table: '_auth_application_role_assignments', updateColumns: [] },
  { table: '_auth_tenant_membership_roles', updateColumns: [] },
  {
    table: '_auth_native_sessions',
    updateColumns: [
      'user_id',
      'client_id',
      'scope',
      'auth_generation',
      'expires_at',
      'consumed_at',
      'revoked_at',
      'scope_kind',
      'scope_id',
      'tenant_id',
      'membership_id',
      'tenant_authorization_generation',
      'membership_authorization_generation',
    ],
  },
];

export function installAuthAuthorityRevisionV020(
  db: AuthorityRevisionDatabaseV020,
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_authority_revision (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
    )
  `);
  db.exec(`INSERT OR IGNORE INTO _auth_authority_revision (singleton, revision)
    VALUES (1, 0)`);

  for (const target of AUTHORITY_TABLES_V020) {
    if (!sqliteTableExists(db, target.table)) continue;
    installTableTriggersV020(db, target);
  }
}

function installTableTriggersV020(
  db: AuthorityRevisionDatabaseV020,
  target: AuthorityTableTargetV020,
): void {
  const table = quoteIdentifier(target.table);
  const safeName = target.table.replace(/[^A-Za-z0-9_]/g, '_');
  for (const operation of ['insert', 'delete', 'update'] as const) {
    const triggerVersion = operation === 'update'
      ? target.updateTriggerVersion ?? 1
      : 1;
    const trigger = quoteIdentifier(
      `trg_zero_authority_${safeName}_${operation}_v${triggerVersion}`,
    );
    const updateColumns = operation === 'update' && target.updateColumns.length > 0
      ? ` OF ${target.updateColumns.map(quoteIdentifier).join(', ')}`
      : '';
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS ${trigger}
      AFTER ${operation.toUpperCase()}${updateColumns} ON ${table}
      BEGIN
        UPDATE _auth_authority_revision
        SET revision = revision + 1
        WHERE singleton = 1;
      END
    `);
    for (let version = 1; version < triggerVersion; version += 1) {
      db.exec(`DROP TRIGGER IF EXISTS ${quoteIdentifier(
        `trg_zero_authority_${safeName}_${operation}_v${version}`,
      )}`);
    }
  }
}

function sqliteTableExists(db: AuthorityRevisionDatabaseV020, table: string): boolean {
  return Boolean(db.prepare(`SELECT 1 AS present FROM sqlite_master
    WHERE type = 'table' AND name = ? LIMIT 1`).get(table));
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}
