import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { installAuthAuthorityRevision } from '../auth/auth-authority-revision';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { DatabaseActorAuthorityCommitGuard } from './database-actor-authority-commit-guard';
import { DatabaseActorAuthorityContext } from './database-actor-authority-context';
import { DatabaseAuthorityCommitFileFence } from './database-authority-commit-file-fence';

describe('database actor authority context', () => {
  const roots: string[] = [];
  const runtimes: ReactiveDB[] = [];

  afterEach(() => {
    for (const runtime of runtimes.splice(0).reverse()) {
      runtime.dispose();
    }
    for (const root of roots.splice(0).reverse()) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects a configured path for a different live system handle', () => {
    const root = temporaryRoot(roots);
    const first = fileRuntime(join(root, 'first.sqlite'), runtimes);
    fileRuntime(join(root, 'second.sqlite'), runtimes);

    expect(() => new DatabaseActorAuthorityContext(
      first,
      join(root, 'second.sqlite'),
    )).toThrow(expect.objectContaining({
      code: 'DATABASE_CONFIG_INVALID',
      retryable: false,
      outcome: 'not-started',
    }));
  });

  test('canonicalizes an equivalent symlinked directory alias', () => {
    const root = temporaryRoot(roots);
    const canonicalDirectory = join(root, 'canonical');
    const aliasDirectory = join(root, 'alias');
    mkdirSync(canonicalDirectory);
    symlinkSync(canonicalDirectory, aliasDirectory, 'dir');
    const aliasPath = join(aliasDirectory, 'system.sqlite');
    const canonicalPath = join(canonicalDirectory, 'system.sqlite');
    const system = fileRuntime(aliasPath, runtimes);

    const context = new DatabaseActorAuthorityContext(system, canonicalPath);

    expect(context.actorBinding().systemDatabasePath).toBe(
      realpathSync.native(canonicalPath),
    );
  });

  test('rejects pathname replacement even when SQLite reports the same path', () => {
    const root = temporaryRoot(roots);
    const systemPath = join(root, 'system.sqlite');
    const displacedPath = join(root, 'system.displaced.sqlite');
    const system = fileRuntime(systemPath, runtimes);
    renameSync(systemPath, displacedPath);
    const replacement = new Database(systemPath, { create: true });
    replacement.close(true);

    expect(() => new DatabaseActorAuthorityContext(system, systemPath))
      .toThrow(expect.objectContaining({
        code: 'DATABASE_CONFIG_INVALID',
        retryable: false,
        outcome: 'not-started',
      }));
  });

  test('requires an explicit revision for every protected actor write', () => {
    const root = temporaryRoot(roots);
    const systemPath = join(root, 'system.sqlite');
    const system = fileRuntime(systemPath, runtimes);
    const target = createReactiveDB({ mode: 'memory' });
    runtimes.push(target);
    installAuthAuthorityRevision(system);
    target.defineTable('notes', { note_id: 'text primary key' });
    const context = new DatabaseActorAuthorityContext(system, systemPath);
    const guard = DatabaseActorAuthorityCommitGuard.open(
      target,
      context.actorBinding(),
    );
    try {
      expect(() => guard.run(undefined, () => {
        target.insert('notes', { note_id: 'missing-revision' });
      })).toThrow(expect.objectContaining({
        code: 'DATABASE_PROTOCOL_ERROR',
        retryable: false,
        outcome: 'not-started',
      }));
      expect(target.get('notes', 'missing-revision')).toBeNull();

      // The ReactiveDB guard also rejects a write which bypasses the actor's
      // scoped run boundary instead of inheriting stale request authority.
      expect(() => target.insert('notes', { note_id: 'ambient-revision' }))
        .toThrow(expect.objectContaining({
          code: 'DATABASE_AUTHORITY_CHANGED',
          outcome: 'not-committed',
        }));
      expect(target.get('notes', 'ambient-revision')).toBeNull();

      guard.run(context.captureRevision(), () => {
        target.insert('notes', { note_id: 'current-revision' });
      });
      expect(target.get('notes', 'current-revision')).toEqual({
        note_id: 'current-revision',
      });
    } finally {
      guard.close();
    }
  });

  test('keeps retained identity-anchor maintenance outside the application authority fence', () => {
    const root = temporaryRoot(roots);
    const systemPath = join(root, 'system.sqlite');
    const system = fileRuntime(systemPath, runtimes);
    const target = createReactiveDB({ mode: 'memory' });
    runtimes.push(target);
    installAuthAuthorityRevision(system);
    target.defineTable('users', { user_id: 'text primary key' });
    const context = new DatabaseActorAuthorityContext(system, systemPath);
    const guard = DatabaseActorAuthorityCommitGuard.open(
      target,
      context.actorBinding(),
    );
    const competingFence = new DatabaseAuthorityCommitFileFence(systemPath);
    const exclusive = competingFence.tryAcquireExclusive();
    expect(exclusive?.mode).toBe('exclusive');
    try {
      expect(() => guard.run(context.captureRevision(), () => {
        target.insert('users', { user_id: 'application-write' });
      })).toThrow(expect.objectContaining({
        code: 'DATABASE_AUTHORITY_CHANGED',
        outcome: 'not-committed',
      }));
      expect(target.get('users', 'application-write')).toBeNull();

      guard.runAuthorityNeutral(() => {
        target.insert('users', { user_id: 'retained-anchor' });
      });
      expect(target.get('users', 'retained-anchor')).toEqual({
        user_id: 'retained-anchor',
      });

      // The neutral context is synchronous and cannot leak to later writes.
      expect(() => target.insert('users', { user_id: 'ambient-write' }))
        .toThrow(expect.objectContaining({
          code: 'DATABASE_AUTHORITY_CHANGED',
          outcome: 'not-committed',
        }));
      expect(target.get('users', 'ambient-write')).toBeNull();
    } finally {
      exclusive?.release();
      competingFence.close();
      guard.close();
    }
  });
});

function temporaryRoot(roots: string[]): string {
  const root = realpathSync.native(
    mkdtempSync(join(tmpdir(), 'zero-actor-authority-context-')),
  );
  roots.push(root);
  return root;
}

function fileRuntime(path: string, runtimes: ReactiveDB[]): ReactiveDB {
  const raw = new Database(path, {
    create: true,
    readwrite: true,
    strict: true,
  });
  raw.run('PRAGMA journal_mode = DELETE');
  const runtime = createReactiveDB({
    database: raw,
    ownsDatabase: true,
  });
  runtimes.push(runtime);
  return runtime;
}
