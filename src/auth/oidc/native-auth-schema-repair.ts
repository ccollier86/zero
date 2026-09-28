/** Data-preserving compatibility repair for pre-release native-auth schemas. */

import { createNativeAuthHardeningRepairTables } from './native-auth-schema-sql';

interface NativeSchemaDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): { all(...values: unknown[]): unknown[] };
}

export function repairNativeAuthSchema(db: NativeSchemaDatabase): boolean {
  ensureSessionRotationCount(db);
  if (requestForeignKeyIsCascade(db) && hasColumn(db, '_auth_native_requests', 'source_hash')) {
    return false;
  }
  const source = hasColumn(db, '_auth_native_requests', 'source_hash') ? 'source_hash' : 'NULL';
  const [requestsSql, codesSql] = createNativeAuthHardeningRepairTables();
  db.exec(`
    ALTER TABLE _auth_native_codes RENAME TO _auth_native_codes_v005;
    ALTER TABLE _auth_native_requests RENAME TO _auth_native_requests_v005;
    ${requestsSql};
    INSERT INTO _auth_native_requests
      (request_id, request_hash, client_id, redirect_uri, scope, state, nonce,
       code_challenge, prompt, bound_user_id, source_hash, created_at, expires_at, consumed_at)
      SELECT request_id, request_hash, client_id, redirect_uri, scope, state, nonce,
        code_challenge, prompt, bound_user_id, ${source}, created_at, expires_at, consumed_at
      FROM _auth_native_requests_v005;
    ${codesSql};
    INSERT INTO _auth_native_codes
      (code_id, code_hash, request_id, user_id, client_id, redirect_uri, scope,
       nonce, code_challenge, auth_generation, created_at, expires_at, consumed_at)
      SELECT code_id, code_hash, request_id, user_id, client_id, redirect_uri, scope,
        nonce, code_challenge, auth_generation, created_at, expires_at, consumed_at
      FROM _auth_native_codes_v005;
    DROP TABLE _auth_native_codes_v005;
    DROP TABLE _auth_native_requests_v005;
  `);
  return true;
}

/** Additive compatibility path shared by runtime startup and migration 010. */
export function ensureNativeTenantAuthorityColumns(db: NativeSchemaDatabase): void {
  for (const table of [
    '_auth_native_requests',
    '_auth_native_codes',
    '_auth_native_sessions',
  ]) {
    ensureColumn(db, table, 'scope_kind', 'TEXT');
    ensureColumn(db, table, 'scope_id', 'TEXT');
    ensureColumn(db, table, 'tenant_id', 'TEXT');
    ensureColumn(db, table, 'membership_id', 'TEXT');
    ensureColumn(db, table, 'tenant_authorization_generation', 'INTEGER');
    ensureColumn(db, table, 'membership_authorization_generation', 'INTEGER');
  }
}

function ensureSessionRotationCount(db: NativeSchemaDatabase): void {
  if (!hasColumn(db, '_auth_native_sessions', 'rotation_count')) {
    db.exec('ALTER TABLE _auth_native_sessions ADD COLUMN rotation_count INTEGER NOT NULL DEFAULT 0');
  }
}

function hasColumn(db: NativeSchemaDatabase, table: string, column: string): boolean {
  return db.prepare(`PRAGMA table_info(${table})`).all()
    .some((row) => (row as { name?: string }).name === column);
}

function ensureColumn(
  db: NativeSchemaDatabase,
  table: string,
  column: string,
  definition: string,
): void {
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function requestForeignKeyIsCascade(db: NativeSchemaDatabase): boolean {
  return db.prepare('PRAGMA foreign_key_list(_auth_native_requests)').all().some((row) => {
    const foreignKey = row as { from?: string; table?: string; on_delete?: string };
    return foreignKey.from === 'bound_user_id' && foreignKey.table === 'users'
      && foreignKey.on_delete === 'CASCADE';
  });
}
