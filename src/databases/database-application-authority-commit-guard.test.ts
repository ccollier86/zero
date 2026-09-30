import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import {
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AUTH_AUTHORITY_REVISION_TABLE,
  installAuthAuthorityRevision,
} from '../auth/auth-authority-revision';
import { createReactiveDB } from '../sync/reactive-db';
import { AuthorityCommitCoordinator } from './authority-commit-coordinator';
import { registerApplicationAuthorityCommitGuard } from './database-application-authority-commit-guard';
import { DatabaseAuthorityCommitFileFence } from './database-authority-commit-file-fence';
import { DatabaseError } from './database-error';

describe('application authority commit guard', () => {
  test('commits under a shared lease and releases it after SQLite settles', async () => {
    const system = createReactiveDB({ mode: 'memory' });
    const application = createReactiveDB({ mode: 'memory' });
    const coordinator = new AuthorityCommitCoordinator();
    try {
      installAuthAuthorityRevision(system);
      application.defineTable('notes', {
        note_id: 'text primary key',
        body: 'text not null',
      });
      const remove = registerApplicationAuthorityCommitGuard(
        application,
        system,
        coordinator,
      );

      application.insert('notes', { note_id: 'note-a', body: 'safe' });

      expect(application.get('notes', 'note-a')).toEqual({
        note_id: 'note-a',
        body: 'safe',
      });
      expect(coordinator.diagnostics().activeShared).toBe(0);
      remove();
    } finally {
      await coordinator.close();
      application.dispose();
      system.dispose();
    }
  });

  test('rolls back while an authority mutation owns the exclusive side', async () => {
    const system = createReactiveDB({ mode: 'memory' });
    const application = createReactiveDB({ mode: 'memory' });
    const coordinator = new AuthorityCommitCoordinator();
    try {
      installAuthAuthorityRevision(system);
      application.defineTable('notes', { note_id: 'text primary key' });
      registerApplicationAuthorityCommitGuard(application, system, coordinator);
      const authority = await coordinator.acquireExclusive();

      expect(() => application.insert('notes', { note_id: 'blocked' }))
        .toThrow(expect.objectContaining({
          code: 'DATABASE_AUTHORITY_CHANGED',
          outcome: 'not-committed',
        }));
      expect(application.get('notes', 'blocked')).toBeNull();
      authority.release();
    } finally {
      await coordinator.close();
      application.dispose();
      system.dispose();
    }
  });

  test('rolls back when authority revision changes after transaction capture', async () => {
    const system = createReactiveDB({ mode: 'memory' });
    const application = createReactiveDB({ mode: 'memory' });
    const coordinator = new AuthorityCommitCoordinator();
    try {
      installAuthAuthorityRevision(system);
      application.defineTable('notes', { note_id: 'text primary key' });
      registerApplicationAuthorityCommitGuard(application, system, coordinator);

      let failure: unknown;
      try {
        application.transaction(() => {
          application.insert('notes', { note_id: 'stale' });
          system.prepare(`
            UPDATE ${AUTH_AUTHORITY_REVISION_TABLE}
            SET revision = revision + 1 WHERE singleton = 1
          `).run();
        });
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(DatabaseError);
      expect(failure).toMatchObject({
        code: 'DATABASE_AUTHORITY_CHANGED',
        outcome: 'not-committed',
      });
      expect(application.get('notes', 'stale')).toBeNull();
      expect(coordinator.diagnostics()).toMatchObject({
        activeShared: 0,
        activeExclusive: false,
      });
    } finally {
      await coordinator.close();
      application.dispose();
      system.dispose();
    }
  });

  test('fails closed when the authority revision disappears', async () => {
    const system = createReactiveDB({ mode: 'memory' });
    const application = createReactiveDB({ mode: 'memory' });
    const coordinator = new AuthorityCommitCoordinator();
    try {
      installAuthAuthorityRevision(system);
      application.defineTable('notes', { note_id: 'text primary key' });
      registerApplicationAuthorityCommitGuard(application, system, coordinator);

      expect(() => application.transaction(() => {
        application.insert('notes', { note_id: 'lost-during-commit' });
        system.prepare(`DELETE FROM ${AUTH_AUTHORITY_REVISION_TABLE}`).run();
      })).toThrow(expect.objectContaining({
        code: 'DATABASE_AUTHORITY_CHANGED',
        outcome: 'not-committed',
      }));
      expect(application.get('notes', 'lost-during-commit')).toBeNull();

      expect(() => application.insert('notes', { note_id: 'missing-at-start' }))
        .toThrow(expect.objectContaining({
          code: 'DATABASE_SCHEMA_MISMATCH',
          outcome: 'not-started',
        }));
      expect(application.get('notes', 'missing-at-start')).toBeNull();
    } finally {
      await coordinator.close();
      application.dispose();
      system.dispose();
    }
  });

  test('rolls back when the bound system database pathname is replaced', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-application-system-binding-'));
    const systemPath = join(root, 'system.sqlite');
    const displacedPath = join(root, 'system.displaced.sqlite');
    const raw = new Database(systemPath, {
      create: true,
      readwrite: true,
      strict: true,
    });
    raw.run('PRAGMA journal_mode = DELETE');
    const system = createReactiveDB({ database: raw, ownsDatabase: true });
    const application = createReactiveDB({ mode: 'memory' });
    const coordinator = new AuthorityCommitCoordinator();
    let fence: DatabaseAuthorityCommitFileFence | null = null;
    try {
      installAuthAuthorityRevision(system);
      application.defineTable('notes', { note_id: 'text primary key' });
      fence = new DatabaseAuthorityCommitFileFence(systemPath);
      registerApplicationAuthorityCommitGuard(
        application,
        system,
        coordinator,
        fence,
      );

      expect(() => application.transaction(() => {
        application.insert('notes', { note_id: 'replaced-system' });
        renameSync(systemPath, displacedPath);
        writeFileSync(systemPath, '');
      })).toThrow(expect.objectContaining({
        code: 'DATABASE_OPEN_FAILED',
        retryable: false,
        outcome: 'not-committed',
      }));
      expect(application.get('notes', 'replaced-system')).toBeNull();
    } finally {
      fence?.close();
      await coordinator.close();
      application.dispose();
      system.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects a fence bound to a different system database handle', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-application-system-mismatch-'));
    const systemPath = join(root, 'system.sqlite');
    writeFileSync(systemPath, '');
    const system = createReactiveDB({ mode: 'memory' });
    const application = createReactiveDB({ mode: 'memory' });
    const coordinator = new AuthorityCommitCoordinator();
    const fence = new DatabaseAuthorityCommitFileFence(systemPath);
    try {
      installAuthAuthorityRevision(system);
      expect(() => registerApplicationAuthorityCommitGuard(
        application,
        system,
        coordinator,
        fence,
      )).toThrow(expect.objectContaining({
        code: 'DATABASE_CONFIG_INVALID',
        retryable: false,
        outcome: 'not-started',
      }));
    } finally {
      fence.close();
      await coordinator.close();
      application.dispose();
      system.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
