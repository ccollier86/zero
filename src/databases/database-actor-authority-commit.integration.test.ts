import { afterEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  installAuthAuthorityRevision,
  readAuthAuthorityRevision,
} from '../auth/auth-authority-revision';
import { defineAuthTables } from '../auth/auth-schema';
import { createReactiveDB } from '../sync/reactive-db';
import { AuthorityCommitCoordinator } from './authority-commit-coordinator';
import { DatabaseActorAuthorityContext } from './database-actor-authority-context';
import { DatabaseAuthorityCommitFileFence } from './database-authority-commit-file-fence';
import { createDatabaseCommitAuthority } from './database-commit-authority';
import {
  DatabaseCoordinator,
  type DatabaseCoordinatorLease,
} from './database-coordinator';
import { DatabaseError } from './database-error';
import { SubprocessDatabaseExecutor } from './subprocess-database-executor';
import { databaseActorFixtureRealm } from './test-fixtures/database-actor-realm';

const ACTOR_CHILD_PATH = fileURLToPath(new URL(
  './test-fixtures/database-actor-child.ts',
  import.meta.url,
));
const GUARDIAN_CHILD_PATH = fileURLToPath(new URL(
  './test-fixtures/database-guardian-authority-mutator-child.ts',
  import.meta.url,
));

describe('Fabric actor cross-process Guardian commit fence', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0).reverse()) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('orders Guardian and concurrent tenant commits at the final edge', async () => {
    const base = realpathSync.native(
      mkdtempSync(join(tmpdir(), 'zero-actor-authority-fence-')),
    );
    roots.push(base);
    const fabricRoot = join(base, 'fabric');
    const barriers = join(base, 'barriers');
    mkdirSync(fabricRoot);
    mkdirSync(barriers);
    const systemPath = join(base, 'system.sqlite');
    const system = createReactiveDB({ mode: 'file', path: systemPath });
    defineAuthTables(system);
    installAuthAuthorityRevision(system);
    system.insert('users', {
      user_id: 'authority-user',
      username: 'authority-user',
      email: 'authority-user@example.test',
      role: 'user',
      status: 'active',
      created_at: Date.now(),
    });

    const authority = new AuthorityCommitCoordinator();
    const actorAuthority = new DatabaseActorAuthorityContext(system, systemPath);
    const externalSharedFence = new DatabaseAuthorityCommitFileFence(
      actorAuthority.actorBinding().systemDatabasePath,
    );
    const coordinator = new DatabaseCoordinator({
      rootDirectory: fabricRoot,
      realm: databaseActorFixtureRealm,
      readers: false,
      maxDatabases: 2,
      maxTenantSyncDatabases: 2,
      sweepIntervalMs: false,
      operationTimeoutMs: 12_000,
      authorityCommitCoordinator: authority,
      requireCommitAuthority: true,
      actorAuthorityContext: actorAuthority,
      createExecutor: ({ role, slot }) => new SubprocessDatabaseExecutor({
        command: [process.execPath, ACTOR_CHILD_PATH, role, String(slot)],
        env: {},
        role,
        slot,
        maxInFlight: 1,
        startupTimeoutMs: 3_000,
        operationTimeoutMs: 12_000,
        shutdownAckTimeoutMs: 2_000,
        shutdownExitTimeoutMs: 2_000,
        sigtermTimeoutMs: 1_000,
        sigkillTimeoutMs: 1_000,
      }),
    });
    const releases = new Set<string>();
    let alpha: DatabaseCoordinatorLease | null = null;
    let beta: DatabaseCoordinatorLease | null = null;
    coordinator.start();
    try {
      alpha = await acquireAuthorized(coordinator, authority, 'tenant-alpha');
      beta = await acquireAuthorized(coordinator, authority, 'tenant-beta');
      await Promise.all([
        alpha.execute(createTodo('row', 'Alpha initial')),
        beta.execute(createTodo('row', 'Beta initial')),
      ]);

      // Guardian wins after the parent's live check but before actor commit.
      // The actor must compare the earlier revision and roll back its row.
      const staleEntered = join(barriers, 'stale-entered');
      const staleRelease = registerRelease(releases, join(barriers, 'stale-release'));
      const staleWrite = alpha.execute(blockingUpdate({
        title: 'Alpha stale',
        enteredPath: staleEntered,
        releasePath: staleRelease,
      }));
      void staleWrite.catch(() => undefined);
      await waitForFile(staleEntered);
      const guardianWinner = await mutateGuardian(systemPath, 'admin');
      expect(guardianWinner).toMatchObject({ status: 'committed' });
      release(releases, staleRelease);
      await expect(databaseError(staleWrite)).resolves.toMatchObject({
        code: 'DATABASE_AUTHORITY_CHANGED',
        outcome: 'not-committed',
      });
      expect(await title(alpha, 'row')).toBe('Alpha initial');

      // A real shared lease may coexist with both actor commit edges. While
      // any tenant edge owns that side, Guardian's EXCLUSIVE edge must retry.
      const alphaEntered = join(barriers, 'alpha-entered');
      const betaEntered = join(barriers, 'beta-entered');
      const alphaRelease = registerRelease(releases, join(barriers, 'alpha-release'));
      const betaRelease = registerRelease(releases, join(barriers, 'beta-release'));
      const alphaWrite = alpha.execute(blockingUpdate({
        title: 'Alpha current',
        enteredPath: alphaEntered,
        releasePath: alphaRelease,
      }));
      const betaWrite = beta.execute(blockingUpdate({
        title: 'Beta current',
        enteredPath: betaEntered,
        releasePath: betaRelease,
      }));
      void alphaWrite.catch(() => undefined);
      void betaWrite.catch(() => undefined);
      await Promise.all([waitForFile(alphaEntered), waitForFile(betaEntered)]);

      const sharedLease = externalSharedFence.tryAcquireShared();
      expect(sharedLease?.mode).toBe('shared');
      try {
        release(releases, alphaRelease);
        release(releases, betaRelease);
        await expect(Promise.all([alphaWrite, betaWrite])).resolves.toHaveLength(2);
        expect(await title(alpha, 'row')).toBe('Alpha current');
        expect(await title(beta, 'row')).toBe('Beta current');

        const guardianRetry = await mutateGuardian(systemPath, 'owner');
        expect(guardianRetry).toEqual({
          status: 'rejected',
          code: 'DATABASE_CONFLICT',
          retryable: true,
          outcome: 'not-committed',
        });
      } finally {
        sharedLease?.release();
      }

      const guardianAfterRelease = await mutateGuardian(systemPath, 'owner');
      expect(guardianAfterRelease).toMatchObject({ status: 'committed' });
      if (guardianAfterRelease.status !== 'committed') {
        throw new Error('Guardian mutation did not commit after fence release.');
      }
      expect(readAuthAuthorityRevision(system)).toBe(
        guardianAfterRelease.revision,
      );
    } finally {
      for (const path of releases) writeFileSync(path, 'release');
      alpha?.release();
      beta?.release();
      await coordinator.close().catch(() => undefined);
      externalSharedFence.close();
      await authority.close().catch(() => undefined);
      system.dispose();
    }
  }, 30_000);
});

async function acquireAuthorized(
  coordinator: DatabaseCoordinator,
  authority: AuthorityCommitCoordinator,
  databaseId: string,
): Promise<DatabaseCoordinatorLease> {
  return await coordinator.acquire(databaseId, {
    commitAuthority: createDatabaseCommitAuthority(
      authority,
      databaseId,
      () => undefined,
    ),
  });
}

function createTodo(id: string, titleValue: string) {
  return {
    type: 'mutate' as const,
    idempotencyKey: `create:${id}:${titleValue.replaceAll(' ', '-')}`,
    mutation: {
      type: 'create' as const,
      table: 'todos',
      row: { id, title: titleValue },
    },
  };
}

function blockingUpdate(input: {
  title: string;
  enteredPath: string;
  releasePath: string;
}) {
  return {
    type: 'command' as const,
    name: 'test.blockingUpdate',
    input: { id: 'row', ...input },
    idempotencyKey: `blocking:${input.title.replaceAll(' ', '-')}`,
  };
}

async function title(
  lease: DatabaseCoordinatorLease,
  id: string,
): Promise<unknown> {
  const result = await lease.execute({
    type: 'get',
    table: 'todos',
    id,
    consistency: { mode: 'strong' },
  });
  return (result.value as { title?: unknown } | null)?.title;
}

function registerRelease(releases: Set<string>, path: string): string {
  releases.add(path);
  return path;
}

function release(releases: Set<string>, path: string): void {
  writeFileSync(path, 'release');
  releases.delete(path);
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error('Actor barrier timed out.');
    await Bun.sleep(5);
  }
}

type GuardianMutationResult =
  | Readonly<{ status: 'committed'; revision: number }>
  | Readonly<{
      status: 'rejected';
      code: string;
      retryable: boolean;
      outcome: string;
    }>;

async function mutateGuardian(
  systemPath: string,
  role: string,
): Promise<GuardianMutationResult> {
  const child = Bun.spawn([
    process.execPath,
    GUARDIAN_CHILD_PATH,
    systemPath,
    'authority-user',
    role,
  ], {
    cwd: process.cwd(),
    env: Bun.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`Guardian child failed with ${exitCode}: ${stderr}`);
  }
  const resultLine = stdout.split('\n')
    .find((line) => line.startsWith('{"status":'));
  if (!resultLine) {
    throw new Error(`Guardian child returned no result: ${stderr}`);
  }
  return JSON.parse(resultLine) as GuardianMutationResult;
}

async function databaseError(
  operation: Promise<unknown>,
): Promise<DatabaseError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
  throw new Error('Expected DatabaseError.');
}
