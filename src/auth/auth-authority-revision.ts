/**
 * Durable authorization revision shared by every runtime using one SQLite DB.
 *
 * Authority tables are intentionally private and bypass ReactiveDB change
 * tracking. These triggers collapse their security-relevant mutations into a
 * single monotonic revision so every runtime can cheaply revalidate active
 * sockets and other long-lived authorization projections.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import { AuthError } from './types';

export const AUTH_AUTHORITY_REVISION_TABLE = '_auth_authority_revision';

const AUTH_AUTHORITY_REVISION_CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS ${AUTH_AUTHORITY_REVISION_TABLE} (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
  )
`;

export type AuthAuthorityRevisionSchemaStatus = 'ready' | 'missing' | 'invalid';

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
    // Every mutable durable-session field is security-adjacent. In
    // particular user_id, kind, and expires_at must not be able to change
    // without crossing the same commit fence as revocation and scope fields.
    updateColumns: [],
    updateTriggerVersion: 2,
  },
  {
    table: '_auth_tenants',
    updateColumns: ['kind', 'status', 'authorization_generation'],
    updateTriggerVersion: 2,
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
    table: '_auth_authorization_manifest',
    updateColumns: ['version', 'registry_version', 'fingerprint', 'manifest_json'],
  },
  {
    table: '_auth_application_authorization_state',
    updateColumns: ['user_id', 'authorization_generation'],
  },
  { table: '_auth_application_role_assignments', updateColumns: [] },
  { table: '_auth_tenant_membership_roles', updateColumns: [] },
  {
    table: '_auth_api_keys',
    // Usage telemetry and presentation fields do not change admission.
    // Secret, scope, generation, expiry, and revocation changes do.
    updateColumns: [
      'user_id',
      'secret_hash',
      'scope_kind',
      'scope_id',
      'tenant_id',
      'membership_id',
      'issued_auth_generation',
      'key_generation',
      'expires_at',
      'revoked_at',
    ],
  },
  {
    table: '_auth_native_sessions',
    // Refresh-family identity, token replacement, and rotation fields are as
    // authoritative as explicit revocation/scope columns. Keep this table
    // fail-closed as its schema evolves by observing every UPDATE.
    updateColumns: [],
    updateTriggerVersion: 2,
  },
] as const;

/** Install the shared revision clock and versioned authority triggers. */
export function installAuthAuthorityRevision(db: Pick<ReactiveDB, 'exec' | 'prepare'>): void {
  // CREATE IF NOT EXISTS cannot repair an incompatible same-name clock. Check
  // first so malformed columns never escape as a raw SQLite INSERT error.
  if (inspectAuthAuthorityRevisionSchema(db) === 'invalid') {
    throw authAuthorityRevisionInvariantError();
  }
  db.exec(AUTH_AUTHORITY_REVISION_CREATE_SQL);
  db.exec(`
    INSERT OR IGNORE INTO ${AUTH_AUTHORITY_REVISION_TABLE} (singleton, revision)
    VALUES (1, 0)
  `);

  for (const target of AUTHORITY_TABLES) {
    if (!sqliteTableExists(db, target.table)) continue;
    installTableTriggers(db, target);
  }
  assertExactAuthAuthorityRevisionSchema(db);
}

/**
 * Inspect the revision clock and every current versioned trigger contract.
 * Missing objects are recoverable before installation; same-name objects with
 * a different table/event/body are incompatible and must fail closed.
 */
export function inspectAuthAuthorityRevisionSchema(
  db: Pick<ReactiveDB, 'prepare'>,
): AuthAuthorityRevisionSchemaStatus {
  const clock = readSchemaDefinition(db, AUTH_AUTHORITY_REVISION_TABLE);
  if (!clock) return 'missing';
  if (clock.type !== 'table'
    || typeof clock.sql !== 'string'
    || normalizeSqlShape(clock.sql)
      !== normalizeSqlShape(AUTH_AUTHORITY_REVISION_CREATE_SQL)) return 'invalid';

  let missing = false;
  for (const target of AUTHORITY_TABLES) {
    if (!sqliteTableExists(db, target.table)) continue;
    for (const operation of ['insert', 'delete', 'update'] as const) {
      const expected = authorityTriggerContract(target, operation);
      const actual = readSchemaDefinition(db, expected.name);
      if (!actual) {
        missing = true;
        continue;
      }
      if (actual.type !== 'trigger'
        || actual.table !== target.table
        || typeof actual.sql !== 'string'
        || normalizeSqlShape(actual.sql) !== normalizeSqlShape(expected.sql)) {
        return 'invalid';
      }
    }
  }
  return missing ? 'missing' : 'ready';
}

/** Fail startup with Guardian's stable invariant error on schema drift. */
export function assertExactAuthAuthorityRevisionSchema(
  db: Pick<ReactiveDB, 'prepare'>,
): void {
  if (inspectAuthAuthorityRevisionSchema(db) === 'ready') return;
  throw authAuthorityRevisionInvariantError();
}

function authAuthorityRevisionInvariantError(): AuthError {
  return new AuthError(
    'Auth authority revision schema is incompatible',
    'AUTH_STATE_INVARIANT_FAILED',
    500,
  );
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
  for (const operation of ['insert', 'delete', 'update'] as const) {
    // Version trigger names when their definition changes. CREATE IF NOT
    // EXISTS avoids a DROP/CREATE window where another live connection could
    // commit an authority mutation without advancing the shared revision.
    const contract = authorityTriggerContract(target, operation);
    db.exec(contract.sql);

    // Create the replacement first, then remove obsolete versions. A crash in
    // between can cause a harmless extra revision bump but never a missed
    // authority invalidation.
    for (let version = 1; version < contract.version; version += 1) {
      db.exec(`
        DROP TRIGGER IF EXISTS ${quoteIdentifier(
          `trg_zero_authority_${safeAuthorityName(target.table)}_${operation}_v${version}`,
        )}
      `);
    }
  }
}

function authorityTriggerContract(
  target: AuthorityTableTarget,
  operation: 'insert' | 'delete' | 'update',
): { readonly name: string; readonly sql: string; readonly version: number } {
  const version = operation === 'update'
    ? target.updateTriggerVersion ?? 1
    : 1;
  const name = `trg_zero_authority_${safeAuthorityName(target.table)}_${operation}_v${version}`;
  const updateColumns = operation === 'update' && target.updateColumns.length > 0
    ? ` OF ${target.updateColumns.map(quoteIdentifier).join(', ')}`
    : '';
  return Object.freeze({
    name,
    version,
    sql: `
      CREATE TRIGGER IF NOT EXISTS ${quoteIdentifier(name)}
      AFTER ${operation.toUpperCase()}${updateColumns} ON ${quoteIdentifier(target.table)}
      BEGIN
        UPDATE ${AUTH_AUTHORITY_REVISION_TABLE}
        SET revision = revision + 1
        WHERE singleton = 1;
      END
    `,
  });
}

function readSchemaDefinition(
  db: Pick<ReactiveDB, 'prepare'>,
  name: string,
): { readonly type: unknown; readonly table: unknown; readonly sql: unknown } | null {
  const statement = db.prepare(`
    SELECT type, tbl_name AS "table", sql
    FROM sqlite_master
    WHERE name = ?
    LIMIT 1
  `);
  try {
    return statement.get(name) as {
      readonly type: unknown;
      readonly table: unknown;
      readonly sql: unknown;
    } | null;
  } finally {
    statement.finalize();
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

function safeAuthorityName(table: string): string {
  return table.replace(/[^A-Za-z0-9_]/g, '_');
}

function normalizeSqlShape(sql: string): string {
  return sql.trim()
    .replace(/\bif\s+not\s+exists\b/giu, '')
    .replace(/\s+/gu, ' ')
    .replace(/\s*,\s*/gu, ', ')
    .trim()
    .toLowerCase();
}
