import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { migration as hardening } from './definitions/006_native_auth_hardening';
import { migrations } from './index';
import { Migrator, type Migration } from './migrator';

test('migration 006 repairs the draft SET NULL schema without losing live grants', () => {
  const db = new Database(':memory:');
  const old005: Migration = {
    version: '005', description: 'draft native auth', safety: 'safe',
    up(database) { database.exec(OLD_NATIVE_SCHEMA); },
  };
  const migrator = new Migrator({
    database: db, dbPath: ':memory:', createBackups: false, log: () => {},
    applyPragmas: true,
    migrations: [...migrations.filter((item) => item.version <= '004'), old005, hardening],
  });
  try {
    migrator.run('005');
    db.run(`INSERT INTO users
      (user_id, username, email, role, status, password_change_required,
       email_verification_required, mfa_required, created_at)
      VALUES ('user', 'user', 'user@example.test', 'user', 'active', 0, 0, 0, 1)`);
    db.run(`INSERT INTO _auth_native_requests VALUES
      ('request', 'request-hash', 'desktop', 'com.example:/callback', 'openid',
       'state', 'nonce', 'challenge', NULL, 'user', 1, 1000, NULL)`);
    db.run(`INSERT INTO _auth_native_codes VALUES
      ('code', 'code-hash', 'request', 'user', 'desktop', 'com.example:/callback',
       'openid', 'nonce', 'challenge', 0, 1, 1000, NULL)`);
    db.run(`INSERT INTO _auth_native_sessions VALUES
      ('token', 'family', 'user', 'desktop', 'token-hash', 'openid', 0,
       1000, 1, NULL, NULL, NULL)`);

    expect(migrator.run()).toEqual(['006']);
    expect(columnNames(db, '_auth_native_requests')).toContain('source_hash');
    expect(columnNames(db, '_auth_native_sessions')).toContain('rotation_count');
    expect(db.query('SELECT source_hash FROM _auth_native_requests').get())
      .toEqual({ source_hash: null });
    expect(db.query('SELECT rotation_count FROM _auth_native_sessions').get())
      .toEqual({ rotation_count: 0 });
    expect(requestDeleteAction(db)).toBe('CASCADE');
    expect(db.query('SELECT code_id FROM _auth_native_codes').get()).toEqual({ code_id: 'code' });

    db.run("DELETE FROM users WHERE user_id = 'user'");
    for (const table of [
      '_auth_native_requests', '_auth_native_codes', '_auth_native_sessions',
    ]) {
      expect((db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as any).count).toBe(0);
    }
  } finally {
    migrator.dispose();
    db.close();
  }
});

function columnNames(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as any[]).map((row) => row.name);
}

function requestDeleteAction(db: Database): string | undefined {
  return (db.query('PRAGMA foreign_key_list(_auth_native_requests)').all() as any[])
    .find((row) => row.from === 'bound_user_id')?.on_delete;
}

const OLD_NATIVE_SCHEMA = `
  CREATE TABLE _auth_native_requests (
    request_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, scope TEXT NOT NULL,
    state TEXT NOT NULL, nonce TEXT NOT NULL, code_challenge TEXT NOT NULL,
    prompt TEXT, bound_user_id TEXT, created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL, consumed_at INTEGER,
    FOREIGN KEY (bound_user_id) REFERENCES users(user_id) ON DELETE SET NULL
  );
  CREATE TABLE _auth_native_codes (
    code_id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, request_id TEXT NOT NULL,
    user_id TEXT NOT NULL, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL,
    scope TEXT NOT NULL, nonce TEXT NOT NULL, code_challenge TEXT NOT NULL,
    auth_generation INTEGER NOT NULL, created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL, consumed_at INTEGER,
    FOREIGN KEY (request_id) REFERENCES _auth_native_requests(request_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
  );
  CREATE TABLE _auth_native_sessions (
    token_id TEXT PRIMARY KEY, family_id TEXT NOT NULL, user_id TEXT NOT NULL,
    client_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, scope TEXT NOT NULL,
    auth_generation INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL, consumed_at INTEGER, revoked_at INTEGER, replaced_by TEXT,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
  );
`;
