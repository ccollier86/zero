import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  installAuthAuthorityRevision,
  readAuthAuthorityRevision,
} from '../auth/auth-authority-revision';
import { createReactiveDB } from '../sync/reactive-db';
import { AuthorityCommitCoordinator } from './authority-commit-coordinator';
import { registerApplicationAuthorityCommitGuard } from './database-application-authority-commit-guard';
import {
  databaseAuthorityCommitFencePath,
  DatabaseAuthorityCommitFileFence,
} from './database-authority-commit-file-fence';
import { registerDatabaseAuthorityCommitGuard } from './database-authority-commit-guard';

describe('cross-process authority commit file fence', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0).reverse()) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('provides non-blocking OS-backed exclusion across independent handles', () => {
    const systemPath = temporarySystemPath(roots);
    const first = new DatabaseAuthorityCommitFileFence(systemPath);
    const second = new DatabaseAuthorityCommitFileFence(systemPath);
    try {
      const firstLease = first.tryAcquireExclusive();
      expect(firstLease).not.toBeNull();
      expect(second.tryAcquireExclusive()).toBeNull();

      firstLease!.release();
      expect(firstLease!.released).toBe(true);
      const secondLease = second.tryAcquireExclusive();
      expect(secondLease).not.toBeNull();
      secondLease!.release();
    } finally {
      second.close();
      first.close();
    }
  });

  test('shares tenant commit edges while excluding Guardian and permits lazy handles', () => {
    const systemPath = temporarySystemPath(roots);
    const first = new DatabaseAuthorityCommitFileFence(systemPath);
    const second = new DatabaseAuthorityCommitFileFence(systemPath);
    let third: DatabaseAuthorityCommitFileFence | null = null;
    try {
      const firstLease = first.tryAcquireShared();
      const secondLease = second.tryAcquireShared();
      expect(firstLease?.mode).toBe('shared');
      expect(secondLease?.mode).toBe('shared');

      // Constructing a process-local handle after another tenant reaches its
      // final edge must be read-only on an initialized sidecar. In particular,
      // it cannot issue the bootstrap INSERT that requires a RESERVED lock.
      third = new DatabaseAuthorityCommitFileFence(systemPath);
      expect(third.tryAcquireExclusive()).toBeNull();

      firstLease!.release();
      expect(third.tryAcquireExclusive()).toBeNull();
      secondLease!.release();

      const exclusive = third.tryAcquireExclusive();
      expect(exclusive?.mode).toBe('exclusive');
      exclusive!.release();
    } finally {
      third?.close();
      second.close();
      first.close();
    }
  });

  test('fails closed when the sidecar pathname is replaced', () => {
    const systemPath = temporarySystemPath(roots);
    const first = new DatabaseAuthorityCommitFileFence(systemPath);
    let replacement: DatabaseAuthorityCommitFileFence | null = null;
    try {
      const sidecarPath = databaseAuthorityCommitFencePath(systemPath);
      renameSync(sidecarPath, `${sidecarPath}.displaced`);
      writeFileSync(sidecarPath, '');

      expect(() => first.tryAcquireShared()).toThrow(expect.objectContaining({
        code: 'DATABASE_OPEN_FAILED',
        retryable: false,
        outcome: 'not-committed',
      }));

      replacement = new DatabaseAuthorityCommitFileFence(systemPath);
      const lease = replacement.tryAcquireExclusive();
      expect(lease?.mode).toBe('exclusive');
      lease!.release();
    } finally {
      replacement?.close();
      first.close();
    }
  });

  test('rejects malformed initialized sidecar schema, journal, and singleton', () => {
    const setups: Array<(database: Database) => void> = [
      (database) => {
        database.run(`
          CREATE TABLE _zero_authority_commit_fence (
            singleton INTEGER PRIMARY KEY
          )
        `);
        database.run(`
          INSERT INTO _zero_authority_commit_fence (singleton) VALUES (1)
        `);
      },
      (database) => {
        database.run(`
          CREATE TABLE _zero_authority_commit_fence (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1)
          )
        `);
      },
      (database) => {
        database.run('PRAGMA journal_mode = WAL');
        database.run(`
          CREATE TABLE _zero_authority_commit_fence (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1)
          )
        `);
        database.run(`
          INSERT INTO _zero_authority_commit_fence (singleton) VALUES (1)
        `);
      },
    ];

    for (const setup of setups) {
      const systemPath = temporarySystemPath(roots);
      const sidecarPath = databaseAuthorityCommitFencePath(systemPath);
      const database = new Database(sidecarPath, {
        create: true,
        readwrite: true,
        strict: true,
      });
      setup(database);
      database.close(true);

      expect(() => new DatabaseAuthorityCommitFileFence(systemPath))
        .toThrow(expect.objectContaining({
          code: 'DATABASE_SCHEMA_MISMATCH',
          retryable: false,
          outcome: 'not-started',
        }));
    }
  });

  test.skipIf(process.platform === 'win32')(
    'releases cross-process commit ownership after the holder crashes',
    async () => {
      const systemPath = temporarySystemPath(roots);
      const readyPath = join(dirname(systemPath), 'ready');
      const localFence = new DatabaseAuthorityCommitFileFence(systemPath);
      const childSource = `
        import { writeFileSync } from 'node:fs';
        import { DatabaseAuthorityCommitFileFence } from './src/databases/database-authority-commit-file-fence.ts';
        const [, systemPath, readyPath] = Bun.argv;
        const fence = new DatabaseAuthorityCommitFileFence(systemPath);
        const lease = fence.tryAcquireExclusive();
        if (!lease) process.exit(2);
        writeFileSync(readyPath, 'ready');
        setInterval(() => void lease.released, 1_000);
      `;
      const child = Bun.spawn([
        process.execPath,
        '-e',
        childSource,
        systemPath,
        readyPath,
      ], {
        cwd: process.cwd(),
        env: Bun.env,
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'pipe',
      });
      const stderrText = new Response(child.stderr).text();

      try {
        const deadline = Date.now() + 5_000;
        while (!existsSync(readyPath)
          && child.exitCode === null
          && Date.now() < deadline) {
          await Bun.sleep(5);
        }
        if (!existsSync(readyPath)) {
          if (child.exitCode === null) child.kill('SIGKILL');
          await child.exited;
          throw new Error(`Authority fence child did not become ready: ${await stderrText}`);
        }
        expect(localFence.tryAcquireExclusive()).toBeNull();

        child.kill('SIGKILL');
        expect(await child.exited).not.toBe(0);
        const replacement = localFence.tryAcquireExclusive();
        expect(replacement).not.toBeNull();
        replacement!.release();
      } finally {
        if (child.exitCode === null) child.kill('SIGKILL');
        await child.exited;
        await stderrText.catch(() => '');
        localFence.close();
      }
    },
    10_000,
  );

  test('rolls back an app commit while another process owns the authority edge', async () => {
    const systemPath = temporarySystemPath(roots);
    const system = createReactiveDB({ mode: 'file', path: systemPath });
    const application = createReactiveDB({ mode: 'memory' });
    const coordinator = new AuthorityCommitCoordinator();
    const localFence = new DatabaseAuthorityCommitFileFence(systemPath);
    const remoteFence = new DatabaseAuthorityCommitFileFence(systemPath);
    try {
      installAuthAuthorityRevision(system);
      application.defineTable('notes', { note_id: 'text primary key' });
      registerApplicationAuthorityCommitGuard(
        application,
        system,
        coordinator,
        localFence,
      );
      const remoteLease = remoteFence.tryAcquireExclusive();
      expect(remoteLease).not.toBeNull();

      expect(() => application.insert('notes', { note_id: 'stale' }))
        .toThrow(expect.objectContaining({
          code: 'DATABASE_AUTHORITY_CHANGED',
          outcome: 'not-committed',
        }));
      expect(application.get('notes', 'stale')).toBeNull();

      remoteLease!.release();
      application.insert('notes', { note_id: 'current' });
      expect(application.get('notes', 'current')).toEqual({ note_id: 'current' });
    } finally {
      remoteFence.close();
      localFence.close();
      await coordinator.close();
      application.dispose();
      system.dispose();
    }
  });

  test('rolls back a Guardian authority commit while an app edge is owned remotely', async () => {
    const systemPath = temporarySystemPath(roots);
    const system = createReactiveDB({ mode: 'file', path: systemPath });
    const coordinator = new AuthorityCommitCoordinator();
    const localFence = new DatabaseAuthorityCommitFileFence(systemPath);
    const remoteFence = new DatabaseAuthorityCommitFileFence(systemPath);
    try {
      system.exec(`
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
      installAuthAuthorityRevision(system);
      system.prepare(`
        INSERT INTO users (
          user_id, email, role, status, password_change_required,
          email_verification_required, email_verified_at, mfa_required,
          email_generation
        ) VALUES (?, ?, ?, ?, 0, 0, NULL, 0, 0)
      `).run('user-a', 'a@example.test', 'user', 'active');
      const baseline = readAuthAuthorityRevision(system);
      registerDatabaseAuthorityCommitGuard(system, coordinator, localFence);
      const remoteLease = remoteFence.tryAcquireExclusive();
      expect(remoteLease).not.toBeNull();

      expect(() => system.transaction(() => {
        system.prepare('UPDATE users SET role = ? WHERE user_id = ?')
          .run('admin', 'user-a');
      })).toThrow(expect.objectContaining({
        code: 'DATABASE_CONFLICT',
        retryable: true,
        outcome: 'not-committed',
      }));
      expect(readAuthAuthorityRevision(system)).toBe(baseline);

      remoteLease!.release();
      system.transaction(() => {
        system.prepare('UPDATE users SET role = ? WHERE user_id = ?')
          .run('admin', 'user-a');
      });
      expect(readAuthAuthorityRevision(system)).toBe((baseline ?? 0) + 1);
    } finally {
      remoteFence.close();
      localFence.close();
      await coordinator.close();
      system.dispose();
    }
  });
});

function temporarySystemPath(roots: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'zero-authority-file-fence-'));
  roots.push(root);
  const path = join(root, 'system.db');
  writeFileSync(path, '');
  return path;
}
