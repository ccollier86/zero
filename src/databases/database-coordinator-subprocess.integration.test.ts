import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DatabaseCoordinator,
  type DatabaseCoordinatorLease,
} from './database-coordinator';
import { DatabaseError } from './database-error';
import { SubprocessDatabaseExecutor } from './subprocess-database-executor';
import { databaseActorFixtureRealm } from './test-fixtures/database-actor-realm';

const CHILD_PATH = fileURLToPath(new URL(
  './test-fixtures/database-actor-child.ts',
  import.meta.url,
));
const CRASH_PARENT_PATH = fileURLToPath(new URL(
  './test-fixtures/database-coordinator-crash-parent.ts',
  import.meta.url,
));

describe('DatabaseCoordinator subprocess integration', () => {
  test('persists isolated CRUD, receipts, and replay through real actor generations', async () => {
    await withIntegrationResources(async (resources) => {
      const root = resources.createRoot();
      const first = resources.createCoordinator(root);
      const alpha = await resources.acquire(first, 'tenant-alpha');
      const beta = await resources.acquire(first, 'tenant-beta');

      const alphaWrite = await alpha.execute(createTodo('shared-id', 'Alpha'));
      const betaWrite = await beta.execute(createTodo('shared-id', 'Beta'));
      expect(alphaWrite).toMatchObject({
        idempotencyKey: 'create:shared-id:Alpha',
        replayed: false,
        sequence: { seq: 1 },
      });
      expect(betaWrite).toMatchObject({
        idempotencyKey: 'create:shared-id:Beta',
        replayed: false,
        sequence: { seq: 1 },
      });

      expect(await alpha.execute(readTodo('shared-id'))).toEqual({
        value: { id: 'shared-id', title: 'Alpha' },
        sequence: { seq: 1 },
      });
      expect(await beta.execute(readTodo('shared-id'))).toEqual({
        value: { id: 'shared-id', title: 'Beta' },
        sequence: { seq: 1 },
      });
      expect(await alpha.replay(0, 10)).toMatchObject({
        value: {
          afterSeq: 0,
          throughSeq: 1,
          nextAfterSeq: null,
          changes: [{ seq: 1, table: 'todos', rowId: 'shared-id' }],
        },
        sequence: { seq: 1 },
      });

      const replayed = await alpha.execute(createTodo('shared-id', 'Alpha'));
      expect(replayed).toMatchObject({
        idempotencyKey: 'create:shared-id:Alpha',
        replayed: true,
        sequence: { seq: 1 },
      });

      resources.release(alpha);
      resources.release(beta);
      await resources.closeCoordinator(first);

      const reopened = resources.createCoordinator(root);
      const alphaAgain = await resources.acquire(reopened, 'tenant-alpha');
      expect(await alphaAgain.execute(readTodo('shared-id'))).toEqual({
        value: { id: 'shared-id', title: 'Alpha' },
        sequence: { seq: 1 },
      });
    });
  }, 20_000);

  test('runs different-file writers together while a same-file reader sees committed WAL state', async () => {
    await withIntegrationResources(async (resources) => {
      const root = resources.createRoot();
      const barriers = resources.createRoot();
      const coordinator = resources.createCoordinator(root);
      const alpha = await resources.acquire(coordinator, 'tenant-alpha');
      const beta = await resources.acquire(coordinator, 'tenant-beta');

      const alphaEntered = join(barriers, 'alpha-entered');
      const betaEntered = join(barriers, 'beta-entered');
      const alphaRelease = resources.registerReleaseFile(
        join(barriers, 'alpha-release'),
      );
      const betaRelease = resources.registerReleaseFile(
        join(barriers, 'beta-release'),
      );

      await Promise.all([
        alpha.execute(createTodo('row', 'Alpha before')),
        beta.execute(createTodo('row', 'Beta before')),
      ]);

      const alphaWrite = resources.track(alpha.execute(blockingUpdate({
        title: 'Alpha after',
        enteredPath: alphaEntered,
        releasePath: alphaRelease,
      })));
      const betaWrite = resources.track(beta.execute(blockingUpdate({
        title: 'Beta after',
        enteredPath: betaEntered,
        releasePath: betaRelease,
      })));

      await Promise.all([
        waitForFile(alphaEntered),
        waitForFile(betaEntered),
      ]);

      // The reader is a distinct readonly actor. While Alpha's writer holds
      // an uncommitted WAL transaction, it must observe the prior commit.
      await expect(withDeadline(
        alpha.execute(readTodo('row')),
        1_500,
      )).resolves.toEqual({
        value: { id: 'row', title: 'Alpha before' },
        sequence: { seq: 1 },
      });

      resources.releaseFile(alphaRelease);
      resources.releaseFile(betaRelease);
      await Promise.all([alphaWrite, betaWrite]);

      expect(await alpha.execute(readTodo('row'))).toMatchObject({
        value: { id: 'row', title: 'Alpha after' },
      });
      expect(await beta.execute(readTodo('row'))).toMatchObject({
        value: { id: 'row', title: 'Beta after' },
      });
    });
  }, 20_000);

  test('settles actors and removes roots when acquisition fails during setup', async () => {
    let root!: string;
    let coordinator!: DatabaseCoordinator;

    await expect(withIntegrationResources(async (resources) => {
      root = resources.createRoot();
      coordinator = resources.createCoordinator(root);
      await resources.acquire(coordinator, 'tenant-alpha');
      await resources.acquire(coordinator, 'tenant-beta');

      // Both bounded slots carry a live lease, so no binding can be evicted
      // for this third acquisition. The resource scope must still settle the
      // two actor pairs before it removes the root.
      await resources.acquire(coordinator, 'tenant-gamma');
    })).rejects.toMatchObject({ code: 'DATABASE_BACKPRESSURE' });

    expect(existsSync(root)).toBe(false);
    expect(coordinator.diagnostics().state).toBe('closed');
  }, 20_000);

  test('fences an orphan writer after parent crash until its transaction settles', async () => {
    const root = realpathSync.native(
      mkdtempSync(join(tmpdir(), 'zero-database-crash-fence-')),
    );
    const barriers = realpathSync.native(
      mkdtempSync(join(tmpdir(), 'zero-database-crash-barrier-')),
    );
    const enteredPath = join(barriers, 'entered');
    const releasePath = join(barriers, 'release');
    const crashedParent = Bun.spawn({
      cmd: [process.execPath, CRASH_PARENT_PATH, root, enteredPath, releasePath],
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    });
    let replacement: DatabaseCoordinator | null = null;
    try {
      await waitForFile(enteredPath);
      crashedParent.kill('SIGKILL');
      await crashedParent.exited;

      replacement = createCoordinator(root);
      const conflict = captureSynchronousDatabaseError(() => replacement!.start());
      expect(conflict).toMatchObject({
        code: 'DATABASE_CONFLICT',
        retryable: true,
        outcome: 'not-started',
        details: {},
      });
      expect(`${conflict.message}\n${JSON.stringify(conflict)}`).not.toContain(root);
      expect(`${conflict.message}\n${JSON.stringify(conflict)}`)
        .not.toContain('tenant-crash-fence');

      writeFileSync(releasePath, 'release', { flag: 'wx' });
      await startAfterOrphanSettlement(replacement);
      const lease = await replacement.acquire('tenant-crash-fence');
      try {
        expect(await lease.execute(readTodo('row'))).toEqual({
          value: { id: 'row', title: 'Committed by orphan' },
          sequence: { seq: 2 },
        });
      } finally {
        lease.release();
      }
    } finally {
      if (!existsSync(releasePath)) {
        writeFileSync(releasePath, 'release', { flag: 'wx' });
      }
      crashedParent.kill('SIGKILL');
      await crashedParent.exited.catch(() => undefined);
      await replacement?.close().catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
      rmSync(barriers, { recursive: true, force: true });
    }
  }, 20_000);
});

function createCoordinator(rootDirectory: string): DatabaseCoordinator {
  return new DatabaseCoordinator({
    rootDirectory,
    realm: databaseActorFixtureRealm,
    maxDatabases: 2,
    operationTimeoutMs: 12_000,
    sweepIntervalMs: false,
    createExecutor: ({ role, slot }) => new SubprocessDatabaseExecutor({
      command: [process.execPath, CHILD_PATH, role, String(slot)],
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
}

function createTodo(id: string, title: string) {
  return {
    type: 'mutate' as const,
    idempotencyKey: `create:${id}:${title.replaceAll(' ', '-')}`,
    mutation: {
      type: 'create' as const,
      table: 'todos',
      row: { id, title },
    },
  };
}

function readTodo(id: string) {
  return {
    type: 'get' as const,
    table: 'todos',
    id,
    consistency: { mode: 'snapshot' as const },
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

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error('Actor did not enter test barrier.');
    await Bun.sleep(5);
  }
}

async function startAfterOrphanSettlement(
  coordinator: DatabaseCoordinator,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      coordinator.start();
      return;
    } catch (error) {
      if (!(error instanceof DatabaseError)
        || error.code !== 'DATABASE_CONFLICT'
        || Date.now() >= deadline) {
        throw error;
      }
      await Bun.sleep(10);
    }
  }
}

function captureSynchronousDatabaseError(operation: () => unknown): DatabaseError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
  throw new Error('Expected a DatabaseError.');
}

class IntegrationResources {
  readonly #roots = new Set<string>();
  readonly #coordinators = new Set<DatabaseCoordinator>();
  readonly #leases = new Map<DatabaseCoordinatorLease, DatabaseCoordinator>();
  readonly #releaseFiles = new Set<string>();
  readonly #pendingOperations = new Set<Promise<unknown>>();
  #closeTask: Promise<void> | null = null;
  #closed = false;

  createRoot(): string {
    this.assertOpen();
    const root = realpathSync.native(
      mkdtempSync(join(tmpdir(), 'zero-database-coordinator-process-')),
    );
    this.#roots.add(root);
    return root;
  }

  createCoordinator(rootDirectory: string): DatabaseCoordinator {
    this.assertOpen();
    const coordinator = createCoordinator(rootDirectory);
    this.#coordinators.add(coordinator);
    coordinator.start();
    return coordinator;
  }

  async acquire(
    coordinator: DatabaseCoordinator,
    databaseId: string,
  ): Promise<DatabaseCoordinatorLease> {
    this.assertOpen();
    const lease = await coordinator.acquire(databaseId);
    this.#leases.set(lease, coordinator);
    return lease;
  }

  release(lease: DatabaseCoordinatorLease): void {
    lease.release();
    this.#leases.delete(lease);
  }

  registerReleaseFile(path: string): string {
    this.assertOpen();
    this.#releaseFiles.add(path);
    return path;
  }

  releaseFile(path: string): void {
    ensureFile(path);
    this.#releaseFiles.delete(path);
  }

  track<T>(operation: Promise<T>): Promise<T> {
    this.assertOpen();
    this.#pendingOperations.add(operation);
    // Cleanup also awaits the original promise, but observing a possible
    // rejection immediately avoids a process-global unhandled-rejection race
    // if the test body fails before reaching its own await.
    void operation.catch(() => undefined);
    return operation;
  }

  async closeCoordinator(coordinator: DatabaseCoordinator): Promise<void> {
    for (const [lease, owner] of this.#leases) {
      if (owner === coordinator) this.release(lease);
    }

    let failure: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await coordinator.close();
      } catch (error) {
        failure = error;
      }
      if (coordinator.diagnostics().state === 'closed') {
        this.#coordinators.delete(coordinator);
        return;
      }
    }
    throw failure ?? new Error('Integration-test database coordinator did not close.');
  }

  close(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    if (this.#closeTask) return this.#closeTask;
    const task = this.closeOnce();
    this.#closeTask = task;
    void task.finally(() => {
      if (this.#closeTask === task) this.#closeTask = null;
    }).catch(() => undefined);
    return task;
  }

  private async closeOnce(): Promise<void> {
    const failures: unknown[] = [];
    for (const path of this.#releaseFiles) {
      try {
        ensureFile(path);
      } catch (error) {
        failures.push(error);
      }
    }
    this.#releaseFiles.clear();

    await Promise.allSettled(this.#pendingOperations);
    this.#pendingOperations.clear();

    for (const lease of [...this.#leases.keys()]) {
      try {
        this.release(lease);
      } catch (error) {
        failures.push(error);
      }
    }

    for (const coordinator of [...this.#coordinators]) {
      try {
        await this.closeCoordinator(coordinator);
      } catch (error) {
        failures.push(error);
      }
    }

    if (this.#coordinators.size > 0) {
      throw new AggregateError(
        failures,
        'Integration-test actors did not settle; temporary database roots were retained.',
      );
    }

    for (const root of this.#roots) {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch (error) {
        failures.push(error);
      }
    }
    this.#roots.clear();
    this.#closed = true;

    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        'Integration-test resources did not clean up completely.',
      );
    }
  }

  private assertOpen(): void {
    if (this.#closed || this.#closeTask) {
      throw new Error('Integration-test resources are already closing.');
    }
  }
}

async function withIntegrationResources(
  run: (resources: IntegrationResources) => Promise<void>,
): Promise<void> {
  const resources = new IntegrationResources();
  let runFailure: unknown = null;
  try {
    await run(resources);
  } catch (error) {
    runFailure = error;
  }

  try {
    await resources.close();
  } catch (cleanupFailure) {
    if (runFailure !== null) {
      throw new AggregateError(
        [runFailure, cleanupFailure],
        'Integration test and its resource cleanup both failed.',
      );
    }
    throw cleanupFailure;
  }

  if (runFailure !== null) throw runFailure;
}

function ensureFile(path: string): void {
  try {
    writeFileSync(path, 'release', { flag: 'wx' });
  } catch (error) {
    if (!hasErrorCode(error, 'EEXIST')) throw error;
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === code;
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promise,
    Bun.sleep(timeoutMs).then(() => {
      throw new Error('Operation did not complete before its integration-test deadline.');
    }),
  ]);
}
