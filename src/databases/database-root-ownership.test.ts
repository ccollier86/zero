import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DatabaseError } from './database-error';
import { prepareDatabaseFile } from './database-file';
import {
  acquireDatabaseRootOwnership,
  type DatabaseRootOwnershipGuard,
} from './database-root-ownership';

const temporaryDirectories: string[] = [];
const activeGuards = new Set<DatabaseRootOwnershipGuard>();

afterEach(() => {
  for (const guard of activeGuards) {
    try { guard.release(); } catch { /* Preserve the test's original failure. */ }
  }
  activeGuards.clear();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('database root ownership', () => {
  test('keeps the owner locked after a same-process loser before a child also loses', async () => {
    const root = createRoot();
    const first = acquire(root);
    const startedAt = performance.now();
    const error = captureError(() => acquireDatabaseRootOwnership(root));

    expect(error.code).toBe('DATABASE_CONFLICT');
    expect(error.retryable).toBe(true);
    expect(error.outcome).toBe('not-started');
    expect(performance.now() - startedAt).toBeLessThan(500);
    expect(error.message).not.toContain(root);
    expect(error.details).toEqual({});
    expect(error.cause).toBeUndefined();
    expect(first.released).toBe(false);
    expect(await runOneShotChildClaim(root)).toBe('DATABASE_CONFLICT');
  });

  test('releases idempotently and permits a later claimant', () => {
    const root = createRoot();
    const first = acquire(root);

    first.release();
    first.release();
    activeGuards.delete(first);
    expect(first.released).toBe(true);

    const second = acquire(root);
    expect(second.released).toBe(false);
  });

  test('canonicalizes ancestor aliases to one ownership boundary', () => {
    const base = createTemporaryDirectory();
    const realAncestor = join(base, 'real');
    const aliasAncestor = join(base, 'alias');
    mkdirSync(realAncestor);
    symlinkSync(realAncestor, aliasAncestor, 'dir');
    const aliasRoot = join(aliasAncestor, 'nested', 'databases');
    const canonicalRoot = join(realpathSync.native(realAncestor), 'nested', 'databases');

    acquire(aliasRoot);
    expect(captureError(
      () => acquireDatabaseRootOwnership(canonicalRoot),
    ).code).toBe('DATABASE_CONFLICT');
  });

  test('keeps ownership outside the flat application database namespace', () => {
    const root = createRoot();
    acquire(root);

    const applicationFile = prepareDatabaseFile(
      root,
      '_zero_root_ownership_v1',
    );
    expect(applicationFile.path).not.toBe(onlySQLiteFile(root));
    expect(applicationFile.rootDirectory).toBe(realpathSync.native(root));
  });

  test('uses rollback journal mode and holds a real exclusive SQLite lock', () => {
    const root = createRoot();
    const guard = acquire(root);
    const ownershipPath = onlySQLiteFile(root);
    const contender = new Database(ownershipPath, {
      create: false,
      readwrite: true,
      strict: true,
    });
    try {
      contender.run('PRAGMA busy_timeout = 0');
      const error = captureSQLiteError(() => contender.run('BEGIN EXCLUSIVE'));
      expect(error.code).toBe('SQLITE_BUSY');
    } finally {
      contender.close(true);
    }

    guard.release();
    activeGuards.delete(guard);
    const inspection = new Database(ownershipPath, {
      create: false,
      readwrite: true,
      strict: true,
    });
    try {
      expect(inspection.query('PRAGMA journal_mode').get()).toEqual({
        journal_mode: 'delete',
      });
    } finally {
      inspection.close(true);
    }
  });

  test.skipIf(process.platform === 'win32')(
    'releases the OS lock after an owning process crashes without removing the file',
    async () => {
      const root = createRoot();
      const ready = join(createTemporaryDirectory(), 'owner-ready');
      const childSource = `
        import { writeFileSync } from 'node:fs';
        import { acquireDatabaseRootOwnership } from './src/databases/database-root-ownership.ts';
        const [, root, ready] = Bun.argv;
        const guard = acquireDatabaseRootOwnership(root);
        writeFileSync(ready, 'ready');
        setInterval(() => void guard.released, 1_000);
      `;
      const child = Bun.spawn([
        process.execPath,
        '-e',
        childSource,
        root,
        ready,
      ], {
        cwd: process.cwd(),
        env: Bun.env,
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'pipe',
      });

      try {
        await waitForFile(ready, child);
        expect(captureError(
          () => acquireDatabaseRootOwnership(root),
        ).code).toBe('DATABASE_CONFLICT');

        child.kill('SIGKILL');
        expect(await child.exited).not.toBe(0);
        expect(existsSync(onlySQLiteFile(root))).toBe(true);

        const replacement = acquire(root);
        expect(replacement.released).toBe(false);
      } finally {
        if (child.exitCode === null) child.kill('SIGKILL');
        await child.exited;
      }
    },
  );
});

function acquire(root: string): DatabaseRootOwnershipGuard {
  const guard = acquireDatabaseRootOwnership(root);
  activeGuards.add(guard);
  return guard;
}

function createRoot(): string {
  return join(createTemporaryDirectory(), 'managed-databases');
}

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'zero-root-ownership-'));
  temporaryDirectories.push(directory);
  return directory;
}

function onlySQLiteFile(root: string): string {
  const rootEntries = readdirSync(root, { withFileTypes: true });
  const internalDirectories = rootEntries.filter((entry) => entry.isDirectory());
  expect(internalDirectories).toHaveLength(1);
  const internalRoot = join(root, internalDirectories[0]!.name);
  const files = readdirSync(internalRoot).filter((file) => file.endsWith('.sqlite'));
  expect(files).toHaveLength(1);
  return join(internalRoot, files[0]!);
}

function captureError(operation: () => unknown): DatabaseError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
  throw new Error('Expected a DatabaseError.');
}

function captureSQLiteError(operation: () => unknown): {
  readonly code: string | undefined;
} {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return { code: (error as { code?: string }).code };
  }
  throw new Error('Expected a SQLite error.');
}

async function waitForFile(
  path: string,
  child: Bun.Subprocess<'ignore', 'ignore', 'pipe'>,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!existsSync(path) && child.exitCode === null && Date.now() < deadline) {
    await Bun.sleep(5);
  }
  if (existsSync(path)) return;
  const stderr = await new Response(child.stderr).text();
  throw new Error(`Ownership child did not become ready: ${stderr}`);
}

async function runOneShotChildClaim(root: string): Promise<string> {
  const childSource = `
    import { acquireDatabaseRootOwnership } from './src/databases/database-root-ownership.ts';
    try {
      const guard = acquireDatabaseRootOwnership(Bun.argv[1]);
      guard.release();
      console.log('acquired');
    } catch (error) {
      console.log(error?.code ?? 'unknown');
    }
  `;
  const child = Bun.spawn([
    process.execPath,
    '-e',
    childSource,
    root,
  ], {
    cwd: process.cwd(),
    env: Bun.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(exitCode, stderr).toBe(0);
  return stdout.trim();
}
