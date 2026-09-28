/**
 * Durable authorization revision shared by every runtime using one SQLite DB.
 *
 * Authority tables are intentionally private and bypass ReactiveDB change
 * tracking. These triggers collapse their security-relevant mutations into a
 * single monotonic revision so every runtime can cheaply revalidate active
 * sockets and other long-lived authorization projections.
 */

import type { ReactiveDB } from '../sync/reactive-db';

export const AUTH_AUTHORITY_REVISION_TABLE = '_auth_authority_revision';

interface AuthorityTableTarget {
  table: string;
  /** Empty means every UPDATE can affect authority. */
  updateColumns: readonly string[];
  /** Increment only when an UPDATE trigger definition changes. */
  updateTriggerVersion?: number;
}

const AUTHORITY_TABLES: readonly AuthorityTableTarget[] = [
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
] as const;

/** Install the shared revision clock and versioned authority triggers. */
export function installAuthAuthorityRevision(db: Pick<ReactiveDB, 'exec' | 'prepare'>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${AUTH_AUTHORITY_REVISION_TABLE} (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
    )
  `);
  db.exec(`
    INSERT OR IGNORE INTO ${AUTH_AUTHORITY_REVISION_TABLE} (singleton, revision)
    VALUES (1, 0)
  `);

  for (const target of AUTHORITY_TABLES) {
    if (!sqliteTableExists(db, target.table)) continue;
    installTableTriggers(db, target);
  }
}

/** Read the monotonic authority revision; null means the schema is not installed. */
export function readAuthAuthorityRevision(
  db: Pick<ReactiveDB, 'prepare'>,
): number | null {
  let statement: ReturnType<typeof db.prepare> | null = null;
  try {
    statement = db.prepare(
      `SELECT revision FROM ${AUTH_AUTHORITY_REVISION_TABLE} WHERE singleton = 1`,
    );
    const row = statement.get() as { revision: number } | null;
    return row?.revision ?? null;
  } catch (error) {
    // Older/incompletely migrated injected databases can legitimately lack
    // the clock. Do not hide any other SQLite failure from the caller.
    if (String(error).includes(`no such table: ${AUTH_AUTHORITY_REVISION_TABLE}`)) {
      return null;
    }
    throw error;
  } finally {
    statement?.finalize();
  }
}

function installTableTriggers(
  db: Pick<ReactiveDB, 'exec'>,
  target: AuthorityTableTarget,
): void {
  const table = quoteIdentifier(target.table);
  const safeName = target.table.replace(/[^A-Za-z0-9_]/g, '_');
  for (const operation of ['insert', 'delete', 'update'] as const) {
    // Version trigger names when their definition changes. CREATE IF NOT
    // EXISTS avoids a DROP/CREATE window where another live connection could
    // commit an authority mutation without advancing the shared revision.
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
        UPDATE ${AUTH_AUTHORITY_REVISION_TABLE}
        SET revision = revision + 1
        WHERE singleton = 1;
      END
    `);

    // Create the replacement first, then remove obsolete versions. A crash in
    // between can cause a harmless extra revision bump but never a missed
    // authority invalidation.
    for (let version = 1; version < triggerVersion; version += 1) {
      db.exec(`
        DROP TRIGGER IF EXISTS ${quoteIdentifier(
          `trg_zero_authority_${safeName}_${operation}_v${version}`,
        )}
      `);
    }
  }
}

function sqliteTableExists(
  db: Pick<ReactiveDB, 'prepare'>,
  table: string,
): boolean {
  const statement = db.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
  );
  try {
    return Boolean(statement.get(table));
  } finally {
    statement.finalize();
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}
