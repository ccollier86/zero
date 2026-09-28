import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import {
  installAuthAuthorityRevision,
  readAuthAuthorityRevision,
} from './auth-authority-revision';
import { defineAuthTables } from './auth-schema';

describe('durable auth authority revision', () => {
  test('reports an uninstalled clock without swallowing unrelated SQLite failures', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      expect(readAuthAuthorityRevision(db)).toBeNull();
      db.dispose();
      expect(() => readAuthAuthorityRevision(db)).toThrow('disposed');
    } finally {
      db.dispose();
    }
  });

  test('publishes relevant authority mutations across SQLite connections', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-auth-authority-revision-'));
    const path = join(directory, 'app.sqlite');
    let first: ReactiveDB | undefined;
    let second: ReactiveDB | undefined;

    try {
      first = createReactiveDB({ mode: path, busyTimeout: 10_000 });
      defineAuthTables(first);
      installAuthAuthorityRevision(first);

      second = createReactiveDB({ mode: path, busyTimeout: 10_000 });
      defineAuthTables(second);
      installAuthAuthorityRevision(second);

      const baseline = readAuthAuthorityRevision(first)!;
      expect(readAuthAuthorityRevision(second)).toBe(baseline);

      first.insert('users', {
        user_id: 'user-1',
        username: 'authority-user',
        email: 'authority@example.test',
        first_name: 'Before',
        role: 'user',
        status: 'active',
        created_at: Date.now(),
      });
      expect(readAuthAuthorityRevision(second)).toBe(baseline + 1);

      runAndFinalize(
        first,
        'UPDATE users SET first_name = ? WHERE user_id = ?',
        ['After', 'user-1'],
      );
      expect(readAuthAuthorityRevision(second)).toBe(baseline + 1);

      runAndFinalize(
        first,
        'UPDATE users SET role = ? WHERE user_id = ?',
        ['admin', 'user-1'],
      );
      expect(readAuthAuthorityRevision(second)).toBe(baseline + 2);

      runAndFinalize(
        first,
        'UPDATE users SET email_verified_at = ? WHERE user_id = ?',
        [Date.now(), 'user-1'],
      );
      expect(readAuthAuthorityRevision(second)).toBe(baseline + 3);

      const beforeRollback = readAuthAuthorityRevision(first);
      expect(() => first!.transaction(() => {
        runAndFinalize(
          first!,
          'UPDATE users SET status = ? WHERE user_id = ?',
          ['suspended', 'user-1'],
        );
        throw new Error('roll back authority mutation');
      })).toThrow('roll back authority mutation');
      expect(readAuthAuthorityRevision(second)).toBe(beforeRollback);
      expect(first.queryOne('users', 'user-1')?.status).toBe('active');
    } finally {
      second?.dispose();
      first?.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('upgrades the users update trigger without an invalidation gap', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      defineAuthTables(db);
      db.exec(`
        CREATE TABLE _auth_authority_revision (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
        )
      `);
      db.exec(`
        INSERT INTO _auth_authority_revision (singleton, revision) VALUES (1, 0)
      `);
      db.exec(`
        CREATE TRIGGER trg_zero_authority_users_update_v1
        AFTER UPDATE OF role ON users
        BEGIN
          UPDATE _auth_authority_revision
          SET revision = revision + 1
          WHERE singleton = 1;
        END
      `);

      installAuthAuthorityRevision(db);
      const triggers = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'trigger' AND name LIKE 'trg_zero_authority_users_update_v%'
        ORDER BY name
      `);
      try {
        expect(triggers.all()).toEqual([
          { name: 'trg_zero_authority_users_update_v2' },
        ]);
      } finally {
        triggers.finalize();
      }

      db.insert('users', {
        user_id: 'upgrade-user',
        username: 'upgrade-user',
        email: 'upgrade-user@example.test',
        role: 'user',
        status: 'active',
        created_at: Date.now(),
      });
      const baseline = readAuthAuthorityRevision(db)!;
      runAndFinalize(
        db,
        'UPDATE users SET email_verified_at = ? WHERE user_id = ?',
        [Date.now(), 'upgrade-user'],
      );
      expect(readAuthAuthorityRevision(db)).toBe(baseline + 1);
    } finally {
      db.dispose();
    }
  });

  test('treats every durable browser and native session update as authority', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      defineAuthTables(db);
      installAuthAuthorityRevision(db);
      const now = Date.now();
      db.prepare(`
        INSERT INTO users (
          user_id, username, email, role, status, created_at
        ) VALUES ('session-user', 'session-user', 'session@example.test',
          'user', 'active', ?)
      `).run(now);
      db.prepare(`
        INSERT INTO _auth_sessions (
          session_id, user_id, kind, status, generation, scope_kind,
          scope_id, provenance, authenticated_at, created_at, last_seen_at,
          expires_at
        ) VALUES ('web-session', 'session-user', 'web', 'active', 0,
          'application', 'application', 'local', ?, ?, ?, ?)
      `).run(now, now, now, now + 60_000);
      db.prepare(`
        INSERT INTO _auth_native_sessions (
          token_id, family_id, user_id, client_id, token_hash, scope,
          auth_generation, expires_at, created_at
        ) VALUES ('native-session', 'family-a', 'session-user', 'client-a',
          'hash-a', 'openid', 0, ?, ?)
      `).run(now + 60_000, now);

      const baseline = readAuthAuthorityRevision(db)!;
      db.prepare(`
        UPDATE _auth_sessions SET expires_at = ? WHERE session_id = 'web-session'
      `).run(now + 120_000);
      expect(readAuthAuthorityRevision(db)).toBe(baseline + 1);

      db.prepare(`
        UPDATE _auth_native_sessions
        SET family_id = 'family-b', token_hash = 'hash-b', rotation_count = 1
        WHERE token_id = 'native-session'
      `).run();
      expect(readAuthAuthorityRevision(db)).toBe(baseline + 2);
    } finally {
      db.dispose();
    }
  });
});

function runAndFinalize(
  db: ReactiveDB,
  sql: string,
  values: readonly (string | number | null)[],
): void {
  const statement = db.prepare(sql);
  try {
    statement.run(...values);
  } finally {
    statement.finalize();
  }
}
