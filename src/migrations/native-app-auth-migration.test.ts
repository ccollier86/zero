/** Upgrade coverage for additive native OIDC persistence. */

import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { migrations } from './index';
import { Migrator } from './migrator';

describe('migration 005 native app auth', () => {
  test('upgrades an existing auth database without changing users or web sessions', () => {
    const db = new Database(':memory:');
    const migrator = new Migrator({
      database: db,
      dbPath: ':memory:',
      migrations,
      createBackups: false,
      log: () => {},
    });
    try {
      expect(migrator.run('004')).toEqual(['001', '002', '003', '004']);
      const now = Date.now();
      db.query(`INSERT INTO users
        (user_id, username, email, role, status, password_change_required,
         email_verification_required, mfa_required, created_at)
        VALUES (?, ?, ?, 'user', 'active', 0, 0, 0, ?)`)
        .run('u_existing', 'existing', 'existing@example.com', now);
      db.query(`INSERT INTO _refresh_tokens
        (token_id, user_id, token_hash, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?)`)
        .run('web_session', 'u_existing', 'web_hash', now + 10_000, now);

      expect(migrator.run('005')).toEqual(['005']);
      expect(db.query('SELECT email FROM users WHERE user_id = ?').get('u_existing')).toEqual({
        email: 'existing@example.com',
      });
      expect(db.query('SELECT token_id FROM _refresh_tokens').get()).toEqual({
        token_id: 'web_session',
      });
      for (const table of [
        '_auth_native_requests', '_auth_native_codes', '_auth_native_sessions',
      ]) {
        expect(db.query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
        ).get(table)).toEqual({ name: table });
      }
      expect(migrator.run()).toEqual(['006', '007', '030', '032', '033']);
      expect(db.query('SELECT email FROM users WHERE user_id = ?').get('u_existing')).toEqual({
        email: 'existing@example.com',
      });
      expect(db.query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_auth_email_outbox'"
      ).get()).toEqual({ name: '_auth_email_outbox' });
    } finally {
      migrator.dispose();
      db.close();
    }
  });
});
