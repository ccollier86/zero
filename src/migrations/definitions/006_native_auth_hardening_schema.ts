/** Immutable native-auth repair contract owned by migration 006. */

interface NativeSchemaDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): { all(...values: unknown[]): unknown[] };
}

const HARDENED_AUTH_REQUESTS_SQL = `CREATE TABLE IF NOT EXISTS _auth_native_requests (
  request_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, scope TEXT NOT NULL,
  state TEXT NOT NULL, nonce TEXT NOT NULL, code_challenge TEXT NOT NULL,
  prompt TEXT, bound_user_id TEXT, source_hash TEXT, created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, consumed_at INTEGER,
  FOREIGN KEY (bound_user_id) REFERENCES users(user_id) ON DELETE CASCADE
)`;

const HARDENED_AUTH_CODES_SQL = `CREATE TABLE IF NOT EXISTS _auth_native_codes (
  code_id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, request_id TEXT NOT NULL,
  user_id TEXT NOT NULL, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL, nonce TEXT NOT NULL, code_challenge TEXT NOT NULL,
  auth_generation INTEGER NOT NULL, created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, consumed_at INTEGER,
  FOREIGN KEY (request_id) REFERENCES _auth_native_requests(request_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
)`;

const HARDENED_INDEX_SQL = [
  'CREATE INDEX IF NOT EXISTS idx_auth_native_request_hash ON _auth_native_requests(request_hash)',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_request_expiry ON _auth_native_requests(expires_at)',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_request_active ON _auth_native_requests(expires_at) WHERE consumed_at IS NULL',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_request_client_active ON _auth_native_requests(client_id, expires_at) WHERE consumed_at IS NULL',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_request_created ON _auth_native_requests(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_request_client_created ON _auth_native_requests(client_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_request_source_active ON _auth_native_requests(source_hash, expires_at) WHERE source_hash IS NOT NULL AND consumed_at IS NULL',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_request_source_created ON _auth_native_requests(source_hash, created_at) WHERE source_hash IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_request_bound_user ON _auth_native_requests(bound_user_id) WHERE bound_user_id IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_code_hash ON _auth_native_codes(code_hash)',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_code_request ON _auth_native_codes(request_id)',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_code_user ON _auth_native_codes(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_code_expiry ON _auth_native_codes(expires_at)',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_code_active ON _auth_native_codes(expires_at) WHERE consumed_at IS NULL',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_session_hash ON _auth_native_sessions(token_hash)',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_session_family ON _auth_native_sessions(family_id)',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_session_user ON _auth_native_sessions(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_session_expiry ON _auth_native_sessions(expires_at)',
  'CREATE INDEX IF NOT EXISTS idx_auth_native_session_active ON _auth_native_sessions(client_id, expires_at) WHERE consumed_at IS NULL AND revoked_at IS NULL',
] as const;

export const LEGACY_REGISTRATION_INTENT_TABLE_SQL_V006 = `CREATE TABLE IF NOT EXISTS _auth_registration_intents (
  user_id TEXT PRIMARY KEY,
  mfa_enrollment_requested INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
)`;

export function repairNativeAuthSchemaV006(db: NativeSchemaDatabase): boolean {
  ensureSessionRotationCount(db);
  if (requestForeignKeyIsCascade(db) && hasColumn(db, '_auth_native_requests', 'source_hash')) {
    return false;
  }
  const source = hasColumn(db, '_auth_native_requests', 'source_hash') ? 'source_hash' : 'NULL';
  db.exec(`
    ALTER TABLE _auth_native_codes RENAME TO _auth_native_codes_v005;
    ALTER TABLE _auth_native_requests RENAME TO _auth_native_requests_v005;
    ${HARDENED_AUTH_REQUESTS_SQL};
    INSERT INTO _auth_native_requests
      SELECT request_id, request_hash, client_id, redirect_uri, scope, state, nonce,
        code_challenge, prompt, bound_user_id, ${source}, created_at, expires_at, consumed_at
      FROM _auth_native_requests_v005;
    ${HARDENED_AUTH_CODES_SQL};
    INSERT INTO _auth_native_codes SELECT * FROM _auth_native_codes_v005;
    DROP TABLE _auth_native_codes_v005;
    DROP TABLE _auth_native_requests_v005;
  `);
  return true;
}

export function createNativeAuthHardeningIndexStatementsV006(): readonly string[] {
  return HARDENED_INDEX_SQL;
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
