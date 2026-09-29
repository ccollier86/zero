import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { migrations } from './index';
import { Migrator } from './migrator';

const TABLES = [
  '_auth_native_requests',
  '_auth_native_codes',
  '_auth_native_sessions',
] as const;

const AUTHORITY_COLUMNS = [
  'scope_kind',
  'scope_id',
  'tenant_id',
  'membership_id',
  'tenant_authorization_generation',
  'membership_authorization_generation',
] as const;

test('migration 010 freezes native tenant authority without rewriting live grants', () => {
  const migratedDb = new Database(':memory:');
  const migrator = new Migrator({
    database: migratedDb,
    dbPath: ':memory:',
    migrations,
    createBackups: false,
    log: () => {},
  });

  try {
    migrator.run('009');
    for (const table of TABLES) {
      expect(columnNames(migratedDb, table))
        .not.toEqual(expect.arrayContaining([...AUTHORITY_COLUMNS]));
    }
    seedLegacyNativeFamily(migratedDb);

    expect(migrator.run('010')).toEqual(['010']);
    expect(columnNames(migratedDb, '_auth_native_requests')).toEqual([
      'request_id', 'request_hash', 'client_id', 'redirect_uri', 'scope',
      'state', 'nonce', 'code_challenge', 'prompt', 'bound_user_id',
      'source_hash', 'created_at', 'expires_at', 'consumed_at',
      ...AUTHORITY_COLUMNS,
    ]);
    expect(columnNames(migratedDb, '_auth_native_codes')).toEqual([
      'code_id', 'code_hash', 'request_id', 'user_id', 'client_id',
      'redirect_uri', 'scope', 'nonce', 'code_challenge', 'auth_generation',
      'created_at', 'expires_at', 'consumed_at', ...AUTHORITY_COLUMNS,
    ]);
    expect(columnNames(migratedDb, '_auth_native_sessions')).toEqual([
      'token_id', 'family_id', 'user_id', 'client_id', 'token_hash', 'scope',
      'auth_generation', 'expires_at', 'created_at', 'consumed_at', 'revoked_at',
      'replaced_by', 'rotation_count', ...AUTHORITY_COLUMNS,
    ]);
    expect(migratedDb.query(`
      SELECT request_id, bound_user_id, scope_kind, tenant_id
      FROM _auth_native_requests WHERE request_id = 'request'
    `).get()).toEqual({
      request_id: 'request', bound_user_id: 'legacy-user', scope_kind: null, tenant_id: null,
    });
    expect(migratedDb.query(`
      SELECT code_id, user_id, scope_kind, membership_id
      FROM _auth_native_codes WHERE code_id = 'code'
    `).get()).toEqual({
      code_id: 'code', user_id: 'legacy-user', scope_kind: null, membership_id: null,
    });
    expect(migratedDb.query(`
      SELECT token_id, family_id, rotation_count, scope_kind, tenant_id,
        tenant_authorization_generation, membership_authorization_generation
      FROM _auth_native_sessions WHERE token_id = 'token'
    `).get()).toEqual({
      token_id: 'token', family_id: 'family', rotation_count: 0,
      scope_kind: null, tenant_id: null,
      tenant_authorization_generation: null,
      membership_authorization_generation: null,
    });

    // Compatibility startup or an operator retry must remain harmless.
    const frozenShapes = Object.fromEntries(TABLES.map((table) => [
      table,
      tableShape(migratedDb, table),
    ]));
    migrations.find((migration) => migration.version === '010')!.up(migratedDb);
    for (const table of TABLES) {
      expect(tableShape(migratedDb, table)).toEqual(frozenShapes[table]);
    }
  } finally {
    migrator.dispose();
    migratedDb.close();
  }
});

function seedLegacyNativeFamily(db: Database): void {
  db.run(`INSERT INTO users (
    user_id, username, email, role, status, password_change_required,
    email_verification_required, mfa_required, created_at
  ) VALUES (
    'legacy-user', 'legacy-user', 'legacy@example.test', 'user', 'active', 0, 0, 0, 1
  )`);
  db.run(`INSERT INTO _auth_native_requests (
    request_id, request_hash, client_id, redirect_uri, scope, state, nonce,
    code_challenge, prompt, bound_user_id, source_hash, created_at, expires_at, consumed_at
  ) VALUES (
    'request', 'request-hash', 'desktop', 'com.example:/callback', 'openid',
    'state', 'nonce', 'challenge', NULL, 'legacy-user', 'source-hash', 1, 999999, NULL
  )`);
  db.run(`INSERT INTO _auth_native_codes (
    code_id, code_hash, request_id, user_id, client_id, redirect_uri, scope,
    nonce, code_challenge, auth_generation, created_at, expires_at, consumed_at
  ) VALUES (
    'code', 'code-hash', 'request', 'legacy-user', 'desktop',
    'com.example:/callback', 'openid', 'nonce', 'challenge', 0, 1, 999999, NULL
  )`);
  db.run(`INSERT INTO _auth_native_sessions (
    token_id, family_id, user_id, client_id, token_hash, scope, auth_generation,
    expires_at, created_at, consumed_at, revoked_at, replaced_by, rotation_count
  ) VALUES (
    'token', 'family', 'legacy-user', 'desktop', 'token-hash', 'openid', 0,
    999999, 1, NULL, NULL, NULL, 0
  )`);
}

function columnNames(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map((column) => column.name);
}

function tableShape(db: Database, table: string) {
  return {
    columns: db.query(`PRAGMA table_info(${table})`).all(),
    indexes: (db.query(`PRAGMA index_list(${table})`).all() as Array<{
      name: string;
      unique: number;
      partial: number;
    }>)
      .map((index) => ({
        name: index.name,
        unique: index.unique,
        partial: index.partial,
        columns: db.query(`PRAGMA index_info(${index.name})`).all(),
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    foreignKeys: db.query(`PRAGMA foreign_key_list(${table})`).all(),
  };
}
