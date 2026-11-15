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
import { currentLoggingAttribution, runWithLoggingAttribution } from '../logging/logging-attribution';
import { loggingContext } from '../logging/test-support/logging-fixture';
import { ownedWorkerFixture } from '../workers/test-support/owned-fixture';

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
import { installDatabaseLoggingBinding, prepareDatabaseLoggingBinding } from './database-logging-binding';
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

  test('pre-dispatch audit/configuration failures release shared authority without retiring a healthy real actor', async () => {
    const owned = await ownedWorkerFixture('database-audit-admission'), authority = new AuthorityCommitCoordinator(), auditOwner = {};
    let system: ReturnType<typeof createReactiveDB> | null = null, coordinator: DatabaseCoordinator | null = null;
    let lease: DatabaseCoordinatorLease | null = null, removeLogging: (() => void) | undefined, throwingContext = true;
    let throwingClock = false, armDiagnosticClock = false, throwingDiagnosticClock = false;
    try {
      const systemPath = join(owned.root, 'system.sqlite'), fabricRoot = join(owned.root, 'fabric'); mkdirSync(fabricRoot);
      system = createReactiveDB({ mode: 'file', path: systemPath }); defineAuthTables(system); installAuthAuthorityRevision(system);
      coordinator = new DatabaseCoordinator({ rootDirectory: fabricRoot, realm: databaseActorFixtureRealm, readers: false,
        maxDatabases: 1, sweepIntervalMs: false, authorityCommitCoordinator: authority, requireCommitAuthority: true,
        now() {
          if (throwingDiagnosticClock || throwingClock && authority.diagnostics().activeShared > 0) {
            throwingDiagnosticClock = false; throwingClock = false; throw new Error('PRIVATE_CLOCK_FAILURE');
          }
          return Date.now();
        },
        actorAuthorityContext: new DatabaseActorAuthorityContext(system, systemPath),
        createExecutor: ({ role, slot }) => new SubprocessDatabaseExecutor({
          command: [process.execPath, '--no-env-file', ACTOR_CHILD_PATH, role, String(slot)], env: {}, role, slot, maxInFlight: 1,
          startupTimeoutMs: 5_000, operationTimeoutMs: 5_000, shutdownAckTimeoutMs: 2_000, shutdownExitTimeoutMs: 2_000,
          sigtermTimeoutMs: 1_000, sigkillTimeoutMs: 1_000,
        }) });
      removeLogging = installDatabaseLoggingBinding(coordinator, { records: false, workflow: false, policyVersion: 'synthetic-audit-policy',
        sourceQueue: { maxEvents: 100, maxBytes: 16_384 }, context() {
          if (throwingContext) throw new Error('PRIVATE_AUDIT_CONTEXT_FAILURE');
          if (armDiagnosticClock) { armDiagnosticClock = false; throwingDiagnosticClock = true; }
          return currentLoggingAttribution(auditOwner);
        } });
      prepareDatabaseLoggingBinding(coordinator, 'audit-admission', { kind: 'application', tenantId: null });
      coordinator.start(); lease = await acquireAuthorized(coordinator, authority, 'audit-admission');
      const writerGeneration = coordinator.diagnostics().databases[0]!.writerGeneration;
      const rejectedCommands = [createTodo('throwing-context', 'Synthetic audit rejection'), createTodo('retired-context', 'Synthetic retired rejection')];
      const failures: DatabaseError[] = [await databaseError(lease.execute(rejectedCommands[0]!))];
      throwingContext = false;
      let release!: () => void, retiredWrite!: Promise<unknown>;
      const held = new Promise<void>(done => { release = done; });
      await runWithLoggingAttribution(auditOwner, loggingContext(null), () => {}, () => {
        retiredWrite = held.then(() => lease!.execute(rejectedCommands[1]!));
        void retiredWrite.catch(() => {});
      });
      release(); failures.push(await databaseError(retiredWrite));
      for (const failure of failures) {
        expect(failure).toMatchObject({ code: 'DATABASE_AUTHORITY_CHANGED', retryable: false, outcome: 'not-started' });
        expect(String(failure)).not.toContain('PRIVATE_');
        expect(String(failure)).not.toContain('Logging attribution lifetime');
      }
      const clockCommand = createTodo('throwing-clock', 'Synthetic clock rejection'); rejectedCommands.push(clockCommand);
      throwingClock = true;
      const clockFailure = await databaseError(lease.execute(clockCommand));
      expect(throwingClock).toBe(false);
      const timeoutCommand = createTodo('throwing-timeout', 'Synthetic timeout rejection'); rejectedCommands.push(timeoutCommand);
      let timeoutReads = 0;
      const timeoutOptions = Object.defineProperty({}, 'operationTimeoutMs', { get() { timeoutReads++; throw new Error('PRIVATE_TIMEOUT_FAILURE'); } });
      const timeoutFailure = await databaseError(lease.execute(timeoutCommand, timeoutOptions));
      expect(timeoutReads).toBe(1);
      const invalidCommand = createTodo('invalid-timeout', 'Synthetic invalid timeout'); rejectedCommands.push(invalidCommand);
      const invalidFailure = await databaseError(lease.execute(invalidCommand, { operationTimeoutMs: 0 }));
      for (const failure of [clockFailure, timeoutFailure, invalidFailure]) {
        expect(failure).toMatchObject({ code: 'DATABASE_CONFIG_INVALID', retryable: false, outcome: 'not-started' });
        expect(String(failure)).not.toContain('PRIVATE_');
      }
      expect(coordinator.diagnostics().heldAuthorityLeases).toBe(0);
      expect(authority.diagnostics()).toMatchObject({ activeShared: 0, activeExclusive: false, pendingExclusive: 0 });
      // The failed call must not reserve Guardian's exclusive side until actor
      // shutdown, nor consume a business write/receipt before actual dispatch.
      const exclusive = await authority.acquireExclusive({ timeoutMs: 1_000 }); exclusive.release();
      for (const command of rejectedCommands) expect(await title(lease, command.mutation.row.id)).toBeUndefined();
      for (const command of rejectedCommands) await expect(lease.execute(command)).resolves.toMatchObject({ replayed: false });
      // Here a real actor receives and rejects a duplicate primary key. A clock
      // throwing only in error diagnostics must not rewrite that known outcome
      // as unknown, leak authority, or unnecessarily retire the healthy actor.
      armDiagnosticClock = true;
      const conflict = await databaseError(lease.execute({ ...rejectedCommands[0]!, idempotencyKey: 'synthetic-diagnostic-conflict' }));
      expect(throwingDiagnosticClock).toBe(false);
      expect(conflict).toMatchObject({ code: 'DATABASE_CONFLICT', outcome: 'not-committed' });
      expect(String(conflict)).not.toContain('PRIVATE_');
      expect(coordinator.diagnostics().databases[0]!.writerGeneration).toBe(writerGeneration);
      expect(coordinator.diagnostics().heldAuthorityLeases).toBe(0);
      expect(authority.diagnostics().activeShared).toBe(0);
    } finally {
      lease?.release();
      const failures: unknown[] = [];
      try { await coordinator?.close(); } catch (error) { failures.push(error); }
      removeLogging?.();
      if (!failures.length) {
        try { await authority.close(); } catch (error) { failures.push(error); }
        try { system?.dispose(); } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, 'Synthetic audit-admission fixture retirement unconfirmed; preserving ' + owned.root);
      await owned.cleanup();
    }
  }, 30_000);

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
