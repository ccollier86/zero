/** Data-preserving compatibility repair for pre-release native-auth schemas. */

import { createNativeAuthTableStatements } from './native-auth-schema-sql';

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
  const [requestsSql, codesSql] = createNativeAuthTableStatements();
  db.exec(`
    ALTER TABLE _auth_native_codes RENAME TO _auth_native_codes_v005;
    ALTER TABLE _auth_native_requests RENAME TO _auth_native_requests_v005;
    ${requestsSql};
    INSERT INTO _auth_native_requests
      SELECT request_id, request_hash, client_id, redirect_uri, scope, state, nonce,
        code_challenge, prompt, bound_user_id, ${source}, created_at, expires_at, consumed_at
      FROM _auth_native_requests_v005;
    ${codesSql};
    INSERT INTO _auth_native_codes SELECT * FROM _auth_native_codes_v005;
    DROP TABLE _auth_native_codes_v005;
    DROP TABLE _auth_native_requests_v005;
  `);
  return true;
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

function requestForeignKeyIsCascade(db: NativeSchemaDatabase): boolean {
  return db.prepare('PRAGMA foreign_key_list(_auth_native_requests)').all().some((row) => {
    const foreignKey = row as { from?: string; table?: string; on_delete?: string };
    return foreignKey.from === 'bound_user_id' && foreignKey.table === 'users'
      && foreignKey.on_delete === 'CASCADE';
  });
}
