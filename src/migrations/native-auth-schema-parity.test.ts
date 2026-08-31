import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { createNativeAuthTables } from '../auth/oidc/native-auth-schema-sql';
import { migrations } from './index';
import { Migrator } from './migrator';

const TABLES = [
  '_auth_native_requests', '_auth_native_codes', '_auth_native_sessions',
] as const;

test('migrations through 006 and runtime native-auth schemas have exact parity', () => {
  const migrated = prepare('006');
  const runtime = prepare('004');
  try {
    for (const statement of createNativeAuthTables()) runtime.db.run(statement);
    expect(shape(migrated.db)).toEqual(shape(runtime.db));
    expect(columns(migrated.db)).toEqual({
      _auth_native_requests: [
        'request_id', 'request_hash', 'client_id', 'redirect_uri', 'scope', 'state',
        'nonce', 'code_challenge', 'prompt', 'bound_user_id', 'source_hash', 'created_at',
        'expires_at', 'consumed_at',
      ],
      _auth_native_codes: [
        'code_id', 'code_hash', 'request_id', 'user_id', 'client_id', 'redirect_uri',
        'scope', 'nonce', 'code_challenge', 'auth_generation', 'created_at',
        'expires_at', 'consumed_at',
      ],
      _auth_native_sessions: [
        'token_id', 'family_id', 'user_id', 'client_id', 'token_hash', 'scope',
        'auth_generation', 'expires_at', 'created_at', 'consumed_at', 'revoked_at',
        'replaced_by', 'rotation_count',
      ],
    });
    expect(customIndexes(migrated.db)).toEqual([
      'idx_auth_native_code_active', 'idx_auth_native_code_expiry',
      'idx_auth_native_code_hash', 'idx_auth_native_code_request',
      'idx_auth_native_code_user', 'idx_auth_native_request_active',
      'idx_auth_native_request_bound_user', 'idx_auth_native_request_client_active',
      'idx_auth_native_request_client_created',
      'idx_auth_native_request_created', 'idx_auth_native_request_expiry',
      'idx_auth_native_request_hash', 'idx_auth_native_request_source_active',
      'idx_auth_native_request_source_created', 'idx_auth_native_session_active',
      'idx_auth_native_session_expiry', 'idx_auth_native_session_family',
      'idx_auth_native_session_hash', 'idx_auth_native_session_user',
    ]);
    expect(foreignKeys(migrated.db)).toEqual({
      _auth_native_requests: ['bound_user_id->users.user_id:CASCADE'],
      _auth_native_codes: [
        'request_id->_auth_native_requests.request_id:CASCADE',
        'user_id->users.user_id:CASCADE',
      ],
      _auth_native_sessions: ['user_id->users.user_id:CASCADE'],
    });
  } finally {
    migrated.migrator.dispose(); runtime.migrator.dispose();
    migrated.db.close(); runtime.db.close();
  }
});

function prepare(version: '004' | '006') {
  const db = new Database(':memory:');
  const migrator = new Migrator({
    database: db, dbPath: ':memory:', migrations, createBackups: false, log: () => {},
  });
  migrator.run(version);
  return { db, migrator };
}

function shape(db: Database) {
  return Object.fromEntries(TABLES.map((table) => [table, {
    columns: db.query(`PRAGMA table_info(${table})`).all(),
    indexes: db.query(`PRAGMA index_list(${table})`).all(),
    foreignKeys: db.query(`PRAGMA foreign_key_list(${table})`).all(),
  }]));
}

function columns(db: Database) {
  return Object.fromEntries(TABLES.map((table) => [table,
    (db.query(`PRAGMA table_info(${table})`).all() as any[]).map((row) => row.name),
  ]));
}

function customIndexes(db: Database): string[] {
  const placeholders = TABLES.map(() => '?').join(',');
  return (db.query(`SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL
    AND tbl_name IN (${placeholders}) ORDER BY name`).all(...TABLES) as any[])
    .map((row) => row.name);
}

function foreignKeys(db: Database) {
  return Object.fromEntries(TABLES.map((table) => [table,
    (db.query(`PRAGMA foreign_key_list(${table})`).all() as any[])
      .map((row) => `${row.from}->${row.table}.${row.to}:${row.on_delete}`).sort(),
  ]));
}
