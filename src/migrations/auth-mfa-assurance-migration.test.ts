import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { migrations } from './index';
import { Migrator } from './migrator';

test('migration 025 adds nullable MFA assurance without trusting existing sessions', () => {
  const database = new Database(':memory:');
  const migrator = new Migrator({
    database,
    dbPath: ':memory:',
    migrations,
    createBackups: false,
    log: () => {},
  });

  try {
    expect(migrator.run('024').at(-1)).toBe('024');
    const now = Date.now();
    database.query(`INSERT INTO users (
      user_id, username, email, role, status, created_at
    ) VALUES ('mfa-migration-user', 'mfa-migration-user',
      'mfa-migration@example.test', 'user', 'active', ?)`)
      .run(now);
    database.query(`INSERT INTO _auth_sessions (
      session_id, user_id, kind, status, generation, scope_kind, scope_id,
      provenance, authenticated_at, created_at, last_seen_at, expires_at
    ) VALUES ('web-family', 'mfa-migration-user', 'web', 'active', 0,
      'application', 'application', 'local', ?, ?, ?, ?)`)
      .run(now, now, now, now + 60_000);
    database.query(`INSERT INTO _auth_session_continuations (
      continuation_id, application_id, user_id, purpose, token_hash,
      auth_generation, expires_at, created_at
    ) VALUES ('continuation', 'application', 'mfa-migration-user',
      'tenant_selection', 'continuation-hash', 0, ?, ?)`)
      .run(now + 60_000, now);
    database.query(`INSERT INTO _auth_native_requests (
      request_id, request_hash, client_id, redirect_uri, scope, state, nonce,
      code_challenge, created_at, expires_at
    ) VALUES ('request', 'request-hash', 'desktop', 'zero.test:/callback',
      'openid', 'state', 'nonce', 'challenge', ?, ?)`)
      .run(now, now + 60_000);
    database.query(`INSERT INTO _auth_native_codes (
      code_id, code_hash, request_id, user_id, client_id, redirect_uri, scope,
      nonce, code_challenge, auth_generation, created_at, expires_at
    ) VALUES ('code', 'code-hash', 'request', 'mfa-migration-user', 'desktop',
      'zero.test:/callback', 'openid', 'nonce', 'challenge', 0, ?, ?)`)
      .run(now, now + 60_000);
    database.query(`INSERT INTO _auth_native_sessions (
      token_id, family_id, user_id, client_id, token_hash, scope,
      auth_generation, expires_at, created_at
    ) VALUES ('native-token', 'native-family', 'mfa-migration-user', 'desktop',
      'native-hash', 'openid', 0, ?, ?)`)
      .run(now + 60_000, now);

    expect(migrator.run('025')).toEqual(['025']);
    for (const [table, idColumn, id] of [
      ['_auth_sessions', 'session_id', 'web-family'],
      ['_auth_session_continuations', 'continuation_id', 'continuation'],
      ['_auth_native_codes', 'code_id', 'code'],
      ['_auth_native_sessions', 'token_id', 'native-token'],
    ] as const) {
      expect(database.query(`SELECT mfa_verified_at FROM ${table}
        WHERE ${idColumn} = ?`).get(id)).toEqual({ mfa_verified_at: null });
    }

    const before = authorityRevision(database);
    database.query(`UPDATE _auth_sessions SET mfa_verified_at = ?
      WHERE session_id = 'web-family'`).run(now);
    database.query(`UPDATE _auth_native_sessions SET mfa_verified_at = ?
      WHERE token_id = 'native-token'`).run(now);
    expect(authorityRevision(database)).toBe(before + 2);
    expect(() => database.query(`UPDATE _auth_native_codes
      SET mfa_verified_at = -1 WHERE code_id = 'code'`).run()).toThrow();
  } finally {
    migrator.dispose();
    database.close();
  }
});

function authorityRevision(database: Database): number {
  return (database.query(`SELECT revision FROM _auth_authority_revision
    WHERE singleton = 1`).get() as { revision: number }).revision;
}
