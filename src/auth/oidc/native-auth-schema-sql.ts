/** Shared SQL used by migration 005 and auth runtime compatibility startup. */

export function createNativeAuthTables(): readonly string[] {
  return [AUTH_REQUESTS_SQL, AUTH_CODES_SQL, NATIVE_SESSIONS_SQL, ...INDEX_SQL];
}

export function createNativeAuthTableStatements(): readonly string[] {
  return [AUTH_REQUESTS_SQL, AUTH_CODES_SQL, NATIVE_SESSIONS_SQL];
}

export function createNativeAuthIndexStatements(): readonly string[] {
  return INDEX_SQL;
}

const AUTH_REQUESTS_SQL = `CREATE TABLE IF NOT EXISTS _auth_native_requests (
  request_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, scope TEXT NOT NULL,
  state TEXT NOT NULL, nonce TEXT NOT NULL, code_challenge TEXT NOT NULL,
  prompt TEXT, bound_user_id TEXT, source_hash TEXT, created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, consumed_at INTEGER,
  FOREIGN KEY (bound_user_id) REFERENCES users(user_id) ON DELETE CASCADE
)`;

const AUTH_CODES_SQL = `CREATE TABLE IF NOT EXISTS _auth_native_codes (
  code_id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, request_id TEXT NOT NULL,
  user_id TEXT NOT NULL, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL, nonce TEXT NOT NULL, code_challenge TEXT NOT NULL,
  auth_generation INTEGER NOT NULL, created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, consumed_at INTEGER,
  FOREIGN KEY (request_id) REFERENCES _auth_native_requests(request_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
)`;

const NATIVE_SESSIONS_SQL = `CREATE TABLE IF NOT EXISTS _auth_native_sessions (
  token_id TEXT PRIMARY KEY, family_id TEXT NOT NULL, user_id TEXT NOT NULL,
  client_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, scope TEXT NOT NULL,
  auth_generation INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL, consumed_at INTEGER, revoked_at INTEGER,
  replaced_by TEXT, rotation_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
)`;

const INDEX_SQL = [
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
