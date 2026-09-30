import { describe, expect, test } from 'bun:test';

import {
  AUTH_AUTHORITY_REVISION_TABLE,
  installAuthAuthorityRevision,
  readAuthAuthorityRevision,
} from '../auth/auth-authority-revision';
import { defineAuthTables } from '../auth/auth-schema';
import { AuthApiKeyStore } from '../auth/auth-api-key-store';
import { AuthSessionStore } from '../auth/auth-session-store';
import { createReactiveDB } from '../sync/reactive-db';
import { AuthorityCommitCoordinator } from './authority-commit-coordinator';
import { registerDatabaseAuthorityCommitGuard } from './database-authority-commit-guard';
import { DatabaseError } from './database-error';

describe('database authority commit guard', () => {
  test('rolls back an authority mutation while a tenant commit owns shared authority', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const coordinator = new AuthorityCommitCoordinator();
    try {
      db.exec(`
        CREATE TABLE users (
          user_id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          role TEXT NOT NULL,
          status TEXT NOT NULL,
          password_change_required INTEGER NOT NULL,
          email_verification_required INTEGER NOT NULL,
          email_verified_at INTEGER,
          mfa_required INTEGER NOT NULL,
          email_generation INTEGER NOT NULL
        )
      `);
      installAuthAuthorityRevision(db);
      db.prepare(`
        INSERT INTO users (
          user_id, email, role, status, password_change_required,
          email_verification_required, email_verified_at, mfa_required,
          email_generation
        ) VALUES (?, ?, ?, ?, 0, 0, NULL, 0, 0)
      `).run('user-a', 'a@example.test', 'user', 'active');
      const baseline = readAuthAuthorityRevision(db)!;
      const remove = registerDatabaseAuthorityCommitGuard(db, coordinator);
      const tenantCommit = await coordinator.acquireShared();

      let error: unknown;
      try {
        db.transaction(() => {
          db.prepare('UPDATE users SET role = ? WHERE user_id = ?')
            .run('admin', 'user-a');
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(DatabaseError);
      expect(error).toMatchObject({
        code: 'DATABASE_CONFLICT',
        retryable: true,
        outcome: 'not-committed',
      });
      expect(db.prepare('SELECT role FROM users WHERE user_id = ?')
        .get('user-a')).toEqual({ role: 'user' });
      expect(readAuthAuthorityRevision(db)).toBe(baseline);

      tenantCommit.release();
      db.transaction(() => {
        db.prepare('UPDATE users SET role = ? WHERE user_id = ?')
          .run('admin', 'user-a');
      });
      expect(db.prepare('SELECT role FROM users WHERE user_id = ?')
        .get('user-a')).toEqual({ role: 'admin' });
      expect(readAuthAuthorityRevision(db)).toBe(baseline + 1);
      expect(coordinator.diagnostics()).toMatchObject({
        activeShared: 0,
        activeExclusive: false,
      });
      remove();
    } finally {
      await coordinator.close();
      db.dispose();
    }
  });

  test('does not serialize a transaction which leaves authority revision unchanged', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const coordinator = new AuthorityCommitCoordinator();
    try {
      db.exec('CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
      installAuthAuthorityRevision(db);
      const remove = registerDatabaseAuthorityCommitGuard(db, coordinator);
      const tenantCommit = await coordinator.acquireShared();

      db.transaction(() => {
        db.prepare('INSERT INTO notes (id, body) VALUES (?, ?)')
          .run('note-a', 'allowed');
      });
      expect(db.prepare('SELECT body FROM notes WHERE id = ?').get('note-a'))
        .toEqual({ body: 'allowed' });

      tenantCommit.release();
      remove();
    } finally {
      await coordinator.close();
      db.dispose();
    }
  });

  test('fences direct public auth-session store mutations without relying on a service caller', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const coordinator = new AuthorityCommitCoordinator();
    try {
      defineAuthTables(db);
      installAuthAuthorityRevision(db);
      const now = Date.now();
      db.insert('users', {
        user_id: 'session-user',
        username: 'session-user',
        email: 'session@example.test',
        role: 'user',
        status: 'active',
        created_at: now,
      });
      const store = new AuthSessionStore(db);
      const remove = registerDatabaseAuthorityCommitGuard(db, coordinator);
      const tenantCommit = await coordinator.acquireShared();
      const record = {
        sessionId: 'session-a',
        userId: 'session-user',
        kind: 'web' as const,
        status: 'active' as const,
        generation: 0,
        scopeKind: 'application' as const,
        scopeId: 'application',
        tenantId: null,
        membershipId: null,
        tenantAuthorizationGeneration: null,
        membershipAuthorizationGeneration: null,
        provenance: 'local' as const,
        authenticatedAt: now,
        mfaVerifiedAt: null,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: now + 60_000,
        revokedAt: null,
        revocationReason: null,
      };

      expect(() => store.insert(record)).toThrow(expect.objectContaining({
        code: 'DATABASE_CONFLICT',
        outcome: 'not-committed',
      }));
      expect(store.getById(record.sessionId)).toBeNull();

      tenantCommit.release();
      store.insert(record);
      expect(store.getById(record.sessionId)).toMatchObject({
        sessionId: record.sessionId,
        userId: record.userId,
      });
      remove();
    } finally {
      await coordinator.close();
      db.dispose();
    }
  });

  test('fails closed when the authority revision singleton is unavailable', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const coordinator = new AuthorityCommitCoordinator();
    try {
      db.exec(`
        CREATE TABLE users (
          user_id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          role TEXT NOT NULL,
          status TEXT NOT NULL,
          password_change_required INTEGER NOT NULL,
          email_verification_required INTEGER NOT NULL,
          email_verified_at INTEGER,
          mfa_required INTEGER NOT NULL,
          email_generation INTEGER NOT NULL
        )
      `);
      installAuthAuthorityRevision(db);
      db.prepare(`
        INSERT INTO users (
          user_id, email, role, status, password_change_required,
          email_verification_required, email_verified_at, mfa_required,
          email_generation
        ) VALUES (?, ?, ?, ?, 0, 0, NULL, 0, 0)
      `).run('user-missing-clock', 'clock@example.test', 'user', 'active');
      registerDatabaseAuthorityCommitGuard(db, coordinator);
      db.prepare(`DELETE FROM ${AUTH_AUTHORITY_REVISION_TABLE}`).run();
      const tenantCommit = await coordinator.acquireShared();
      try {
        expect(() => db.transaction(() => {
          db.prepare('UPDATE users SET role = ? WHERE user_id = ?')
            .run('admin', 'user-missing-clock');
        })).toThrow(expect.objectContaining({
          code: 'DATABASE_SCHEMA_MISMATCH',
          retryable: false,
          outcome: 'not-started',
        }));
      } finally {
        tenantCommit.release();
      }
      expect(db.prepare('SELECT role FROM users WHERE user_id = ?')
        .get('user-missing-clock')).toEqual({ role: 'user' });
    } finally {
      await coordinator.close();
      db.dispose();
    }
  });

  test('fences direct public API-key store insert and revoke mutations', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const coordinator = new AuthorityCommitCoordinator();
    try {
      defineAuthTables(db);
      installAuthAuthorityRevision(db);
      const now = Date.now();
      db.insert('users', {
        user_id: 'api-key-user',
        username: 'api-key-user',
        email: 'api-key-user@example.test',
        role: 'admin',
        status: 'active',
        created_at: now,
      });
      const store = new AuthApiKeyStore(db);
      registerDatabaseAuthorityCommitGuard(db, coordinator);
      const input = {
        keyId: 'zak_direct_store_key',
        userId: 'api-key-user',
        label: 'Direct store key',
        secretHash: 'a'.repeat(64),
        secretHint: 'abcd',
        scopeKind: 'application' as const,
        scopeId: 'application',
        tenantId: null,
        membershipId: null,
        issuedAuthGeneration: 0,
        createdByUserId: 'api-key-user',
        createdVia: 'self' as const,
        createdAt: now,
        expiresAt: now + 60_000,
      };

      const insertLease = await coordinator.acquireShared();
      try {
        expect(() => store.insert(input)).toThrow(expect.objectContaining({
          code: 'DATABASE_CONFLICT',
          outcome: 'not-committed',
        }));
      } finally {
        insertLease.release();
      }
      expect(store.getById(input.keyId)).toBeNull();

      const created = store.insert(input);
      const revokeLease = await coordinator.acquireShared();
      try {
        expect(() => store.revoke(
          created.keyId,
          created.keyGeneration,
          input.userId,
          now + 1,
        )).toThrow(expect.objectContaining({
          code: 'DATABASE_CONFLICT',
          outcome: 'not-committed',
        }));
      } finally {
        revokeLease.release();
      }
      expect(store.getById(input.keyId)).toMatchObject({
        revokedAt: null,
        keyGeneration: 1,
      });
    } finally {
      await coordinator.close();
      db.dispose();
    }
  });
});
