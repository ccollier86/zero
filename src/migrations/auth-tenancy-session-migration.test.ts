import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { migrations } from './index';
import { Migrator } from './migrator';

const TARGET_TABLES = [
  '_auth_tenants',
  '_auth_tenant_memberships',
  '_auth_sessions',
  '_auth_session_continuations',
] as const;

test('migration 009 freezes its historical tenancy/session schema and preserves legacy proofs', () => {
  const migratedDb = new Database(':memory:');
  const migrator = new Migrator({
    database: migratedDb,
    dbPath: ':memory:',
    migrations,
    createBackups: false,
    log: () => {},
  });

  try {
    migrator.run('008');
    seedLegacyAuthState(migratedDb);
    expect(migrator.run('009')).toEqual(['009']);

    expect(columnNames(migratedDb, '_auth_tenants')).toEqual([
      'tenant_id', 'slug', 'name', 'status', 'authorization_generation',
      'created_by', 'created_at', 'updated_at', 'suspended_at',
    ]);
    expect(columnNames(migratedDb, '_auth_tenant_memberships')).toEqual([
      'membership_id', 'tenant_id', 'user_id', 'status', 'role_key',
      'authorization_generation', 'joined_at', 'created_at', 'updated_at',
      'suspended_at', 'removed_at', 'created_by',
    ]);
    expect(columnNames(migratedDb, '_auth_sessions')).toEqual([
      'session_id', 'user_id', 'kind', 'status', 'generation', 'scope_kind',
      'scope_id', 'tenant_id', 'membership_id',
      'tenant_authorization_generation', 'membership_authorization_generation',
      'provenance', 'authenticated_at', 'created_at', 'last_seen_at',
      'expires_at', 'revoked_at', 'revocation_reason',
    ]);
    expect(columnNames(migratedDb, '_auth_session_continuations')).toEqual([
      'continuation_id', 'application_id', 'user_id', 'purpose', 'token_hash',
      'auth_generation', 'expires_at', 'consumed_at', 'created_at',
    ]);
    expect(migratedDb.query(`SELECT sql FROM sqlite_master
      WHERE type = 'table' AND name = '_auth_session_continuations'`).get())
      .toEqual(expect.objectContaining({
        sql: expect.stringContaining("'tenant_onboarding'"),
      }));
    expect(migratedDb.query(`SELECT name FROM sqlite_master
      WHERE type = 'trigger' AND name LIKE 'trg_auth_administration_%'`).all())
      .toEqual([]);
    expect(columnNames(migratedDb, '_refresh_tokens')).toContain('session_id');
    expect(migratedDb.query(`
      SELECT token_id, session_id FROM _refresh_tokens WHERE token_id = 'legacy-refresh'
    `).get()).toEqual({ token_id: 'legacy-refresh', session_id: null });
    expect(migratedDb.query(`
      SELECT continuation_id, application_id, user_id, purpose, token_hash,
        auth_generation, expires_at, consumed_at, created_at
      FROM _auth_session_continuations WHERE continuation_id = 'legacy-continuation'
    `).get()).toEqual({
      continuation_id: 'legacy-continuation',
      application_id: 'legacy-app',
      user_id: 'legacy-user',
      purpose: 'tenant_selection',
      token_hash: 'legacy-proof-hash',
      auth_generation: 0,
      expires_at: 9_999_999_999_999,
      consumed_at: null,
      created_at: 1,
    });

    // Compatibility startup and a manually retried migration remain idempotent.
    const frozenShapes = Object.fromEntries(TARGET_TABLES.map((table) => [
      table,
      tableShape(migratedDb, table),
    ]));
    migrations.find((migration) => migration.version === '009')!.up(migratedDb);
    for (const table of TARGET_TABLES) {
      expect(tableShape(migratedDb, table)).toEqual(frozenShapes[table]);
    }
  } finally {
    migrator.dispose();
    migratedDb.close();
  }
});

function seedLegacyAuthState(db: Database): void {
  db.run(`
    INSERT INTO users (
      user_id, username, email, role, status, password_change_required,
      email_verification_required, mfa_required, created_at
    ) VALUES (
      'legacy-user', 'legacy-user', 'legacy@example.test', 'user', 'active', 0, 0, 0, 1
    )
  `);
  db.run(`
    INSERT INTO _refresh_tokens (
      token_id, user_id, token_hash, expires_at, created_at, revoked_at
    ) VALUES (
      'legacy-refresh', 'legacy-user', 'legacy-refresh-hash', 9999999999999, 1, NULL
    )
  `);
  db.run(`
    CREATE TABLE _auth_session_continuations (
      continuation_id TEXT PRIMARY KEY,
      application_id  TEXT NOT NULL,
      user_id         TEXT NOT NULL,
      purpose         TEXT NOT NULL CHECK (purpose = 'tenant_selection'),
      token_hash      TEXT NOT NULL UNIQUE,
      auth_generation INTEGER NOT NULL CHECK (auth_generation >= 0),
      expires_at      INTEGER NOT NULL,
      consumed_at     INTEGER,
      created_at      INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);
  db.run(`
    INSERT INTO _auth_session_continuations (
      continuation_id, application_id, user_id, purpose, token_hash,
      auth_generation, expires_at, consumed_at, created_at
    ) VALUES (
      'legacy-continuation', 'legacy-app', 'legacy-user', 'tenant_selection',
      'legacy-proof-hash', 0, 9999999999999, NULL, 1
    )
  `);
}

function tableShape(db: Database, table: string) {
  return {
    columns: db.query(`PRAGMA table_info(${table})`).all(),
    indexes: (db.query(`PRAGMA index_list(${table})`).all() as Array<{
      name: string;
      unique: number;
      partial: number;
    }>).map((index) => ({
      name: index.name,
      unique: index.unique,
      partial: index.partial,
      columns: db.query(`PRAGMA index_info(${index.name})`).all(),
    })).sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function columnNames(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map((column) => column.name);
}
