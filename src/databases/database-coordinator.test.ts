import { afterEach, describe, expect, test } from 'bun:test';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEventStore } from '../observability/memory-event-store';
import { MAX_RUNTIME_TIMER_INTERVAL_MS } from '../runtime/timer-limits';
import {
  DATABASE_ACTOR_OPERATIONS,
  type DatabaseActorPlacementConfig,
} from './database-actor-protocol';
import { AuthorityCommitCoordinator } from './authority-commit-coordinator';
import { createDatabaseCommitAuthority } from './database-commit-authority';
import {
  DatabaseCoordinator,
  type DatabaseCoordinatorRestartPolicy,
  type DatabaseExecutorFactoryContext,
} from './database-coordinator';
import { DatabaseError } from './database-error';
import { DATABASE_COORDINATOR_MAX_DATABASES } from './database-capacity';
import {
  createDatabaseObservability,
  type DatabaseObservability,
} from './database-observability';
import type {
  DatabaseExecutor,
  DatabaseExecutorDiagnostics,
  DatabaseExecutorEventListener,
  DatabaseExecutorExecuteOptions,
  DatabaseExecutorRequest,
  DatabaseExecutorValue,
  DatabaseExecutorState,
} from './database-executor';
import { createDatabaseRef, resolveDatabaseFile } from './database-file';
import type { DatabasePlacementPolicy } from './database-placement';
import { defineDatabaseRealm } from './database-realm';
import type { DatabaseTenantSyncBinding } from './database-tenant-sync';

const realm = defineDatabaseRealm({
  name: 'coordinator-tests',
  version: '1',
  tables: {
    todos: {
      id: 'text primary key',
      title: 'text not null',
    },
  },
});

describe('DatabaseCoordinator', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('serializes one file writer FIFO while different files write concurrently', async () => {
    const harness = createHarness(roots, { maxDatabases: 2 });
    const firstAStarted = deferred<void>();
    const firstBStarted = deferred<void>();
    const releaseA = deferred<void>();
    const releaseB = deferred<void>();
    const starts: string[] = [];
    harness.onOperation = async ({ role, databaseRef, operation }) => {
      if (role !== 'writer' || operation.type !== 'mutate') return;
      const id = operation.mutation.type === 'create'
        ? String(operation.mutation.row.id)
        : 'unknown';
      starts.push(id);
      if (id === 'a-1') {
        firstAStarted.resolve();
        await releaseA.promise;
      }
      if (id === 'b-1') {
        firstBStarted.resolve();
        await releaseB.promise;
      }
      expect(databaseRef).toBeString();
    };

    const a = await harness.coordinator.acquire('tenant-a');
    const b = await harness.coordinator.acquire('tenant-b');
    const a1 = a.execute(createTodo('a-1'));
    const a2 = a.execute(createTodo('a-2'));
    const b1 = b.execute(createTodo('b-1'));

    await Promise.all([firstAStarted.promise, firstBStarted.promise]);
    expect(starts).toEqual(['a-1', 'b-1']);
    releaseA.resolve();
    await a1;
    await waitUntil(() => starts.includes('a-2'));
    expect(starts).toEqual(['a-1', 'b-1', 'a-2']);
    releaseB.resolve();
    await Promise.all([a2, b1]);

    a.release();
    b.release();
    await harness.coordinator.close();
  });

  test('overlaps a same-file readonly actor with its writer and queues strong reads', async () => {
    const harness = createHarness(roots);
    const writerStarted = deferred<void>();
    const releaseWriter = deferred<void>();
    const roles: string[] = [];
    harness.onOperation = async ({ role, operation }) => {
      roles.push(`${role}:${operation.type}`);
      if (role === 'writer' && operation.type === 'mutate') {
        writerStarted.resolve();
        await releaseWriter.promise;
      }
    };
    const lease = await harness.coordinator.acquire('tenant-a');
    const write = lease.execute(createTodo('one'));
    await writerStarted.promise;

    const snapshot = await lease.execute({
      type: 'get', table: 'todos', id: 'one', consistency: { mode: 'snapshot' },
    });
    expect(snapshot.value).toEqual({ actor: 'reader' });

    const strong = lease.execute({
      type: 'get', table: 'todos', id: 'one', consistency: { mode: 'strong' },
    });
    await Promise.resolve();
    expect(roles).toEqual(['writer:mutate', 'reader:get']);
    releaseWriter.resolve();
    await Promise.all([write, strong]);
    expect(roles).toEqual(['writer:mutate', 'reader:get', 'writer:get']);

    lease.release();
    await harness.coordinator.close();
  });

  test('routes snapshot finds to the reader and strong finds through writer FIFO', async () => {
    const harness = createHarness(roots);
    const roles: string[] = [];
    harness.onOperation = ({ role, operation }) => {
      if (operation.type === 'find') roles.push(role);
    };
    const lease = await harness.coordinator.acquire('tenant-a');

    await expect(lease.execute({
      type: 'find', table: 'todos', select: ['id'], limit: 1,
      consistency: { mode: 'snapshot' },
    })).resolves.toMatchObject({ value: [{ id: 'reader' }] });
    await expect(lease.execute({
      type: 'find', table: 'todos', select: ['id'], limit: 1,
      consistency: { mode: 'strong' },
    })).resolves.toMatchObject({ value: [{ id: 'writer' }] });
    expect(roles).toEqual(['reader', 'writer']);

    lease.release();
    await harness.coordinator.close();
  });

  test('acquires and revalidates commit authority only at the writer FIFO head', async () => {
    const authorityGate = new AuthorityCommitCoordinator();
    const harness = createHarness(roots, {
      authorityCommitCoordinator: authorityGate,
      requireCommitAuthority: true,
    });
    let checks = 0;
    const authority = createDatabaseCommitAuthority(
      authorityGate,
      'tenant-a',
      () => {
        checks += 1;
        return undefined;
      },
    );
    const firstStarted = deferred<void>();
    const releaseFirst = deferred<void>();
    harness.onOperation = async ({ role, operation }) => {
      if (role === 'writer' && operation.type === 'mutate'
        && operation.idempotencyKey === 'write:one') {
        firstStarted.resolve();
        await releaseFirst.promise;
      }
    };
    const lease = await harness.coordinator.acquire('tenant-a', {
      commitAuthority: authority,
    });
    const first = lease.execute(createTodo('one'));
    await firstStarted.promise;
    const second = lease.execute(createTodo('two'));
    await Promise.resolve();
    expect(checks).toBe(1);
    expect(authorityGate.diagnostics().activeShared).toBe(1);

    releaseFirst.resolve();
    await Promise.all([first, second]);
    expect(checks).toBe(2);
    expect(authorityGate.diagnostics().activeShared).toBe(0);
    lease.release();
    await harness.coordinator.close();
    await authorityGate.close();
  });

  test('blocks tenant dispatch behind an exclusive control-plane authority mutation', async () => {
    const authorityGate = new AuthorityCommitCoordinator();
    const harness = createHarness(roots, {
      authorityCommitCoordinator: authorityGate,
      requireCommitAuthority: true,
    });
    let checked = false;
    let dispatched = false;
    const authority = createDatabaseCommitAuthority(
      authorityGate,
      'tenant-a',
      () => {
        checked = true;
        return undefined;
      },
    );
    harness.onOperation = ({ role, operation }) => {
      if (role === 'writer' && operation.type === 'mutate') dispatched = true;
    };
    const lease = await harness.coordinator.acquire('tenant-a', {
      commitAuthority: authority,
    });
    const exclusive = await authorityGate.acquireExclusive();
    const write = lease.execute(createTodo('one'));
    await Promise.resolve();
    await Promise.resolve();
    expect(checked).toBe(false);
    expect(dispatched).toBe(false);

    exclusive.release();
    await write;
    expect(checked).toBe(true);
    expect(dispatched).toBe(true);
    lease.release();
    await harness.coordinator.close();
    await authorityGate.close();
  });

  test('resolves the current writer after waiting on the authority gate', async () => {
    const authorityGate = new AuthorityCommitCoordinator();
    const harness = createHarness(roots, {
      authorityCommitCoordinator: authorityGate,
      requireCommitAuthority: true,
    });
    let failReaderOnce = true;
    harness.onOperation = ({ role, operation }) => {
      if (failReaderOnce && role === 'reader' && operation.type === 'get') {
        failReaderOnce = false;
        throw new DatabaseError(
          'DATABASE_EXECUTOR_FAILED',
          'Reader exited.',
          { retryable: false, outcome: null },
        );
      }
    };
    const lease = await harness.coordinator.acquire('tenant-a', {
      commitAuthority: createDatabaseCommitAuthority(
        authorityGate,
        'tenant-a',
        () => undefined,
      ),
    });
    const originalWriter = harness.coordinator
      .diagnostics().databases[0]!.writerGeneration;
    const exclusive = await authorityGate.acquireExclusive();
    const write = lease.execute(createTodo('after-recovery'));
    await Promise.resolve();

    await expect(captureCode(() => lease.execute({
      type: 'get', table: 'todos', id: 'retire-binding',
      consistency: { mode: 'snapshot' },
    }))).resolves.toBe('DATABASE_EXECUTOR_FAILED');
    await waitUntil(() => {
      const current = harness.coordinator.diagnostics().databases[0];
      return current?.state === 'ready'
        && current.writerGeneration !== originalWriter;
    });

    exclusive.release();
    await expect(write).resolves.toMatchObject({
      idempotencyKey: 'write:after-recovery',
    });
    lease.release();
    await harness.coordinator.close();
    await authorityGate.close();
  });

  test('fails closed when live authority changes before actor dispatch', async () => {
    const authorityGate = new AuthorityCommitCoordinator();
    const harness = createHarness(roots, {
      authorityCommitCoordinator: authorityGate,
      requireCommitAuthority: true,
    });
    let dispatched = false;
    const authority = createDatabaseCommitAuthority(authorityGate, 'tenant-a', () => {
      throw new Error('membership was revoked with secret context');
    });
    harness.onOperation = () => { dispatched = true; };
    const lease = await harness.coordinator.acquire('tenant-a', {
      commitAuthority: authority,
    });
    const error = await captureDatabaseError(
      () => lease.execute(createTodo('one')),
    );
    expect(error.code).toBe('DATABASE_AUTHORITY_CHANGED');
    expect(error.outcome).toBe('not-started');
    expect(error.message).not.toContain('secret');
    expect(dispatched).toBe(false);
    expect(authorityGate.diagnostics().activeShared).toBe(0);

    lease.release();
    await harness.coordinator.close();
    await authorityGate.close();
  });

  test('holds commit authority after an unknown response until exact actor settlement', async () => {
    const authorityGate = new AuthorityCommitCoordinator();
    const harness = createHarness(roots, {
      authorityCommitCoordinator: authorityGate,
      requireCommitAuthority: true,
    });
    const generationMaySettle = deferred<void>();
    harness.deferNextWriterSettlement = generationMaySettle.promise;
    harness.onOperation = ({ role, operation }) => {
      if (role === 'writer' && operation.type === 'mutate') {
        throw new DatabaseError(
          'DATABASE_OPERATION_TIMEOUT',
          'Actor timed out.',
          { retryable: false, outcome: 'unknown' },
        );
      }
    };
    const lease = await harness.coordinator.acquire('tenant-a', {
      commitAuthority: createDatabaseCommitAuthority(
        authorityGate,
        'tenant-a',
        () => undefined,
      ),
    });
    await expect(captureCode(
      () => lease.execute(createTodo('uncertain')),
    )).resolves.toBe('DATABASE_OPERATION_TIMEOUT');
    expect(authorityGate.diagnostics().activeShared).toBe(1);
    expect(harness.coordinator.diagnostics().heldAuthorityLeases).toBe(1);

    let exclusiveGranted = false;
    const exclusivePromise = authorityGate.acquireExclusive().then((value) => {
      exclusiveGranted = true;
      return value;
    });
    await Promise.resolve();
    expect(exclusiveGranted).toBe(false);
    generationMaySettle.resolve();
    const exclusive = await exclusivePromise;
    expect(harness.coordinator.diagnostics().heldAuthorityLeases).toBe(0);
    exclusive.release();

    lease.release();
    await harness.coordinator.close();
    await authorityGate.close();
  });

  test('keeps an actor generation after an exact expired-receipt outcome', async () => {
    const authorityGate = new AuthorityCommitCoordinator();
    const harness = createHarness(roots, {
      authorityCommitCoordinator: authorityGate,
      requireCommitAuthority: true,
    });
    harness.onOperation = ({ role, operation }) => {
      if (role === 'writer' && operation.type === 'mutate') {
        throw new DatabaseError(
          'DATABASE_OUTCOME_UNKNOWN',
          'Private receipt identity must not cross the coordinator boundary.',
          {
            retryable: false,
            outcome: 'unknown',
            details: { receiptState: 'expired' },
          },
        );
      }
    };
    const lease = await harness.coordinator.acquire('tenant-a', {
      commitAuthority: createDatabaseCommitAuthority(
        authorityGate,
        'tenant-a',
        () => undefined,
      ),
    });
    const originalGeneration = harness.coordinator
      .diagnostics().databases[0]!.writerGeneration;
    const error = await captureDatabaseError(
      () => lease.execute(createTodo('expired-receipt')),
    );
    expect(error).toMatchObject({
      code: 'DATABASE_OUTCOME_UNKNOWN',
      outcome: 'unknown',
      retryable: false,
      details: { receiptState: 'expired' },
    });
    expect(error.message).not.toContain('Private receipt identity');
    expect(error.details.retryWithSameKeyOnly).toBeUndefined();
    expect(harness.coordinator.diagnostics().databases[0]!.writerGeneration)
      .toBe(originalGeneration);
    expect(authorityGate.diagnostics().activeShared).toBe(0);
    expect(harness.coordinator.diagnostics().heldAuthorityLeases).toBe(0);

    const exclusive = await authorityGate.acquireExclusive();
    exclusive.release();

    harness.onOperation = undefined;
    await expect(lease.execute(createTodo('later'))).resolves.toMatchObject({
      replayed: false,
    });
    expect(harness.coordinator.diagnostics().databases[0]!.writerGeneration)
      .toBe(originalGeneration);

    lease.release();
    await harness.coordinator.close();
    await authorityGate.close();
  });

  test('relays aggregate receipt compaction without changing the write result', async () => {
    const store = new MemoryEventStore();
    const harness = createHarness(roots, {
      observability: createDatabaseObservability({
        sink: store,
        store,
        config: { console: false, store },
      }),
    });
    harness.receiptCompactionOnce = {
      totalKeys: 10_001,
      retainedResults: 10_000,
      expiredTombstones: 1,
      retainedResultBytes: 20_260,
      keyLimit: 1_000_000,
      prunedCount: 1,
      prunedResultBytes: 2,
      retainedLimit: 10_000,
      retainedByteLimit: 67_108_864,
      resultByteLimit: 8_388_608,
    };
    const lease = await harness.coordinator.acquire('tenant-a');

    const result = await lease.execute(createTodo('compaction'));

    expect(result).toMatchObject({
      idempotencyKey: 'write:compaction',
      replayed: false,
    });
    expect(result).not.toHaveProperty('receiptCompaction');
    const event = store.query({ code: 'database.receipt.compacted' }).events[0];
    expect(event?.metadata).toMatchObject({
      totalKeys: 10_001,
      retainedResults: 10_000,
      expiredTombstones: 1,
      retainedResultBytes: 20_260,
      keyLimit: 1_000_000,
      prunedCount: 1,
      prunedResultBytes: 2,
      retainedLimit: 10_000,
      retainedByteLimit: 67_108_864,
      resultByteLimit: 8_388_608,
    });
    expect(JSON.stringify(event)).not.toContain('tenant-a');

    lease.release();
    await harness.coordinator.close();
  });

  test('reports permanent receipt capacity distinctly from transient queues', async () => {
    const store = new MemoryEventStore();
    const harness = createHarness(roots, {
      observability: createDatabaseObservability({
        sink: store,
        store,
        config: { console: false, store },
      }),
    });
    const lease = await harness.coordinator.acquire('tenant-receipt-capacity');
    harness.onOperation = () => {
      throw new DatabaseError(
        'DATABASE_CAPACITY_EXHAUSTED',
        'private receipt key detail',
        {
          details: {
            capacityType: 'receipts',
            capacityLimit: 1_000_000,
            receiptKey: 'private-key',
          },
        },
      );
    };

    const error = await captureDatabaseError(
      () => lease.execute(createTodo('must-not-commit')),
    );
    expect(error).toMatchObject({
      code: 'DATABASE_CAPACITY_EXHAUSTED',
      retryable: false,
      outcome: 'not-started',
      details: { capacityType: 'receipts', capacityLimit: 1_000_000 },
    });
    expect(error.details).not.toHaveProperty('receiptKey');
    const events = store.query({ code: 'database.capacity.exhausted' }).events;
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toMatchObject({
      capacityType: 'receipts',
      capacityLimit: 1_000_000,
    });
    expect(store.query({ code: 'database.operation.failed' }).count).toBe(0);
    expect(JSON.stringify(events)).not.toContain('private');

    lease.release();
    await harness.coordinator.close();
  });

  test('requires a genuine commit-authority context when configured', async () => {
    const authorityGate = new AuthorityCommitCoordinator();
    const otherAuthorityGate = new AuthorityCommitCoordinator();
    const harness = createHarness(roots, {
      authorityCommitCoordinator: authorityGate,
      requireCommitAuthority: true,
    });
    await expect(captureCode(
      () => harness.coordinator.acquire('tenant-a'),
    )).resolves.toBe('DATABASE_AUTHORITY_CHANGED');
    await expect(captureCode(() => harness.coordinator.acquire('tenant-a', {
      commitAuthority: {} as never,
    }))).resolves.toBe('DATABASE_AUTHORITY_CHANGED');
    await expect(captureCode(() => harness.coordinator.acquire('tenant-a', {
      commitAuthority: createDatabaseCommitAuthority(
        authorityGate,
        'tenant-b',
        () => undefined,
      ),
    }))).resolves.toBe('DATABASE_AUTHORITY_CHANGED');
    await expect(captureCode(() => harness.coordinator.acquire('tenant-a', {
      commitAuthority: createDatabaseCommitAuthority(
        otherAuthorityGate,
        'tenant-a',
        () => undefined,
      ),
    }))).resolves.toBe('DATABASE_AUTHORITY_CHANGED');
    expect(harness.executors).toHaveLength(0);

    await harness.coordinator.close();
    await authorityGate.close();
    await otherAuthorityGate.close();
  });

  test('falls back to the writer when a reader snapshot is behind a required sequence', async () => {
    const harness = createHarness(roots);
    const roles: string[] = [];
    harness.onOperation = ({ role, operation }) => {
      if (operation.type !== 'get') return;
      roles.push(role);
      if (role === 'reader') {
        throw new DatabaseError(
          'DATABASE_TRANSACTION_STALE',
          'Reader is behind.',
          { retryable: true, outcome: 'not-started' },
        );
      }
    };
    const lease = await harness.coordinator.acquire('tenant-a');
    const result = await lease.execute({
      type: 'get',
      table: 'todos',
      id: 'one',
      consistency: { mode: 'read-your-writes', minSeq: { seq: 2 } },
    });
    expect(result.value).toEqual({ actor: 'writer' });
    expect(roles).toEqual(['reader', 'writer']);

    lease.release();
    await harness.coordinator.close();
  });

  test('does not wedge the writer lane when a stale fallback loses its binding', async () => {
    const harness = createHarness(roots);
    const staleStarted = deferred<void>();
    const releaseStale = deferred<void>();
    const oldWriterMaySettle = deferred<void>();
    harness.deferNextWriterSettlement = oldWriterMaySettle.promise;
    harness.onOperation = async ({ role, operation }) => {
      if (role !== 'reader' || operation.type !== 'get') return;
      if (operation.id === 'stale') {
        staleStarted.resolve();
        await releaseStale.promise;
        throw new DatabaseError(
          'DATABASE_TRANSACTION_STALE',
          'Reader is behind.',
          { retryable: true, outcome: 'not-started' },
        );
      }
      if (operation.id === 'terminal') {
        throw new DatabaseError(
          'DATABASE_EXECUTOR_FAILED',
          'Reader exited.',
          { retryable: false, outcome: null },
        );
      }
    };
    const lease = await harness.coordinator.acquire('tenant-a');
    const stale = lease.execute({
      type: 'get', table: 'todos', id: 'stale',
      consistency: { mode: 'read-your-writes', minSeq: { seq: 0 } },
    });
    await staleStarted.promise;
    await expect(captureCode(() => lease.execute({
      type: 'get', table: 'todos', id: 'terminal',
      consistency: { mode: 'snapshot' },
    }))).resolves.toBe('DATABASE_EXECUTOR_FAILED');
    expect(harness.coordinator.diagnostics().quarantinedSlots).toBe(1);

    releaseStale.resolve();
    await expect(captureCode(() => stale)).resolves.toBe('DATABASE_NOT_READY');
    expect(harness.coordinator.diagnostics().queuedOperations).toBe(0);
    expect(harness.coordinator.diagnostics().databases[0]).toMatchObject({
      activeOperations: 0,
      queueDepth: 0,
    });

    oldWriterMaySettle.resolve();
    await waitUntil(() => (
      harness.coordinator.diagnostics().databases[0]?.state === 'ready'
    ));
    lease.release();
    await harness.coordinator.close();
  });

  test('uses released idle capacity without exposing logical IDs or paths', async () => {
    const harness = createHarness(roots, { maxDatabases: 1 });
    const first = await harness.coordinator.acquire('private-tenant-name');
    const firstRef = first.databaseRef;
    expect(Reflect.ownKeys(first)).toEqual([]);
    expect(JSON.stringify(first)).not.toContain('private-tenant-name');
    expect(JSON.stringify(first)).not.toContain(harness.root);
    await expect(captureCode(
      () => harness.coordinator.acquire('tenant-b'),
    )).resolves.toBe('DATABASE_BACKPRESSURE');
    first.release();

    const second = await harness.coordinator.acquire('tenant-b');
    expect(second.databaseRef).not.toBe(firstRef);
    const diagnostics = harness.coordinator.diagnostics();
    const encoded = JSON.stringify(diagnostics);
    expect(encoded).not.toContain('private-tenant-name');
    expect(encoded).not.toContain(harness.root);
    expect(diagnostics.openDatabases).toBe(1);

    second.release();
    await harness.coordinator.close();
  });

  test('honors abort and queue bounds only before writer dispatch', async () => {
    const harness = createHarness(roots, { maxQueuedPerDatabase: 1 });
    const started = deferred<void>();
    const release = deferred<void>();
    harness.onOperation = async ({ role, operation }) => {
      if (role === 'writer' && operation.type === 'mutate'
        && operation.idempotencyKey === 'write:one') {
        started.resolve();
        await release.promise;
      }
    };
    const lease = await harness.coordinator.acquire('tenant-a');
    const one = lease.execute(createTodo('one'));
    await started.promise;
    const controller = new AbortController();
    const two = lease.execute(createTodo('two'), { signal: controller.signal });
    const three = lease.execute(createTodo('three'));
    await expect(captureCode(() => three)).resolves.toBe('DATABASE_BACKPRESSURE');
    controller.abort();
    await expect(captureCode(() => two)).resolves.toBe('DATABASE_QUEUE_TIMEOUT');
    release.resolve();
    await one;

    lease.release();
    await harness.coordinator.close();
  });

  test('global waiting capacity never blocks an immediately runnable other database', async () => {
    const harness = createHarness(roots, {
      maxDatabases: 2,
      maxQueuedTotal: 1,
    });
    const firstStarted = deferred<void>();
    const releaseFirst = deferred<void>();
    const starts: string[] = [];
    harness.onOperation = async ({ role, operation }) => {
      if (role !== 'writer' || operation.type !== 'mutate') return;
      starts.push(operation.idempotencyKey);
      if (operation.idempotencyKey === 'write:a-1') {
        firstStarted.resolve();
        await releaseFirst.promise;
      }
    };
    const a = await harness.coordinator.acquire('tenant-a');
    const b = await harness.coordinator.acquire('tenant-b');
    const a1 = a.execute(createTodo('a-1'));
    await firstStarted.promise;
    const a2 = a.execute(createTodo('a-2'));
    const b1 = b.execute(createTodo('b-1'));
    await b1;
    expect(starts).toEqual(['write:a-1', 'write:b-1']);
    releaseFirst.resolve();
    await Promise.all([a1, a2]);

    a.release();
    b.release();
    await harness.coordinator.close();
  });

  test('atomically caps new physical files while existing files remain openable', async () => {
    const store = new MemoryEventStore();
    const harness = createHarness(roots, {
      maxDatabases: 2,
      maxDatabaseFiles: 1,
      observability: createDatabaseObservability({
        sink: store,
        store,
        config: { console: false, store },
      }),
    });
    const ids = ['tenant-file-a', 'tenant-file-b'] as const;

    const outcomes = await Promise.allSettled(
      ids.map((id) => harness.coordinator.acquire(id)),
    );
    const fulfilledIndex = outcomes.findIndex(
      (outcome) => outcome.status === 'fulfilled',
    );
    const rejectedIndex = outcomes.findIndex(
      (outcome) => outcome.status === 'rejected',
    );
    expect(fulfilledIndex).toBeGreaterThanOrEqual(0);
    expect(rejectedIndex).toBeGreaterThanOrEqual(0);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes[rejectedIndex] as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({
      code: 'DATABASE_CAPACITY_EXHAUSTED',
      retryable: false,
      outcome: 'not-started',
      details: { capacityType: 'files', capacityLimit: 1 },
    });
    expect(harness.executors).toHaveLength(2);
    expect(harness.coordinator.diagnostics()).toMatchObject({
      maxDatabaseFiles: 1,
      databaseFiles: 1,
      openDatabases: 1,
      availableSlots: 1,
    });
    expect(existsSync(resolveDatabaseFile(
      harness.root,
      ids[rejectedIndex]!,
    ).path)).toBe(false);
    expect(store.query({ code: 'database.capacity.exhausted' }).events[0]?.metadata)
      .toMatchObject({ capacityType: 'files', capacityLimit: 1 });

    const winnerId = ids[fulfilledIndex]!;
    const winner = (outcomes[fulfilledIndex] as PromiseFulfilledResult<
      Awaited<ReturnType<DatabaseCoordinator['acquire']>>
    >).value;
    winner.release();
    expect(await harness.coordinator.evict(winnerId)).toBe(true);
    const reopened = await harness.coordinator.acquire(winnerId);
    expect(harness.coordinator.diagnostics().databaseFiles).toBe(1);
    reopened.release();
    await harness.coordinator.close();
  });

  test('reserves actor capacity from persistent tenant Sync and bounds each database', async () => {
    const store = new MemoryEventStore();
    const harness = createHarness(roots, {
      maxDatabases: 3,
      maxTenantSyncBindingsPerDatabase: 2,
      observability: createDatabaseObservability({
        sink: store,
        store,
        config: { console: false, store },
      }),
    });
    expect(harness.coordinator.diagnostics()).toMatchObject({
      maxTenantSyncDatabases: 2,
      maxTenantSyncBindingsPerDatabase: 2,
    });

    const firstA = await harness.coordinator.acquireTenantSync('tenant-sync-a');
    const secondA = await harness.coordinator.acquireTenantSync('tenant-sync-a');
    const firstB = await harness.coordinator.acquireTenantSync('tenant-sync-b');

    const perDatabase = await captureDatabaseError(
      () => harness.coordinator.acquireTenantSync('tenant-sync-a'),
    );
    expect(perDatabase).toMatchObject({
      code: 'DATABASE_BACKPRESSURE',
      retryable: true,
      outcome: 'not-started',
      details: { maxTenantSyncBindingsPerDatabase: 2 },
    });
    const distinct = await captureDatabaseError(
      () => harness.coordinator.acquireTenantSync('tenant-sync-c'),
    );
    expect(distinct).toMatchObject({
      code: 'DATABASE_BACKPRESSURE',
      retryable: true,
      outcome: 'not-started',
      details: { maxTenantSyncDatabases: 2 },
    });
    expect(existsSync(resolveDatabaseFile(
      harness.root,
      'tenant-sync-c',
    ).path)).toBe(false);
    expect(harness.coordinator.diagnostics()).toMatchObject({
      tenantSyncDatabases: 2,
      tenantSyncBindings: 3,
      openDatabases: 2,
      availableSlots: 1,
    });
    expect(harness.coordinator.diagnostics().databases.find(
      (entry) => entry.databaseRef === firstA.databaseRef,
    )).toMatchObject({ tenantSyncBindings: 2, leases: 2 });

    // The default distinct-Sync ceiling leaves one actor slot available for
    // ordinary request/background work even while all Sync slots are pinned.
    const ordinary = await harness.coordinator.acquire('tenant-sync-c');
    expect(harness.coordinator.diagnostics()).toMatchObject({
      openDatabases: 3,
      availableSlots: 0,
      tenantSyncDatabases: 2,
    });
    expect(store.query({ code: 'database.queue.saturated' }).events.filter(
      (event) => event.metadata?.operation === 'sync',
    )).toHaveLength(2);

    ordinary.release();
    firstA.release();
    secondA.release();
    firstB.release();
    expect(harness.coordinator.diagnostics()).toMatchObject({
      tenantSyncDatabases: 0,
      tenantSyncBindings: 0,
    });
    await harness.coordinator.close();
  });

  test('serializes distinct tenant Sync admission without pinning the loser', async () => {
    const harness = createHarness(roots, { maxDatabases: 2 });
    const ids = ['tenant-sync-a', 'tenant-sync-b'] as const;
    const outcomes = await Promise.allSettled(
      ids.map((id) => harness.coordinator.acquireTenantSync(id)),
    );
    const fulfilledIndex = outcomes.findIndex(
      (outcome) => outcome.status === 'fulfilled',
    );
    const rejectedIndex = outcomes.findIndex(
      (outcome) => outcome.status === 'rejected',
    );
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect((outcomes[rejectedIndex] as PromiseRejectedResult).reason)
      .toMatchObject({ code: 'DATABASE_BACKPRESSURE', retryable: true });
    expect(harness.coordinator.diagnostics()).toMatchObject({
      maxTenantSyncDatabases: 1,
      tenantSyncDatabases: 1,
      tenantSyncBindings: 1,
      openDatabases: 1,
      availableSlots: 1,
    });
    expect(existsSync(resolveDatabaseFile(
      harness.root,
      ids[rejectedIndex]!,
    ).path)).toBe(false);

    const winnerId = ids[fulfilledIndex]!;
    const winner = (outcomes[fulfilledIndex] as PromiseFulfilledResult<
      Awaited<ReturnType<DatabaseCoordinator['acquireTenantSync']>>
    >).value;
    const sameDatabase = await harness.coordinator.acquireTenantSync(winnerId);
    expect(harness.coordinator.diagnostics()).toMatchObject({
      tenantSyncDatabases: 1,
      tenantSyncBindings: 2,
      availableSlots: 1,
    });

    winner.release();
    sameDatabase.release();
    await harness.coordinator.close();
  });

  test('returns tenant Sync reservations after open and post-open authority failures', async () => {
    const authorityGate = new AuthorityCommitCoordinator();
    const harness = createHarness(roots, {
      maxDatabases: 2,
      maxTenantSyncDatabases: 1,
      authorityCommitCoordinator: authorityGate,
      requireCommitAuthority: true,
    });
    harness.bindFailureOnce = {
      role: 'writer',
      error: new DatabaseError(
        'DATABASE_SCHEMA_MISMATCH',
        'Realm mismatch.',
      ),
    };

    await expect(captureCode(
      () => harness.coordinator.acquireTenantSync('tenant-open-failure', {
        commitAuthority: createDatabaseCommitAuthority(
          authorityGate,
          'tenant-open-failure',
          () => undefined,
        ),
      }),
    )).resolves.toBe('DATABASE_SCHEMA_MISMATCH');
    expect(harness.coordinator.diagnostics()).toMatchObject({
      tenantSyncDatabases: 0,
      tenantSyncBindings: 0,
      openDatabases: 0,
      availableSlots: 2,
      databases: [],
    });

    await expect(captureCode(
      () => harness.coordinator.acquireTenantSync('tenant-authority-failure', {
        commitAuthority: createDatabaseCommitAuthority(
          authorityGate,
          'tenant-authority-failure',
          () => { throw new Error('stale authority'); },
        ),
      }),
    )).resolves.toBe('DATABASE_AUTHORITY_CHANGED');
    expect(harness.coordinator.diagnostics()).toMatchObject({
      tenantSyncDatabases: 0,
      tenantSyncBindings: 0,
      openDatabases: 1,
      availableSlots: 1,
      databases: [{ leases: 0, tenantSyncBindings: 0 }],
    });

    const binding = await harness.coordinator.acquireTenantSync('tenant-valid', {
      commitAuthority: createDatabaseCommitAuthority(
        authorityGate,
        'tenant-valid',
        () => undefined,
      ),
    });
    expect(harness.coordinator.diagnostics()).toMatchObject({
      tenantSyncDatabases: 1,
      tenantSyncBindings: 1,
    });

    binding.release();
    await harness.coordinator.close();
    await authorityGate.close();
  });

  test('quarantines an unknown generation, returns its outcome, then reopens fresh', async () => {
    const harness = createHarness(roots);
    const generationMaySettle = deferred<void>();
    harness.deferNextWriterSettlement = generationMaySettle.promise;
    let failOnce = true;
    harness.onOperation = ({ role, operation }) => {
      if (failOnce && role === 'writer' && operation.type === 'mutate') {
        failOnce = false;
        throw new DatabaseError(
          'DATABASE_OPERATION_TIMEOUT',
          'Actor timed out.',
          { retryable: false, outcome: 'unknown' },
        );
      }
    };
    const lease = await harness.coordinator.acquire('tenant-a');
    const originalGeneration = harness.coordinator
      .diagnostics().databases[0]!.writerGeneration;
    await expect(captureCode(
      () => lease.execute(createTodo('uncertain')),
    )).resolves.toBe('DATABASE_OPERATION_TIMEOUT');
    expect(harness.coordinator.diagnostics().quarantinedSlots).toBe(1);

    generationMaySettle.resolve();
    await waitUntil(() => (
      harness.coordinator.diagnostics().databases[0]?.state === 'ready'
    ));
    const recovered = harness.coordinator.diagnostics().databases[0]!;
    expect(recovered.writerGeneration).toBeGreaterThan(originalGeneration!);
    expect(harness.coordinator.diagnostics().quarantinedSlots).toBe(0);
    await lease.execute(createTodo('uncertain'));

    lease.release();
    await harness.coordinator.close();
  });

  test('backs off replacement attempts, opens the circuit, and reports the successful retry', async () => {
    const store = new MemoryEventStore();
    const harness = createHarness(roots, {
      restart: {
        initialDelayMs: 2,
        maxDelayMs: 4,
        circuitFailureThreshold: 3,
        circuitCooldownMs: 40,
      },
      observability: createDatabaseObservability({
        sink: store,
        store,
        config: { console: false, store },
      }),
    });
    const lease = await harness.coordinator.acquire('tenant-restart-circuit');
    harness.bindFailuresRemaining = {
      role: 'writer',
      remaining: 2,
      error: new DatabaseError(
        'DATABASE_EXECUTOR_START_FAILED',
        'private replacement startup detail',
        { retryable: true, outcome: 'not-started' },
      ),
    };
    harness.onOperation = () => {
      harness.onOperation = undefined;
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'private runtime failure detail',
        { retryable: false, outcome: 'unknown' },
      );
    };

    const startedAt = performance.now();
    await expect(captureCode(
      () => lease.execute(createTodo('restart-circuit')),
    )).resolves.toBe('DATABASE_EXECUTOR_FAILED');
    await waitUntil(() => (
      harness.coordinator.diagnostics().databases[0]?.restartCircuitOpen === true
    ));
    expect(harness.coordinator.diagnostics().databases[0]).toMatchObject({
      state: 'opening',
      restartRetryCount: 3,
      restartCircuitOpen: true,
    });
    await waitUntil(() => (
      harness.coordinator.diagnostics().databases[0]?.state === 'ready'
    ));
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(35);
    expect(harness.coordinator.diagnostics().databases[0]).toMatchObject({
      restartRetryCount: 0,
      restartCircuitOpen: false,
    });

    const restarted = store.query({ code: 'database.executor.restarted' }).events;
    expect(restarted).toHaveLength(2);
    expect(restarted.map((event) => event.metadata)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'writer', retryCount: 3, reason: 'failure' }),
        expect.objectContaining({ role: 'reader', retryCount: 3, reason: 'failure' }),
      ]),
    );
    expect(JSON.stringify(restarted)).not.toContain('private');

    lease.release();
    await harness.coordinator.close();
  });

  test('cancels a pending replacement delay during coordinator shutdown', async () => {
    const harness = createHarness(roots, {
      restart: {
        initialDelayMs: 60_000,
        maxDelayMs: 60_000,
        circuitFailureThreshold: 2,
        circuitCooldownMs: 60_000,
      },
    });
    const lease = await harness.coordinator.acquire('tenant-restart-close');
    harness.onOperation = () => {
      harness.onOperation = undefined;
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'simulated runtime failure',
        { retryable: false, outcome: 'unknown' },
      );
    };
    await expect(captureCode(
      () => lease.execute(createTodo('restart-close')),
    )).resolves.toBe('DATABASE_EXECUTOR_FAILED');
    expect(harness.coordinator.diagnostics().databases[0]?.state).toBe('opening');

    const startedAt = performance.now();
    await harness.coordinator.close();
    expect(performance.now() - startedAt).toBeLessThan(1_000);
    expect(harness.executors).toHaveLength(2);
    lease.release();
  });

  test('cancels a pending replacement when its last lease is released', async () => {
    const harness = createHarness(roots, {
      restart: {
        initialDelayMs: 60_000,
        maxDelayMs: 60_000,
        circuitFailureThreshold: 2,
        circuitCooldownMs: 60_000,
      },
    });
    const lease = await harness.coordinator.acquire('tenant-restart-release');
    harness.onOperation = () => {
      harness.onOperation = undefined;
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'simulated runtime failure',
        { retryable: false, outcome: 'unknown' },
      );
    };
    await expect(captureCode(
      () => lease.execute(createTodo('restart-release')),
    )).resolves.toBe('DATABASE_EXECUTOR_FAILED');
    expect(harness.coordinator.diagnostics().databases[0]?.state).toBe('opening');

    lease.release();
    await waitUntil(() => harness.coordinator.diagnostics().databases.length === 0);
    expect(harness.coordinator.diagnostics()).toMatchObject({
      availableSlots: 16,
      quarantinedSlots: 0,
    });
    expect(harness.executors).toHaveLength(2);
    await harness.coordinator.close();
  });

  test('lets an existing capability wait through a replacement opening', async () => {
    const harness = createHarness(roots);
    const generationMaySettle = deferred<void>();
    const replacementMayBind = deferred<void>();
    harness.deferNextWriterSettlement = generationMaySettle.promise;
    let failOnce = true;
    harness.onOperation = ({ role, operation }) => {
      if (failOnce && role === 'writer' && operation.type === 'mutate') {
        failOnce = false;
        throw new DatabaseError(
          'DATABASE_OPERATION_TIMEOUT',
          'Actor timed out.',
          { retryable: false, outcome: 'unknown' },
        );
      }
    };
    const lease = await harness.coordinator.acquire('tenant-a');
    harness.blockNextWriterBind = replacementMayBind.promise;
    await expect(captureCode(
      () => lease.execute(createTodo('uncertain')),
    )).resolves.toBe('DATABASE_OPERATION_TIMEOUT');

    generationMaySettle.resolve();
    await waitUntil(() => harness.blockedWriterBindConsumed === true);
    let completed = false;
    const retry = lease.execute(createTodo('uncertain')).then((result) => {
      completed = true;
      return result;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    replacementMayBind.resolve();
    await retry;

    lease.release();
    await harness.coordinator.close();
  });

  test('bounds and cancels existing-capability waits during replacement opening', async () => {
    const harness = createHarness(roots, {
      maxQueuedPerDatabase: 1,
      maxQueuedTotal: 1,
    });
    const generationMaySettle = deferred<void>();
    const replacementMayBind = deferred<void>();
    harness.deferNextWriterSettlement = generationMaySettle.promise;
    let failOnce = true;
    harness.onOperation = ({ role, operation }) => {
      if (failOnce && role === 'writer' && operation.type === 'mutate') {
        failOnce = false;
        throw new DatabaseError(
          'DATABASE_OPERATION_TIMEOUT',
          'Actor timed out.',
          { retryable: false, outcome: 'unknown' },
        );
      }
    };
    const lease = await harness.coordinator.acquire('tenant-a');
    harness.blockNextWriterBind = replacementMayBind.promise;
    await expect(captureCode(
      () => lease.execute(createTodo('uncertain')),
    )).resolves.toBe('DATABASE_OPERATION_TIMEOUT');
    generationMaySettle.resolve();
    await waitUntil(() => harness.blockedWriterBindConsumed === true);

    const controller = new AbortController();
    const cancelled = lease.execute(createTodo('cancelled'), {
      signal: controller.signal,
    });
    await waitUntil(() => (
      harness.coordinator.diagnostics().queuedOperations === 1
    ));
    expect(harness.coordinator.diagnostics().databases[0]).toMatchObject({
      state: 'opening',
      queueDepth: 1,
    });
    await expect(captureCode(
      () => lease.execute(createTodo('saturated')),
    )).resolves.toBe('DATABASE_BACKPRESSURE');
    controller.abort();
    await expect(captureCode(() => cancelled)).resolves.toBe(
      'DATABASE_QUEUE_TIMEOUT',
    );
    expect(harness.coordinator.diagnostics().queuedOperations).toBe(0);

    await expect(captureCode(() => lease.replay(0, 25, {
      queueTimeoutMs: 10,
    }))).resolves.toBe('DATABASE_QUEUE_TIMEOUT');
    expect(harness.coordinator.diagnostics().queuedOperations).toBe(0);

    const resumed = lease.execute(createTodo('resumed'));
    replacementMayBind.resolve();
    await resumed;
    expect(harness.coordinator.diagnostics().queuedOperations).toBe(0);
    lease.release();
    await harness.coordinator.close();
  });

  test('rejects a factory that reuses an executor generation for a slot', async () => {
    const harness = createHarness(roots, {
      fixedExecutorGenerations: true,
      maxDatabases: 1,
    });
    let failOnce = true;
    harness.onOperation = ({ role, operation }) => {
      if (failOnce && role === 'writer' && operation.type === 'mutate') {
        failOnce = false;
        throw new DatabaseError(
          'DATABASE_OPERATION_TIMEOUT',
          'Actor timed out.',
          { retryable: false, outcome: 'unknown' },
        );
      }
    };
    const lease = await harness.coordinator.acquire('tenant-a');
    await expect(captureCode(
      () => lease.execute(createTodo('uncertain')),
    )).resolves.toBe('DATABASE_OPERATION_TIMEOUT');
    await waitUntil(() => (
      harness.coordinator.diagnostics().databases.length === 0
    ));
    expect(harness.coordinator.diagnostics().availableSlots).toBe(1);
    await expect(captureCode(
      () => harness.coordinator.acquire('tenant-a'),
    )).resolves.toBe('DATABASE_EXECUTOR_START_FAILED');

    lease.release();
    await harness.coordinator.close();
  });

  test('keeps a stale replacement generation quarantined until exact settlement', async () => {
    const harness = createHarness(roots, {
      fixedExecutorGenerations: true,
      maxDatabases: 1,
    });
    const staleGenerationMaySettle = deferred<void>();
    harness.deferNextUnboundWriterSettlement = staleGenerationMaySettle.promise;
    let failOnce = true;
    harness.onOperation = ({ role, operation }) => {
      if (failOnce && role === 'writer' && operation.type === 'mutate') {
        failOnce = false;
        throw new DatabaseError(
          'DATABASE_OPERATION_TIMEOUT',
          'Actor timed out.',
          { retryable: false, outcome: 'unknown' },
        );
      }
    };
    const lease = await harness.coordinator.acquire('tenant-a');
    await expect(captureCode(
      () => lease.execute(createTodo('uncertain')),
    )).resolves.toBe('DATABASE_OPERATION_TIMEOUT');
    await waitUntil(() => (
      harness.coordinator.diagnostics().quarantinedSlots === 1
    ));
    expect(harness.deferredUnboundWriterSettlementConsumed).toBe(true);
    expect(harness.coordinator.diagnostics()).toMatchObject({
      availableSlots: 0,
      quarantinedSlots: 1,
    });
    await expect(captureCode(
      () => harness.coordinator.acquire('tenant-b'),
    )).resolves.toBe('DATABASE_BACKPRESSURE');

    staleGenerationMaySettle.resolve();
    await waitUntil(() => (
      harness.coordinator.diagnostics().databases.length === 0
    ));
    expect(harness.coordinator.diagnostics()).toMatchObject({
      availableSlots: 1,
      quarantinedSlots: 0,
    });
    lease.release();
    await harness.coordinator.close();
  });

  test('validates bounded replay requests and routes them through the writer lane', async () => {
    const harness = createHarness(roots);
    const lease = await harness.coordinator.acquire('tenant-a');
    expect(await lease.replay(0, 25)).toEqual({
      value: {
        afterSeq: 0,
        throughSeq: 0,
        nextAfterSeq: null,
        changes: [],
      },
      sequence: { seq: 0 },
    });
    await expect(captureCode(() => lease.replay(0, 501))).resolves.toBe(
      'DATABASE_PAYLOAD_INVALID',
    );

    lease.release();
    await harness.coordinator.close();
  });

  test('emits one history-gap event for capability and tenant Sync replay gaps', async () => {
    const store = new MemoryEventStore();
    const harness = createHarness(roots, {
      observability: createDatabaseObservability({
        sink: store,
        store,
        config: { console: false, store },
      }),
    });
    const lease = await harness.coordinator.acquire('tenant-history-gap');
    harness.replayGapOnce = { afterSeq: 4, currentSeq: 12 };

    await expect(captureCode(() => lease.replay(4))).resolves.toBe(
      'DATABASE_HISTORY_GAP',
    );

    lease.release();
    const binding = await harness.coordinator.acquireTenantSync(
      'tenant-history-gap',
    );
    harness.replayGapOnce = { afterSeq: 7, currentSeq: 18 };

    await expect(captureCode(() => binding.replay(7))).resolves.toBe(
      'DATABASE_HISTORY_GAP',
    );

    expect(store.query({ code: 'database.history.gap' }).events.map(
      (event) => event.metadata,
    )).toEqual([
      expect.objectContaining({
        databaseRef: lease.databaseRef,
        role: 'writer',
        sequenceStart: 5,
        sequenceEnd: 12,
        reason: 'history-gap',
      }),
      expect.objectContaining({
        databaseRef: binding.databaseRef,
        role: 'writer',
        sequenceStart: 8,
        sequenceEnd: 18,
        reason: 'history-gap',
      }),
    ]);
    expect(store.query({ code: 'database.replay.failed' }).events).toHaveLength(0);

    binding.release();
    await harness.coordinator.close();
  });

  test('pins tenant Sync head/snapshot, client, replay, and post-authority wakeups', async () => {
    const authorityGate = new AuthorityCommitCoordinator();
    const harness = createHarness(roots, {
      authorityCommitCoordinator: authorityGate,
      requireCommitAuthority: true,
    });
    const authority = createDatabaseCommitAuthority(
      authorityGate,
      'tenant-a',
      () => undefined,
    );
    const binding = await harness.coordinator.acquireTenantSync('tenant-a', {
      commitAuthority: authority,
    });

    const head = await collectTenantSnapshot(binding, []);
    expect(head.sequence).toEqual({ seq: 0 });
    expect(head.tables).toEqual({});
    const snapshot = await collectTenantSnapshot(binding, ['todos']);
    expect(snapshot.tables.todos).toEqual([
      { id: 'snapshot', title: 'snapshot' },
    ]);
    expect(snapshot.syncEpoch).toBe(head.syncEpoch);
    expect(snapshot.generation).toBe(head.generation);
    const exact = await binding.beginSnapshot(['todos']);
    expect(exact).toMatchObject({
      databaseRef: binding.databaseRef,
      generation: head.generation,
      syncEpoch: head.syncEpoch,
      sequence: { seq: 0 },
      tables: ['todos'],
      totalRows: 1,
      aborted: false,
    });
    const exactPage = await exact.page(0);
    expect(exactPage).toMatchObject({
      cursor: 0,
      nextCursor: null,
      rows: [{ ordinal: 0, tableIndex: 0, rowId: 'snapshot' }],
    });
    expect(await exact.page(0)).toEqual(exactPage);
    await exact.abort();
    expect(exact.aborted).toBe(true);

    const wakeups: any[] = [];
    binding.onWakeup((wakeup) => {
      wakeups.push({
        wakeup,
        sharedAuthority: authorityGate.diagnostics().activeShared,
      });
    });
    await binding.client.mutate(
      { type: 'create', table: 'todos', row: { id: 'one', title: 'one' } },
      { idempotencyKey: 'write:one' },
    );
    expect(wakeups).toEqual([{
      wakeup: {
        type: 'changes',
        databaseRef: binding.databaseRef,
        syncEpoch: head.syncEpoch,
        generation: head.generation,
        afterSeq: 0,
        throughSeq: 1,
        idempotencyKey: 'write:one',
      },
      sharedAuthority: 0,
    }]);
    const replay = await binding.replay(1);
    expect(replay.value).toEqual({
      afterSeq: 1,
      throughSeq: 1,
      nextAfterSeq: null,
      changes: [],
    });
    expect(replay.syncEpoch).toBe(head.syncEpoch);
    expect(replay.generation).toBe(head.generation);

    const releasedSession = await binding.beginSnapshot([]);
    binding.release();
    expect(binding.released).toBe(true);
    expect(releasedSession.aborted).toBe(true);
    await waitUntil(() => harness.executors.every(
      (executor) => executor.activeSnapshotSessions() === 0,
    ));
    expect(harness.coordinator.diagnostics().databases[0]?.leases).toBe(0);
    await harness.coordinator.close();
    await authorityGate.close();
  });

  test('revalidates tenant Sync read authority before and after yielding data', async () => {
    const harness = createHarness(roots);
    let current = true;
    let checks = 0;
    harness.onOperation = ({ operation }) => {
      if (operation.type === 'get') current = false;
    };
    const binding = await harness.coordinator.acquireTenantSync('tenant-a', {
      assertReadAuthority: () => {
        checks += 1;
        if (!current) throw new Error('/private/revocation');
        return undefined;
      },
    });
    const failure = await captureDatabaseError(
      () => binding.client.get('todos', 'one'),
    );
    expect(failure).toMatchObject({
      code: 'DATABASE_AUTHORITY_CHANGED',
      outcome: null,
      retryable: false,
    });
    expect(failure.message).not.toContain('private');
    expect(checks).toBe(2);

    binding.release();
    await harness.coordinator.close();
  });

  test('keeps a tenant Sync lease through recovery and signals cursor reset', async () => {
    const harness = createHarness(roots);
    const binding = await harness.coordinator.acquireTenantSync('tenant-a');
    const initial = await collectTenantSnapshot(binding, []);
    const invalidatedSession = await binding.beginSnapshot([]);
    const wakeups: any[] = [];
    binding.onWakeup((wakeup) => wakeups.push(wakeup));
    harness.onOperation = () => {
      harness.onOperation = undefined;
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'simulated unknown outcome',
        { retryable: false, outcome: 'unknown' },
      );
    };

    await expect(captureCode(() => binding.client.mutate(
      { type: 'create', table: 'todos', row: { id: 'one', title: 'one' } },
      { idempotencyKey: 'write:one' },
    ))).resolves.toBe('DATABASE_EXECUTOR_FAILED');
    await waitUntil(() => wakeups.some((wakeup) => wakeup.type === 'reset'));
    const reset = wakeups.find((wakeup) => wakeup.type === 'reset');
    expect(reset.generation).toBeGreaterThan(initial.generation);
    expect(reset.syncEpoch).not.toBe(initial.syncEpoch);
    expect(invalidatedSession.aborted).toBe(true);
    await expect(captureCode(() => invalidatedSession.page(0))).resolves.toBe(
      'DATABASE_TRANSACTION_EXPIRED',
    );
    expect((await collectTenantSnapshot(binding, [])).generation).toBe(reset.generation);

    binding.release();
    await harness.coordinator.close();
  });

  test('releases a failed zero-lease binding only after its old generation settles', async () => {
    const harness = createHarness(roots, { maxDatabases: 1 });
    const generationMaySettle = deferred<void>();
    harness.deferNextWriterSettlement = generationMaySettle.promise;
    harness.onOperation = ({ role, operation }) => {
      if (role === 'writer' && operation.type === 'mutate') {
        throw new DatabaseError(
          'DATABASE_OPERATION_TIMEOUT',
          'Actor timed out.',
          { retryable: false, outcome: 'unknown' },
        );
      }
    };
    const lease = await harness.coordinator.acquire('tenant-a');
    const write = lease.execute(createTodo('uncertain'));
    lease.release();
    await expect(captureCode(() => write)).resolves.toBe(
      'DATABASE_OPERATION_TIMEOUT',
    );
    expect(harness.coordinator.diagnostics().availableSlots).toBe(0);
    expect(harness.coordinator.diagnostics().quarantinedSlots).toBe(1);

    generationMaySettle.resolve();
    await waitUntil(() => (
      harness.coordinator.diagnostics().databases.length === 0
    ));
    expect(harness.coordinator.diagnostics().availableSlots).toBe(1);
    const replacement = await harness.coordinator.acquire('tenant-b');
    replacement.release();
    await harness.coordinator.close();
  });

  test('retires terminal reader and writer generations after read failures', async () => {
    const harness = createHarness(roots);
    let failingRole: 'reader' | 'writer' | null = 'reader';
    harness.onOperation = ({ role, operation }) => {
      if (role === failingRole && operation.type === 'get') {
        failingRole = null;
        throw new DatabaseError(
          'DATABASE_EXECUTOR_FAILED',
          'Actor exited.',
          { retryable: false, outcome: null },
        );
      }
    };
    const lease = await harness.coordinator.acquire('tenant-a');
    const initial = harness.coordinator.diagnostics().databases[0]!;
    await expect(captureCode(() => lease.execute({
      type: 'get', table: 'todos', id: 'one',
      consistency: { mode: 'snapshot' },
    }))).resolves.toBe('DATABASE_EXECUTOR_FAILED');
    await waitUntil(() => {
      const current = harness.coordinator.diagnostics().databases[0];
      return current?.state === 'ready'
        && current.readerGeneration !== initial.readerGeneration;
    });

    const afterReader = harness.coordinator.diagnostics().databases[0]!;
    failingRole = 'writer';
    await expect(captureCode(() => lease.execute({
      type: 'get', table: 'todos', id: 'one',
      consistency: { mode: 'strong' },
    }))).resolves.toBe('DATABASE_EXECUTOR_FAILED');
    await waitUntil(() => {
      const current = harness.coordinator.diagnostics().databases[0];
      return current?.state === 'ready'
        && current.writerGeneration !== afterReader.writerGeneration;
    });

    expect(await lease.execute({
      type: 'get', table: 'todos', id: 'one',
      consistency: { mode: 'snapshot' },
    })).toMatchObject({ value: { actor: 'reader' } });
    lease.release();
    await harness.coordinator.close();
  });

  test('treats malformed replay as a protocol failure and replaces its writer', async () => {
    const harness = createHarness(roots);
    const lease = await harness.coordinator.acquire('tenant-a');
    const generation = harness.coordinator
      .diagnostics().databases[0]!.writerGeneration;
    harness.malformedReplayOnce = true;

    await expect(captureCode(() => lease.replay(0, 25))).resolves.toBe(
      'DATABASE_PROTOCOL_ERROR',
    );
    await waitUntil(() => {
      const current = harness.coordinator.diagnostics().databases[0];
      return current?.state === 'ready'
        && current.writerGeneration !== generation;
    });

    lease.release();
    await harness.coordinator.close();
  });

  test('blocks permanent realm failures until an explicit eviction clears them', async () => {
    const harness = createHarness(roots, { maxDatabases: 1 });
    harness.bindFailureOnce = {
      role: 'writer',
      error: new DatabaseError(
        'DATABASE_SCHEMA_MISMATCH',
        'Realm mismatch.',
      ),
    };
    await expect(captureCode(
      () => harness.coordinator.acquire('tenant-a'),
    )).resolves.toBe('DATABASE_SCHEMA_MISMATCH');
    const diagnostics = harness.coordinator.diagnostics();
    expect(diagnostics.availableSlots).toBe(1);
    expect(diagnostics.blockedDatabases).toHaveLength(1);
    expect(diagnostics.blockedDatabases[0]!.failureCode).toBe(
      'DATABASE_SCHEMA_MISMATCH',
    );

    const blocked = await captureDatabaseError(
      () => harness.coordinator.acquire('tenant-a'),
    );
    expect(blocked.code).toBe('DATABASE_NOT_READY');
    expect(blocked.retryable).toBe(false);
    expect(blocked.details.failureCode).toBe('DATABASE_SCHEMA_MISMATCH');
    expect(await harness.coordinator.evict('tenant-a')).toBe(true);

    const lease = await harness.coordinator.acquire('tenant-a');
    lease.release();
    await harness.coordinator.close();
  });

  test('bounds remembered permanent failures and retries the least-recent record', async () => {
    const harness = createHarness(roots, {
      maxDatabases: 1,
      maxBlockedDatabases: 1,
    });
    harness.bindFailureOnce = {
      role: 'writer',
      error: new DatabaseError('DATABASE_SCHEMA_MISMATCH', 'Realm mismatch.'),
    };
    await expect(captureCode(
      () => harness.coordinator.acquire('tenant-a'),
    )).resolves.toBe('DATABASE_SCHEMA_MISMATCH');
    const firstBlockedRef = harness.coordinator
      .diagnostics().blockedDatabases[0]!.databaseRef;

    harness.bindFailureOnce = {
      role: 'writer',
      error: new DatabaseError('DATABASE_SCHEMA_MISMATCH', 'Realm mismatch.'),
    };
    await expect(captureCode(
      () => harness.coordinator.acquire('tenant-b'),
    )).resolves.toBe('DATABASE_SCHEMA_MISMATCH');
    const diagnostics = harness.coordinator.diagnostics();
    expect(diagnostics.maxBlockedDatabases).toBe(1);
    expect(diagnostics.blockedDatabases).toHaveLength(1);
    expect(diagnostics.blockedDatabases[0]!.databaseRef).not.toBe(
      firstBlockedRef,
    );

    const retried = await harness.coordinator.acquire('tenant-a');
    retried.release();
    await harness.coordinator.close();
  });

  test('shares one opening generation across concurrent acquisitions', async () => {
    const harness = createHarness(roots);
    const [first, second] = await Promise.all([
      harness.coordinator.acquire('tenant-a'),
      harness.coordinator.acquire('tenant-a'),
    ]);
    expect(harness.executors).toHaveLength(2);
    expect(first.databaseRef).toBe(second.databaseRef);

    first.release();
    second.release();
    await harness.coordinator.close();
  });

  test('does not hold the catalog gate while an idle actor closes', async () => {
    const harness = createHarness(roots, { maxDatabases: 2 });
    const first = await harness.coordinator.acquire('tenant-a');
    first.release();
    const mayClose = deferred<void>();
    harness.blockNextWriterClose = mayClose.promise;
    const eviction = harness.coordinator.evict('tenant-a');
    await waitUntil(() => harness.blockedWriterCloseConsumed === true);

    const unrelated = await harness.coordinator.acquire('tenant-b');
    unrelated.release();
    mayClose.resolve();
    await expect(eviction).resolves.toBe(true);
    await harness.coordinator.close();
  });

  test('restores queue capacity after a real queue timeout', async () => {
    const harness = createHarness(roots, {
      maxQueuedPerDatabase: 1,
      maxQueuedTotal: 1,
      queueTimeoutMs: 10,
    });
    const firstStarted = deferred<void>();
    const releaseFirst = deferred<void>();
    harness.onOperation = async ({ role, operation }) => {
      if (role === 'writer' && operation.type === 'mutate'
        && operation.idempotencyKey === 'write:one') {
        firstStarted.resolve();
        await releaseFirst.promise;
      }
    };
    const lease = await harness.coordinator.acquire('tenant-a');
    const first = lease.execute(createTodo('one'));
    await firstStarted.promise;
    await expect(captureCode(
      () => lease.execute(createTodo('two')),
    )).resolves.toBe('DATABASE_QUEUE_TIMEOUT');
    const third = lease.execute(createTodo('three'));
    releaseFirst.resolve();
    await Promise.all([first, third]);
    expect(harness.coordinator.diagnostics().queuedOperations).toBe(0);

    lease.release();
    await harness.coordinator.close();
  });

  test('permits shutdown retry after a quarantined actor settles late', async () => {
    const harness = createHarness(roots);
    const lease = await harness.coordinator.acquire('tenant-a');
    lease.release();
    const generationMaySettle = deferred<void>();
    harness.deferNextWriterSettlement = generationMaySettle.promise;

    await expect(captureCode(() => harness.coordinator.close())).resolves.toBe(
      'DATABASE_EXECUTOR_FAILED',
    );
    expect(harness.coordinator.diagnostics().state).toBe('close-failed');
    expect(harness.coordinator.diagnostics().quarantinedSlots).toBe(1);
    generationMaySettle.resolve();
    await waitUntil(() => (
      harness.coordinator.diagnostics().quarantinedSlots === 0
    ));
    await expect(harness.coordinator.close()).resolves.toBeUndefined();
    expect(harness.coordinator.diagnostics().state).toBe('closed');
  });

  test('never reuses a settled actor whose final durability close failed', async () => {
    const harness = createHarness(roots, {
      maxDatabases: 1,
      placement: {
        default: 'hot',
        hot: {
          durability: 'final',
          maxBytes: 8 * 1024 * 1024,
        },
      },
    });
    const lease = await harness.coordinator.acquire('tenant-hot');
    await lease.execute(createTodo('acknowledged'));
    lease.release();
    harness.failWriterClosePermanently = true;

    await expect(captureCode(() => harness.coordinator.close())).resolves.toBe(
      'DATABASE_EXECUTOR_FAILED',
    );
    expect(harness.coordinator.diagnostics()).toMatchObject({
      state: 'close-failed',
      availableSlots: 0,
      quarantinedSlots: 1,
      databases: [{
        placement: 'hot',
        state: 'quarantined',
      }],
    });
    expect(harness.coordinator.diagnostics().databases[0]!.writerGeneration)
      .toBeNumber();
    expect(harness.executors).toHaveLength(1);
    expect(harness.executors[0]!.diagnostics().settled).toBe(true);

    await expect(captureCode(() => harness.coordinator.close())).resolves.toBe(
      'DATABASE_EXECUTOR_FAILED',
    );
    expect(harness.coordinator.diagnostics()).toMatchObject({
      state: 'close-failed',
      availableSlots: 0,
      quarantinedSlots: 1,
    });
    expect(harness.executors).toHaveLength(1);
  });

  test('keeps delayed hot final shutdown failures quarantined after settlement', async () => {
    const harness = createHarness(roots, {
      maxDatabases: 1,
      placement: {
        default: 'hot',
        hot: {
          durability: 'final',
          maxBytes: 8 * 1024 * 1024,
        },
      },
    });
    const lease = await harness.coordinator.acquire('tenant-hot');
    await lease.execute(createTodo('acknowledged'));
    lease.release();
    const generationMaySettle = deferred<void>();
    harness.deferNextWriterSettlement = generationMaySettle.promise;

    await expect(captureCode(() => harness.coordinator.close())).resolves.toBe(
      'DATABASE_EXECUTOR_FAILED',
    );
    generationMaySettle.resolve();
    await waitUntil(() => harness.executors[0]!.diagnostics().settled);
    expect(harness.coordinator.diagnostics()).toMatchObject({
      state: 'close-failed',
      availableSlots: 0,
      quarantinedSlots: 1,
      databases: [{ placement: 'hot', state: 'quarantined' }],
    });
    await expect(captureCode(() => harness.coordinator.close())).resolves.toBe(
      'DATABASE_EXECUTOR_FAILED',
    );
  });

  test('never reopens delayed hot final retirement after close failure', async () => {
    const harness = createHarness(roots, {
      maxDatabases: 1,
      placement: {
        default: 'hot',
        hot: {
          durability: 'final',
          maxBytes: 8 * 1024 * 1024,
        },
      },
    });
    const generationMaySettle = deferred<void>();
    harness.deferNextWriterSettlement = generationMaySettle.promise;
    let failOnce = true;
    harness.onOperation = ({ role, operation }) => {
      if (failOnce && role === 'writer' && operation.type === 'mutate') {
        failOnce = false;
        throw new DatabaseError(
          'DATABASE_OPERATION_TIMEOUT',
          'Actor timed out.',
          { retryable: false, outcome: 'unknown' },
        );
      }
    };
    const lease = await harness.coordinator.acquire('tenant-hot');
    const originalGeneration = harness.executors[0]!.diagnostics().generation;

    await expect(captureCode(
      () => lease.execute(createTodo('uncertain')),
    )).resolves.toBe('DATABASE_OPERATION_TIMEOUT');
    generationMaySettle.resolve();
    await waitUntil(() => harness.executors[0]!.diagnostics().settled);
    await Bun.sleep(5);
    expect(harness.coordinator.diagnostics()).toMatchObject({
      availableSlots: 0,
      quarantinedSlots: 1,
      databases: [{
        placement: 'hot',
        state: 'quarantined',
        writerGeneration: originalGeneration,
      }],
    });
    expect(harness.executors).toHaveLength(1);
    lease.release();
    await expect(captureCode(() => harness.coordinator.close())).resolves.toBe(
      'DATABASE_EXECUTOR_FAILED',
    );
  });

  test('runs a bounded hot database on one writer actor and reports its placement', async () => {
    const harness = createHarness(roots, {
      placement: {
        default: 'hot',
        hot: {
          durability: 'on-write',
          maxBytes: 8 * 1024 * 1024,
        },
      },
    });
    const lease = await harness.coordinator.acquire('tenant-hot');

    await expect(lease.execute({
      type: 'get', table: 'todos', id: 'one',
      consistency: { mode: 'snapshot' },
    })).resolves.toMatchObject({ value: { actor: 'writer' } });
    expect(harness.executors).toHaveLength(1);
    expect(harness.binds).toEqual([{
      role: 'writer',
      databaseRef: lease.databaseRef,
      placement: {
        mode: 'hot',
        durability: 'on-write',
        maxBytes: 8 * 1024 * 1024,
      },
    }]);
    expect(harness.coordinator.diagnostics()).toMatchObject({
      fileDatabases: 0,
      hotDatabases: 1,
      databases: [{
        placement: 'hot',
        readerGeneration: null,
      }],
    });

    lease.release();
    await harness.coordinator.close();
  });

  test('requires executor events only for periodic hot writers', async () => {
    for (const placement of [
      { default: 'file', hot: null } as const,
      {
        default: 'hot',
        hot: {
          durability: 'on-write',
          maxBytes: 8 * 1024 * 1024,
        },
      } as const,
    ]) {
      const supported = createHarness(roots, {
        placement,
        omitWriterEventListener: true,
      });
      const lease = await supported.coordinator.acquire('tenant-supported');
      lease.release();
      await supported.coordinator.close();
    }

    const periodic = createHarness(roots, {
      maxDatabases: 1,
      omitWriterEventListener: true,
      placement: {
        default: 'hot',
        hot: {
          durability: 'periodic',
          maxBytes: 8 * 1024 * 1024,
          snapshotIntervalMs: 1_000,
        },
      },
    });

    await expect(captureCode(
      () => periodic.coordinator.acquire('tenant-periodic'),
    )).resolves.toBe('DATABASE_EXECUTOR_START_FAILED');
    expect(periodic.executors[0]?.diagnostics().settled).toBe(true);
    expect(periodic.coordinator.diagnostics()).toMatchObject({
      availableSlots: 1,
      quarantinedSlots: 0,
      databases: [],
    });
    await periodic.coordinator.close();
  });

  test('retires an idle periodic hot actor on its closed fatal signal and resets Sync', async () => {
    const store = new MemoryEventStore();
    const harness = createHarness(roots, {
      observability: createDatabaseObservability({
        sink: store,
        store,
        config: { console: false, store },
      }),
      placement: {
        default: 'hot',
        hot: {
          durability: 'periodic',
          maxBytes: 8 * 1024 * 1024,
          snapshotIntervalMs: 1_000,
        },
      },
    });
    const binding = await harness.coordinator.acquireTenantSync('tenant-hot');
    const initial = await collectTenantSnapshot(binding, []);
    const wakeups: any[] = [];
    binding.onWakeup((wakeup) => wakeups.push(wakeup));
    const failedWriter = harness.executors.find((executor) => (
      executor.diagnostics().generation === initial.generation
    ));
    expect(failedWriter).toBeDefined();

    failedWriter!.startHotPeriodicSnapshot();
    failedWriter!.finishHotPeriodicSnapshot();
    failedWriter!.markHotPeriodicDirty();
    failedWriter!.markHotPeriodicClean();
    failedWriter!.failHotPeriodicDurability();
    failedWriter!.failHotPeriodicDurability();

    await waitUntil(() => wakeups.some((wakeup) => wakeup.type === 'reset'));
    const reset = wakeups.find((wakeup) => wakeup.type === 'reset');
    expect(reset.generation).toBeGreaterThan(initial.generation);
    expect(store.query({ code: 'database.hot_durability.failed' }).events)
      .toHaveLength(1);
    expect(store.query({ code: 'database.hot_durability.failed' }).events[0]?.metadata)
      .toMatchObject({
        databaseRef: binding.databaseRef,
        placement: 'hot',
        durability: 'periodic',
        role: 'writer',
        errorCode: 'DATABASE_EXECUTOR_FAILED',
      });
    for (const code of [
      'database.hot_snapshot.started',
      'database.hot_snapshot.finished',
      'database.hot_durability.dirty',
      'database.hot_durability.clean',
    ]) {
      const events = store.query({ code }).events;
      expect(events).toHaveLength(1);
      expect(events[0]?.metadata).toMatchObject({
        databaseRef: binding.databaseRef,
        placement: 'hot',
        durability: 'periodic',
        role: 'writer',
      });
    }
    expect((await collectTenantSnapshot(binding, [])).generation).toBe(reset.generation);

    binding.release();
    await harness.coordinator.close();
  });

  test('joins periodic recovery before closing a held tenant Sync binding', async () => {
    const harness = createHarness(roots, {
      maxDatabases: 1,
      maxTenantSyncDatabases: 1,
      placement: {
        default: 'hot',
        hot: {
          durability: 'periodic',
          maxBytes: 8 * 1024 * 1024,
          snapshotIntervalMs: 1_000,
        },
      },
    });
    const binding = await harness.coordinator.acquireTenantSync('tenant-hot');
    const initial = await collectTenantSnapshot(binding, []);
    const failedWriter = harness.executors.find((executor) => (
      executor.diagnostics().generation === initial.generation
    ));
    expect(failedWriter).toBeDefined();
    const actorMayClose = deferred<void>();
    harness.blockWriterClose = actorMayClose.promise;

    failedWriter!.failHotPeriodicDurability();
    await waitUntil(() => harness.blockedWriterCloseConsumed === true);

    let coordinatorClosed = false;
    const close = harness.coordinator.close().then(() => {
      coordinatorClosed = true;
    });
    await Bun.sleep(5);
    expect(coordinatorClosed).toBe(false);

    actorMayClose.resolve();
    await close;

    expect(binding.released).toBe(true);
    expect(await captureCode(() => binding.beginSnapshot([]))).toBe(
      'DATABASE_CLOSED',
    );
    expect(harness.coordinator.diagnostics()).toMatchObject({
      state: 'closed',
      openDatabases: 0,
      availableSlots: 1,
      quarantinedSlots: 0,
      databases: [],
    });
  });

  test('recovers a periodic runtime failure when its final close snapshot also fails', async () => {
    const harness = createHarness(roots, {
      placement: {
        default: 'hot',
        hot: {
          durability: 'periodic',
          maxBytes: 8 * 1024 * 1024,
          snapshotIntervalMs: 1_000,
        },
      },
    });
    const binding = await harness.coordinator.acquireTenantSync('tenant-hot');
    const initial = await collectTenantSnapshot(binding, []);
    const wakeups: any[] = [];
    binding.onWakeup((wakeup) => wakeups.push(wakeup));
    harness.failWriterClosePermanently = true;
    let failOnce = true;
    harness.onOperation = ({ role, operation }) => {
      if (failOnce && role === 'writer' && operation.type === 'mutate') {
        failOnce = false;
        throw new DatabaseError(
          'DATABASE_OUTCOME_UNKNOWN',
          'Periodic post-commit durability fence failed.',
          { retryable: false, outcome: 'unknown' },
        );
      }
    };

    await expect(captureCode(() => binding.client.mutate(
      { type: 'create', table: 'todos', row: { id: 'one', title: 'one' } },
      { idempotencyKey: 'write:periodic-close-failure' },
    ))).resolves.toBe('DATABASE_OUTCOME_UNKNOWN');
    await waitUntil(() => wakeups.some((wakeup) => wakeup.type === 'reset'));

    const reset = wakeups.find((wakeup) => wakeup.type === 'reset');
    expect(reset.generation).toBeGreaterThan(initial.generation);
    expect((await collectTenantSnapshot(binding, [])).generation).toBe(reset.generation);
    expect(harness.coordinator.diagnostics()).toMatchObject({
      quarantinedSlots: 0,
      databases: [{ placement: 'hot', state: 'ready' }],
    });

    harness.failWriterClosePermanently = false;
    binding.release();
    await harness.coordinator.close();
  });

  test('refreshes only the physical proof after a hot snapshot replaces the inode', async () => {
    const harness = createHarness(roots, {
      placement: {
        default: 'hot',
        hot: {
          durability: 'periodic',
          maxBytes: 8 * 1024 * 1024,
          snapshotIntervalMs: 1_000,
        },
      },
    });
    const lease = await harness.coordinator.acquire('tenant-hot-proof-refresh');
    const originalGeneration = harness.executors[0]!.diagnostics().generation;
    const filePath = resolveDatabaseFile(
      harness.root,
      'tenant-hot-proof-refresh',
    ).path;
    const replacement = `${filePath}.replacement`;
    copyFileSync(filePath, replacement);
    renameSync(replacement, filePath);

    harness.executors[0]!.failHotPeriodicDurability();
    await waitUntil(() => harness.coordinator.diagnostics().databases[0]?.state === 'ready'
      && (harness.coordinator.diagnostics().databases[0]?.writerGeneration ?? 0)
        > originalGeneration);

    await expect(lease.execute({
      type: 'get', table: 'todos', id: 'one',
      consistency: { mode: 'strong' },
    })).resolves.toMatchObject({ value: { actor: 'writer' } });
    expect(harness.coordinator.diagnostics()).toMatchObject({
      quarantinedSlots: 0,
      databases: [{ placement: 'hot', state: 'ready' }],
    });

    lease.release();
    await harness.coordinator.close();
  });

  test('retires a periodic hot actor when its parent watchdog sees no finish', async () => {
    const store = new MemoryEventStore();
    const harness = createHarness(roots, {
      observability: createDatabaseObservability({
        sink: store,
        store,
        config: { console: false, store },
      }),
      placement: {
        default: 'hot',
        hot: {
          durability: 'periodic',
          maxBytes: 8 * 1024 * 1024,
          snapshotIntervalMs: 5,
          snapshotTimeoutMs: 10,
        },
      },
    });
    const binding = await harness.coordinator.acquireTenantSync('tenant-hot');
    const initial = await collectTenantSnapshot(binding, []);
    const wakeups: any[] = [];
    binding.onWakeup((wakeup) => wakeups.push(wakeup));
    const generationMaySettle = deferred<void>();
    harness.deferNextWriterSettlement = generationMaySettle.promise;
    const stalledWriter = harness.executors.find((executor) => (
      executor.diagnostics().generation === initial.generation
    ));
    expect(stalledWriter).toBeDefined();

    stalledWriter!.startHotPeriodicSnapshot();

    await waitUntil(() => harness.deferredWriterSettlementConsumed === true);
    expect(wakeups.some((wakeup) => wakeup.type === 'reset')).toBe(false);
    generationMaySettle.resolve();
    await waitUntil(() => wakeups.some((wakeup) => wakeup.type === 'reset'));
    const reset = wakeups.find((wakeup) => wakeup.type === 'reset');
    expect(reset.generation).toBeGreaterThan(initial.generation);
    expect(stalledWriter!.diagnostics().settled).toBe(true);
    expect(store.query({ code: 'database.hot_durability.failed' }).events)
      .toHaveLength(1);
    expect((await collectTenantSnapshot(binding, [])).generation).toBe(reset.generation);

    binding.release();
    await harness.coordinator.close();
  });

  test('retires at the oldest dirty-write deadline without another operation', async () => {
    for (const deadlineNow of [120, 121]) {
      let now = 0;
      const store = new MemoryEventStore();
      const harness = createHarness(roots, {
        now: () => now,
        observability: createDatabaseObservability({
          sink: store,
          store,
          config: { console: false, store },
        }),
        placement: {
          default: 'hot',
          hot: {
            durability: 'periodic',
            maxBytes: 8 * 1024 * 1024,
            snapshotIntervalMs: 20,
            snapshotTimeoutMs: 40,
          },
        },
      });
      const binding = await harness.coordinator.acquireTenantSync(
        `tenant-dirty-${deadlineNow}`,
      );
      const initial = await collectTenantSnapshot(binding, []);
      const wakeups: any[] = [];
      binding.onWakeup((wakeup) => wakeups.push(wakeup));
      const oldWriter = harness.executors.find((executor) => (
        executor.diagnostics().generation === initial.generation
      ));
      expect(oldWriter).toBeDefined();
      const generationMaySettle = deferred<void>();
      harness.deferNextWriterSettlement = generationMaySettle.promise;

      oldWriter!.markHotPeriodicDirty();
      oldWriter!.markHotPeriodicClean();
      now = 100;
      await Bun.sleep(25);
      expect(store.query({ code: 'database.hot_durability.failed' }).events)
        .toHaveLength(0);

      // This second dirty edge is never followed by another operation or a
      // covering clean signal. It owns a fresh absolute [100, 120] window.
      oldWriter!.markHotPeriodicDirty();
      now = 119;
      await Bun.sleep(25);
      expect(store.query({ code: 'database.hot_durability.failed' }).events)
        .toHaveLength(0);
      expect(wakeups.some((wakeup) => wakeup.type === 'reset')).toBe(false);

      now = deadlineNow;
      await waitUntil(() => harness.deferredWriterSettlementConsumed === true);
      expect(store.query({ code: 'database.hot_durability.failed' }).events)
        .toHaveLength(1);
      // Retirement cannot publish a replacement until exact old-generation
      // settlement, even though the dirty deadline itself has elapsed.
      expect(wakeups.some((wakeup) => wakeup.type === 'reset')).toBe(false);

      generationMaySettle.resolve();
      await waitUntil(() => wakeups.some((wakeup) => wakeup.type === 'reset'));
      expect(wakeups.find((wakeup) => wakeup.type === 'reset').generation)
        .toBeGreaterThan(initial.generation);

      binding.release();
      await harness.coordinator.close();
    }
  });

  test('selects hybrid placement from only an immutable opaque reference', async () => {
    const hotRef = createDatabaseRef('tenant-hot');
    const selectorContexts: unknown[] = [];
    const harness = createHarness(roots, {
      maxDatabases: 2,
      placement: {
        default: 'file',
        select: (context) => {
          selectorContexts.push(context);
          expect(Object.keys(context)).toEqual(['databaseRef']);
          expect(Object.isFrozen(context)).toBe(true);
          return context.databaseRef === hotRef ? 'hot' : 'file';
        },
        hot: {
          durability: 'periodic',
          maxBytes: 16 * 1024 * 1024,
          snapshotIntervalMs: 5_000,
        },
      },
    });

    const hot = await harness.coordinator.acquire('tenant-hot');
    const file = await harness.coordinator.acquire('tenant-file');
    expect(selectorContexts).toHaveLength(2);
    expect(harness.coordinator.diagnostics()).toMatchObject({
      fileDatabases: 1,
      hotDatabases: 1,
      openDatabases: 2,
    });
    expect(harness.binds.filter((bind) => bind.databaseRef === hot.databaseRef))
      .toEqual([{
        role: 'writer',
        databaseRef: hot.databaseRef,
        placement: {
          mode: 'hot',
          durability: 'periodic',
          maxBytes: 16 * 1024 * 1024,
          snapshotIntervalMs: 5_000,
          snapshotTimeoutMs: 120_000,
        },
      }]);
    expect(harness.binds.filter((bind) => bind.databaseRef === file.databaseRef))
      .toEqual([
        { role: 'writer', databaseRef: file.databaseRef, placement: { mode: 'file' } },
        { role: 'reader', databaseRef: file.databaseRef, placement: { mode: 'file' } },
      ]);

    hot.release();
    file.release();
    await harness.coordinator.close();
  });

  test('fails selector errors closed before filesystem or actor dispatch and restores capacity', async () => {
    let returnValidPlacement = false;
    const harness = createHarness(roots, {
      maxDatabases: 1,
      placement: {
        default: 'file',
        select: (() => (
          returnValidPlacement ? 'file' : Promise.resolve('hot')
        )) as never,
        hot: {
          durability: 'on-write',
          maxBytes: 1024,
        },
      },
    });

    const error = await captureDatabaseError(
      () => harness.coordinator.acquire('private-tenant'),
    );
    expect(error).toMatchObject({
      code: 'DATABASE_CONFIG_INVALID',
      retryable: false,
      outcome: 'not-started',
    });
    expect(JSON.stringify(error)).not.toContain('private-tenant');
    expect(JSON.stringify(error)).not.toContain(harness.root);
    expect(harness.executors).toHaveLength(0);
    expect(harness.coordinator.diagnostics()).toMatchObject({
      availableSlots: 1,
      openDatabases: 0,
    });

    returnValidPlacement = true;
    const lease = await harness.coordinator.acquire('private-tenant');
    expect(harness.coordinator.diagnostics().fileDatabases).toBe(1);
    lease.release();
    await harness.coordinator.close();
  });

  test('pins placement through recovery and re-evaluates it only after clean eviction', async () => {
    let placement: 'hot' | 'file' = 'hot';
    let selectorCalls = 0;
    const harness = createHarness(roots, {
      placement: {
        default: 'file',
        select: () => {
          selectorCalls += 1;
          return placement;
        },
        hot: {
          durability: 'on-write',
          maxBytes: 1024 * 1024,
        },
      },
    });
    const lease = await harness.coordinator.acquire('tenant-a');
    const initialGeneration = harness.coordinator
      .diagnostics().databases[0]!.writerGeneration;
    placement = 'file';
    let failOnce = true;
    harness.onOperation = ({ role }) => {
      if (role === 'writer' && failOnce) {
        failOnce = false;
        throw new DatabaseError(
          'DATABASE_EXECUTOR_FAILED',
          'Actor stopped.',
          { retryable: false, outcome: null },
        );
      }
    };

    await expect(captureCode(() => lease.execute({
      type: 'get', table: 'todos', id: 'recovery',
      consistency: { mode: 'snapshot' },
    }))).resolves.toBe('DATABASE_EXECUTOR_FAILED');
    await waitUntil(() => {
      const current = harness.coordinator.diagnostics().databases[0];
      return current?.state === 'ready'
        && current.writerGeneration !== initialGeneration;
    });
    expect(selectorCalls).toBe(1);
    expect(harness.coordinator.diagnostics()).toMatchObject({
      fileDatabases: 0,
      hotDatabases: 1,
    });

    harness.onOperation = undefined;
    lease.release();
    expect(await harness.coordinator.evict('tenant-a')).toBe(true);
    const reopened = await harness.coordinator.acquire('tenant-a');
    expect(selectorCalls).toBe(2);
    expect(harness.coordinator.diagnostics()).toMatchObject({
      fileDatabases: 1,
      hotDatabases: 0,
    });
    const reopenedDiagnostic = harness.coordinator.diagnostics().databases[0]!;
    expect(reopenedDiagnostic.readerGeneration).not.toBeNull();

    reopened.release();
    await harness.coordinator.close();
  });

  test('rejects invalid direct coordinator placement policies synchronously', () => {
    const root = realpathSync.native(
      mkdtempSync(join(tmpdir(), 'zero-database-coordinator-invalid-placement-')),
    );
    roots.push(root);
    for (const placement of [
      null,
      { default: 'hot', hot: null },
      { default: 'file', select: () => 'file', hot: null },
      { default: 'file', hot: { durability: 'periodic', maxBytes: 1 } },
      { default: 'file', hot: { durability: 'periodic', maxBytes: 1, snapshotIntervalMs: 2_147_483_648 } },
      { default: 'file', hot: { durability: 'final', maxBytes: 1, snapshotIntervalMs: 1 } },
      { default: 'file', hot: null, typo: true },
    ]) {
      const error = captureSynchronousError(() => new DatabaseCoordinator({
        rootDirectory: root,
        realm,
        placement: placement as never,
        createExecutor: () => { throw new Error('must not run'); },
      }));
      expect(error.code).toBe('DATABASE_CONFIG_INVALID');
      expect(error.outcome).toBe('not-started');
    }
  });

  test('observes a rejecting async placement selector and fails before file reservation', async () => {
    const root = realpathSync.native(
      mkdtempSync(join(tmpdir(), 'zero-database-coordinator-async-placement-')),
    );
    roots.push(root);
    const coordinator = new DatabaseCoordinator({
      rootDirectory: root,
      realm,
      placement: {
        default: 'file',
        select: (() => Promise.reject(new Error('private selector failure'))) as never,
        hot: {
          durability: 'on-write',
          maxBytes: 1_048_576,
        },
      },
      createExecutor: () => { throw new Error('must not run'); },
      sweepIntervalMs: false,
    });
    coordinator.start();

    const error = await captureDatabaseError(
      () => coordinator.acquire('private-tenant'),
    );
    expect(error).toMatchObject({
      code: 'DATABASE_CONFIG_INVALID',
      retryable: false,
      outcome: 'not-started',
    });
    expect(JSON.stringify(error)).not.toContain('private selector failure');
    expect(readdirSync(root).filter((entry) => entry.endsWith('.sqlite'))).toEqual([]);
    await coordinator.close();
  });

  test('validates direct physical-file and tenant Sync capacity limits', () => {
    const root = realpathSync.native(
      mkdtempSync(join(tmpdir(), 'zero-database-coordinator-invalid-capacity-')),
    );
    roots.push(root);
    for (const options of [
      { maxDatabases: DATABASE_COORDINATOR_MAX_DATABASES + 1 },
      { maxDatabaseFiles: 0 },
      { maxDatabaseFiles: 2_147_483_648 },
      { maxBlockedDatabases: 2_147_483_648 },
      { maxTenantSyncDatabases: -1 },
      { maxTenantSyncBindingsPerDatabase: 0 },
      { maxTenantSyncBindingsPerDatabase: 2_147_483_648 },
      { maxQueuedPerDatabase: 2_147_483_648 },
      { maxQueuedTotal: 2_147_483_648 },
      { maxDatabases: 1, maxTenantSyncDatabases: 2 },
      { restart: { typo: 1 } },
      { restart: { initialDelayMs: 20, maxDelayMs: 10 } },
      { restart: { circuitFailureThreshold: 1 } },
      { restart: { maxDelayMs: 100, circuitCooldownMs: 50 } },
      { readers: 'yes' },
      { sqlite: { ringBufferDepth: 0 } },
    ]) {
      const error = captureSynchronousError(() => new DatabaseCoordinator({
        rootDirectory: root,
        realm,
        ...(options as any),
        createExecutor: () => { throw new Error('must not run'); },
      }));
      expect(error).toMatchObject({
        code: 'DATABASE_CONFIG_INVALID',
        retryable: false,
        outcome: 'not-started',
      });
    }
  });

  test('bounds direct coordinator and per-operation timer intervals', async () => {
    const root = realpathSync.native(
      mkdtempSync(join(tmpdir(), 'zero-database-coordinator-timer-bounds-')),
    );
    roots.push(root);
    for (const field of [
      'queueTimeoutMs',
      'operationTimeoutMs',
      'sweepIntervalMs',
    ] as const) {
      expect(() => new DatabaseCoordinator({
        rootDirectory: root,
        realm,
        [field]: MAX_RUNTIME_TIMER_INTERVAL_MS,
        createExecutor: () => { throw new Error('must not run'); },
      })).not.toThrow();
      const error = captureSynchronousError(() => new DatabaseCoordinator({
        rootDirectory: root,
        realm,
        [field]: MAX_RUNTIME_TIMER_INTERVAL_MS + 1,
        createExecutor: () => { throw new Error('must not run'); },
      }));
      expect(error).toMatchObject({
        code: 'DATABASE_CONFIG_INVALID',
        outcome: 'not-started',
      });
      expect(error.message).toBe(
        `Database ${field} must not exceed ${MAX_RUNTIME_TIMER_INTERVAL_MS}.`,
      );
    }

    const harness = createHarness(roots);
    const lease = await harness.coordinator.acquire('tenant-timer-bounds');
    const operation = {
      type: 'get' as const,
      table: 'todos',
      id: 'one',
      consistency: { mode: 'strong' as const },
    };
    await expect(lease.execute(operation, {
      queueTimeoutMs: MAX_RUNTIME_TIMER_INTERVAL_MS,
      operationTimeoutMs: MAX_RUNTIME_TIMER_INTERVAL_MS,
    })).resolves.toBeDefined();

    for (const field of ['queueTimeoutMs', 'operationTimeoutMs'] as const) {
      const result = Promise.resolve().then(() => lease.execute(operation, {
        [field]: MAX_RUNTIME_TIMER_INTERVAL_MS + 1,
      }));
      const error = await result.catch((caught) => caught);
      expect(error).toMatchObject({
        code: 'DATABASE_CONFIG_INVALID',
        retryable: false,
        outcome: 'not-started',
      });
    }

    lease.release();
    await harness.coordinator.close();
  });

  test('rejects a second coordinator for the same physical root', async () => {
    const harness = createHarness(roots);
    const events = new MemoryEventStore();
    const contender = new DatabaseCoordinator({
      rootDirectory: harness.root,
      realm,
      sweepIntervalMs: false,
      observability: createDatabaseObservability({
        sink: events,
        store: events,
        config: { console: false, store: events },
      }),
      createExecutor: () => {
        throw new Error('Executor must not be created during coordinator start.');
      },
    });
    expect(captureSynchronousError(() => contender.start()).code).toBe(
      'DATABASE_CONFLICT',
    );
    expect(events.query({ code: 'database.coordinator.failed' }).events)
      .toHaveLength(1);
    expect(events.query({ code: 'database.coordinator.failed' }).events[0]?.metadata)
      .toMatchObject({
        phase: 'start',
        errorCode: 'DATABASE_CONFLICT',
        retryable: true,
        outcome: 'not-started',
      });

    await harness.coordinator.close();
    contender.start();
    await contender.close();
  });

  test('pins the owned canonical root when a configured alias is retargeted', async () => {
    const base = realpathSync.native(
      mkdtempSync(join(tmpdir(), 'zero-database-coordinator-root-pin-')),
    );
    roots.push(base);
    const firstAncestor = join(base, 'first');
    const secondAncestor = join(base, 'second');
    const alias = join(base, 'active');
    mkdirSync(firstAncestor);
    mkdirSync(secondAncestor);
    symlinkSync(firstAncestor, alias, 'dir');
    const configuredRoot = join(alias, 'nested', 'databases');
    const pinnedRoot = join(firstAncestor, 'nested', 'databases');
    const retargetedRoot = join(secondAncestor, 'nested', 'databases');
    const harness = createHarness(roots, { rootDirectory: configuredRoot });

    unlinkSync(alias);
    symlinkSync(secondAncestor, alias, 'dir');
    const lease = await harness.coordinator.acquire('tenant-root-pin');
    expect(readdirSync(pinnedRoot).filter((entry) => entry.endsWith('.sqlite')))
      .toHaveLength(1);
    expect(existsSync(retargetedRoot)).toBe(false);

    lease.release();
    await harness.coordinator.close();
  });

  test('fails closed instead of writing after the owned root inode is replaced', async () => {
    const harness = createHarness(roots);
    const movedRoot = `${harness.root}-moved`;
    renameSync(harness.root, movedRoot);
    roots.push(movedRoot);
    mkdirSync(harness.root);

    const error = await captureDatabaseError(
      () => harness.coordinator.acquire('tenant-replaced-root'),
    );
    expect(error).toMatchObject({
      code: 'DATABASE_CONFLICT',
      retryable: false,
      outcome: 'not-started',
    });
    expect(readdirSync(harness.root)).toEqual([]);
    await harness.coordinator.close();
  });
});

interface HarnessOptions {
  rootDirectory?: string;
  maxDatabases?: number;
  maxDatabaseFiles?: number;
  maxBlockedDatabases?: number;
  maxTenantSyncDatabases?: number;
  maxTenantSyncBindingsPerDatabase?: number;
  maxQueuedPerDatabase?: number;
  maxQueuedTotal?: number;
  queueTimeoutMs?: number;
  restart?: DatabaseCoordinatorRestartPolicy;
  fixedExecutorGenerations?: boolean;
  authorityCommitCoordinator?: AuthorityCommitCoordinator;
  requireCommitAuthority?: boolean;
  observability?: DatabaseObservability;
  placement?: DatabasePlacementPolicy;
  omitWriterEventListener?: boolean;
  now?: () => number;
}

interface OperationHookInput {
  role: 'writer' | 'reader';
  databaseRef: string;
  operation: any;
}

function createHarness(roots: string[], options: HarnessOptions = {}) {
  const root = options.rootDirectory ?? realpathSync.native(
    mkdtempSync(join(tmpdir(), 'zero-database-coordinator-')),
  );
  if (!options.rootDirectory) roots.push(root);
  const harness: {
    root: string;
    coordinator: DatabaseCoordinator;
    onOperation?: (input: OperationHookInput) => void | Promise<void>;
    bindFailureOnce?: {
      role: 'writer' | 'reader';
      error: DatabaseError;
    };
    bindFailuresRemaining?: {
      role: 'writer' | 'reader';
      error: DatabaseError;
      remaining: number;
    };
    malformedReplayOnce?: boolean;
    replayGapOnce?: { afterSeq: number; currentSeq: number };
    blockNextWriterClose?: Promise<void>;
    blockWriterClose?: Promise<void>;
    blockedWriterCloseConsumed?: boolean;
    blockNextWriterBind?: Promise<void>;
    blockedWriterBindConsumed?: boolean;
    deferNextWriterSettlement?: Promise<void>;
    deferredWriterSettlementConsumed?: boolean;
    deferNextUnboundWriterSettlement?: Promise<void>;
    deferredUnboundWriterSettlementConsumed?: boolean;
    failWriterClosePermanently?: boolean;
    bindPlacementOverrideOnce?: DatabaseActorPlacementConfig;
    binds: Array<{
      role: 'writer' | 'reader';
      databaseRef: string;
      placement: DatabaseActorPlacementConfig;
    }>;
    sequences: Map<string, number>;
    executors: FakeExecutor[];
    fixedExecutorGenerations: boolean;
    receiptCompactionOnce?: {
      totalKeys: number;
      retainedResults: number;
      expiredTombstones: number;
      retainedResultBytes: number;
      keyLimit: number;
      prunedCount: number;
      prunedResultBytes: number;
      retainedLimit: number;
      retainedByteLimit: number;
      resultByteLimit: number;
    };
  } = {
    root,
    coordinator: null as unknown as DatabaseCoordinator,
    sequences: new Map(),
    executors: [],
    binds: [],
    fixedExecutorGenerations: options.fixedExecutorGenerations ?? false,
  };
  harness.coordinator = new DatabaseCoordinator({
    rootDirectory: root,
    realm,
    maxDatabases: options.maxDatabases,
    maxDatabaseFiles: options.maxDatabaseFiles,
    maxBlockedDatabases: options.maxBlockedDatabases,
    maxTenantSyncDatabases: options.maxTenantSyncDatabases,
    maxTenantSyncBindingsPerDatabase:
      options.maxTenantSyncBindingsPerDatabase,
    maxQueuedPerDatabase: options.maxQueuedPerDatabase,
    maxQueuedTotal: options.maxQueuedTotal,
    queueTimeoutMs: options.queueTimeoutMs,
    restart: options.restart,
    authorityCommitCoordinator: options.authorityCommitCoordinator,
    requireCommitAuthority: options.requireCommitAuthority,
    observability: options.observability,
    placement: options.placement,
    now: options.now,
    sweepIntervalMs: false,
    createExecutor: (context) => {
      const executor = new FakeExecutor(context, harness);
      if (context.role === 'writer' && options.omitWriterEventListener) {
        Object.defineProperty(executor, 'setEventListener', {
          configurable: true,
          value: undefined,
        });
      }
      return executor;
    },
  });
  harness.coordinator.start();
  return harness;
}

let nextGeneration = 1;

class FakeExecutor implements DatabaseExecutor {
  private state: DatabaseExecutorState = 'created';
  private boundRef: string | null = null;
  private settlement = deferred<void>();
  private inFlight = 0;
  private isSettled = false;
  private deferredSettlementPending = false;
  private lastFailureCode: DatabaseError['code'] | null = null;
  private readonly generation: number;
  private eventListener: DatabaseExecutorEventListener | null = null;
  private readonly snapshotSessions = new Map<string, {
    readonly ownerToken: string;
    readonly generation: number;
    readonly tables: readonly string[];
    readonly rows: readonly any[];
  }>();

  constructor(
    private readonly context: DatabaseExecutorFactoryContext,
    private readonly harness: ReturnType<typeof createHarness>,
  ) {
    this.generation = harness.fixedExecutorGenerations
      ? (context.role === 'writer' ? 1 : 2)
      : nextGeneration++;
    harness.executors.push(this);
  }

  async start(): Promise<void> {
    this.state = 'ready';
  }

  setEventListener(listener: DatabaseExecutorEventListener): void {
    expect(this.state).toBe('created');
    expect(this.eventListener).toBeNull();
    this.eventListener = listener;
  }

  failHotPeriodicDurability(): void {
    this.state = 'failed';
    this.lastFailureCode = 'DATABASE_EXECUTOR_FAILED';
    this.eventListener?.(Object.freeze({
      type: 'hot-periodic-durability-failed',
    }));
  }

  startHotPeriodicSnapshot(): void {
    this.eventListener?.(Object.freeze({
      type: 'hot-periodic-snapshot-started',
    }));
  }

  finishHotPeriodicSnapshot(): void {
    this.eventListener?.(Object.freeze({
      type: 'hot-periodic-snapshot-finished',
    }));
  }

  markHotPeriodicDirty(): void {
    this.eventListener?.(Object.freeze({
      type: 'hot-periodic-durability-dirty',
    }));
  }

  markHotPeriodicClean(): void {
    this.eventListener?.(Object.freeze({
      type: 'hot-periodic-durability-clean',
    }));
  }

  async execute<
    Result extends DatabaseExecutorValue = DatabaseExecutorValue,
    Payload extends DatabaseExecutorValue = DatabaseExecutorValue,
  >(
    request: DatabaseExecutorRequest<Payload>,
    _options?: DatabaseExecutorExecuteOptions,
  ): Promise<Result> {
    if (this.state !== 'ready') {
      throw new DatabaseError('DATABASE_CLOSED', 'Fake executor is closed.');
    }
    this.inFlight += 1;
    try {
      const payload = request.payload as any;
      if (request.operation === DATABASE_ACTOR_OPERATIONS.bindWriter
        || request.operation === DATABASE_ACTOR_OPERATIONS.bindReader) {
        if (this.context.role === 'writer'
          && this.harness.blockNextWriterBind
          && !this.harness.blockedWriterBindConsumed) {
          this.harness.blockedWriterBindConsumed = true;
          await this.harness.blockNextWriterBind;
        }
        if (this.harness.bindFailureOnce?.role === this.context.role) {
          const failure = this.harness.bindFailureOnce.error;
          this.harness.bindFailureOnce = undefined;
          throw failure;
        }
        if (this.harness.bindFailuresRemaining?.role === this.context.role
          && this.harness.bindFailuresRemaining.remaining > 0) {
          this.harness.bindFailuresRemaining.remaining -= 1;
          throw this.harness.bindFailuresRemaining.error;
        }
        this.boundRef = payload.databaseRef;
        const placement = this.harness.bindPlacementOverrideOnce ?? payload.placement;
        this.harness.bindPlacementOverrideOnce = undefined;
        this.harness.binds.push({
          role: this.context.role,
          databaseRef: this.boundRef!,
          placement: payload.placement,
        });
        this.harness.sequences.set(
          this.boundRef!,
          this.harness.sequences.get(this.boundRef!) ?? 0,
        );
        return {
          databaseRef: this.boundRef,
          role: this.context.role,
          fileIdentity: payload.fileIdentity,
          instanceId: payload.instanceId,
          placement,
          realmFingerprint: realm.fingerprint,
          schemaChecksum: realm.schemaChecksum,
          sequence: { seq: this.harness.sequences.get(this.boundRef!)! },
          syncEpoch: this.context.role === 'writer'
            ? `epoch-${this.generation}`
            : null,
        } as unknown as Result;
      }
      if (!this.boundRef || payload.databaseRef !== this.boundRef) {
        throw new DatabaseError('DATABASE_PROTOCOL_ERROR', 'Fake binding mismatch.');
      }
      if (request.operation === DATABASE_ACTOR_OPERATIONS.replay) {
        if (this.harness.replayGapOnce) {
          const gap = this.harness.replayGapOnce;
          this.harness.replayGapOnce = undefined;
          throw new DatabaseError(
            'DATABASE_HISTORY_GAP',
            'Fake replay history is unavailable.',
            { details: gap },
          );
        }
        if (this.harness.malformedReplayOnce) {
          this.harness.malformedReplayOnce = false;
          return {
            value: {
              afterSeq: payload.afterSeq,
              throughSeq: payload.afterSeq + 1,
              nextAfterSeq: null,
              changes: [],
            },
            sequence: { seq: payload.afterSeq },
          } as unknown as Result;
        }
        const seq = this.harness.sequences.get(this.boundRef) ?? 0;
        return {
          value: {
            afterSeq: payload.afterSeq,
            throughSeq: payload.afterSeq,
            nextAfterSeq: null,
            changes: [],
          },
          sequence: { seq },
        } as unknown as Result;
      }
      if (request.operation === DATABASE_ACTOR_OPERATIONS.tenantSyncSnapshotBegin) {
        const sessionId = crypto.randomUUID().toLowerCase();
        const tableIndex = payload.tables.indexOf('todos');
        const rows = tableIndex < 0 ? [] : [{
          ordinal: 0,
          tableIndex,
          rowId: 'snapshot',
          row: { id: 'snapshot', title: 'snapshot' },
        }];
        this.snapshotSessions.set(sessionId, {
          ownerToken: payload.ownerToken,
          generation: payload.generation,
          tables: [...payload.tables],
          rows,
        });
        const seq = this.harness.sequences.get(this.boundRef) ?? 0;
        return {
          sessionId,
          syncEpoch: `epoch-${this.generation}`,
          sequence: { seq },
          tables: payload.tables,
          totalRows: rows.length,
          totalSourceBytes: new TextEncoder().encode(JSON.stringify(rows)).byteLength,
          expiresAt: Date.now() + 30_000,
        } as unknown as Result;
      }
      if (request.operation === DATABASE_ACTOR_OPERATIONS.tenantSyncSnapshotPage) {
        const session = this.snapshotSessions.get(payload.sessionId);
        if (!session
          || session.ownerToken !== payload.ownerToken
          || session.generation !== payload.generation
          || JSON.stringify(session.tables) !== JSON.stringify(payload.tables)) {
          throw new DatabaseError(
            'DATABASE_AUTHORITY_CHANGED',
            'Fake snapshot session changed.',
          );
        }
        const rows = session.rows.slice(payload.cursor, payload.cursor + 100);
        const next = payload.cursor + rows.length;
        return {
          sessionId: payload.sessionId,
          cursor: payload.cursor,
          rows,
          nextCursor: next === session.rows.length ? null : next,
        } as unknown as Result;
      }
      if (request.operation === DATABASE_ACTOR_OPERATIONS.tenantSyncSnapshotAbort) {
        const session = this.snapshotSessions.get(payload.sessionId);
        if (session
          && (session.ownerToken !== payload.ownerToken
            || session.generation !== payload.generation
            || JSON.stringify(session.tables) !== JSON.stringify(payload.tables))) {
          throw new DatabaseError(
            'DATABASE_AUTHORITY_CHANGED',
            'Fake snapshot session changed.',
          );
        }
        return {
          aborted: this.snapshotSessions.delete(payload.sessionId),
        } as unknown as Result;
      }
      if (request.operation !== DATABASE_ACTOR_OPERATIONS.execute) {
        throw new DatabaseError('DATABASE_OPERATION_UNSUPPORTED', 'Fake operation unsupported.');
      }
      const operation = payload.operation;
      await this.harness.onOperation?.({
        role: this.context.role,
        databaseRef: this.boundRef,
        operation,
      });
      if (request.kind === 'write') {
        const sequence = (this.harness.sequences.get(this.boundRef) ?? 0) + 1;
        this.harness.sequences.set(this.boundRef, sequence);
        const result = {
          value: fakeWriteValue(operation, sequence),
          sequence: { seq: sequence },
          idempotencyKey: operation.idempotencyKey,
          replayed: false,
        };
        const receiptCompaction = this.harness.receiptCompactionOnce;
        this.harness.receiptCompactionOnce = undefined;
        return (receiptCompaction
          ? { result, receiptCompaction }
          : result) as unknown as Result;
      }
      const readSequence = operation.consistency?.mode === 'read-your-writes'
        ? Math.max(
          this.harness.sequences.get(this.boundRef) ?? 0,
          operation.consistency.minSeq.seq,
        )
        : (this.harness.sequences.get(this.boundRef) ?? 0);
      return {
        value: operation.type === 'find'
          ? [Object.fromEntries(
              (operation.select ?? ['id', 'title'])
                .map((field: string) => [field, this.context.role]),
            )]
          : { actor: this.context.role },
        sequence: { seq: readSequence },
      } as unknown as Result;
    } catch (error) {
      if (error instanceof DatabaseError) {
        this.lastFailureCode = error.code;
        if (error.code === 'DATABASE_EXECUTOR_FAILED') this.state = 'failed';
      }
      throw error;
    } finally {
      this.inFlight -= 1;
    }
  }

  settled(): Promise<void> {
    return this.settlement.promise;
  }

  activeSnapshotSessions(): number {
    return this.snapshotSessions.size;
  }

  async close(): Promise<void> {
    if (this.isSettled) return;
    if (this.deferredSettlementPending) {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Fake executor settlement is pending.',
        { retryable: false, outcome: 'unknown' },
      );
    }
    if (this.context.role === 'writer'
      && this.harness.blockNextWriterClose
      && !this.harness.blockedWriterCloseConsumed) {
      this.harness.blockedWriterCloseConsumed = true;
      await this.harness.blockNextWriterClose;
    }
    if (this.context.role === 'writer' && this.harness.blockWriterClose) {
      this.harness.blockedWriterCloseConsumed = true;
      await this.harness.blockWriterClose;
    }
    if (this.context.role === 'writer'
      && this.harness.failWriterClosePermanently) {
      this.settle();
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Fake final durability boundary failed.',
        { retryable: false, outcome: 'unknown' },
      );
    }
    if (this.context.role === 'writer'
      && this.harness.deferNextWriterSettlement
      && !this.harness.deferredWriterSettlementConsumed) {
      this.harness.deferredWriterSettlementConsumed = true;
      this.deferredSettlementPending = true;
      this.state = 'quarantined';
      void this.harness.deferNextWriterSettlement.then(() => this.settle());
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Fake executor settlement is pending.',
        { retryable: false, outcome: 'unknown' },
      );
    }
    if (this.context.role === 'writer'
      && this.boundRef === null
      && this.harness.deferNextUnboundWriterSettlement
      && !this.harness.deferredUnboundWriterSettlementConsumed) {
      this.harness.deferredUnboundWriterSettlementConsumed = true;
      this.deferredSettlementPending = true;
      this.state = 'quarantined';
      void this.harness.deferNextUnboundWriterSettlement.then(() => this.settle());
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Fake executor settlement is pending.',
        { retryable: false, outcome: 'unknown' },
      );
    }
    this.settle();
  }

  diagnostics(): DatabaseExecutorDiagnostics {
    return {
      state: this.state,
      slot: this.context.slot,
      generation: this.generation,
      inFlight: this.inFlight,
      maxInFlight: 64,
      disconnectObserved: false,
      exitObserved: this.isSettled,
      settled: this.isSettled,
      exitCode: this.isSettled ? 0 : null,
      signalCode: null,
      lastFailureCode: this.lastFailureCode,
    };
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private settle(): void {
    if (this.isSettled) return;
    this.deferredSettlementPending = false;
    this.state = 'closed';
    this.isSettled = true;
    this.settlement.resolve();
  }
}

function createTodo(id: string) {
  return {
    type: 'mutate',
    idempotencyKey: `write:${id}`,
    mutation: { type: 'create', table: 'todos', row: { id, title: id } },
  };
}

function fakeWriteValue(operation: any, sequence: number) {
  if (operation.type === 'mutate') {
    const mutation = operation.mutation;
    const rowId = mutation.type === 'create' || mutation.type === 'upsert'
      ? mutation.row.id
      : mutation.id;
    return {
      kind: 'mutation',
      mutation: {
        type: mutation.type,
        table: mutation.table,
        rowId,
        changed: true,
        op: mutation.type === 'delete'
          ? 'DELETE'
          : mutation.type === 'update'
            ? 'UPDATE'
            : 'INSERT',
        sequence: { seq: sequence },
        row: mutation.type === 'delete'
          ? null
          : mutation.type === 'update'
            ? { id: rowId, title: mutation.patch.title ?? rowId }
            : { id: rowId, title: mutation.row.title },
        previousRow: mutation.type === 'update' || mutation.type === 'delete'
          ? { id: rowId, title: rowId }
          : null,
      },
    };
  }
  if (operation.type === 'batch') {
    return {
      kind: 'batch',
      mutations: operation.mutations.map((mutation: any, index: number) => ({
        type: mutation.type,
        table: mutation.table,
        rowId: mutation.type === 'create' || mutation.type === 'upsert'
          ? mutation.row.id
          : mutation.id,
        changed: true,
        op: mutation.type === 'delete'
          ? 'DELETE'
          : mutation.type === 'update'
            ? 'UPDATE'
            : 'INSERT',
        sequence: {
          seq: sequence - operation.mutations.length + index + 1,
        },
        row: mutation.type === 'delete'
          ? null
          : mutation.type === 'update'
            ? { id: mutation.id, title: mutation.patch.title ?? mutation.id }
            : { id: mutation.row.id, title: mutation.row.title },
        previousRow: mutation.type === 'update' || mutation.type === 'delete'
          ? { id: mutation.id, title: mutation.id }
          : null,
      })),
    };
  }
  return { kind: 'command', name: operation.name, output: null };
}

async function collectTenantSnapshot(
  binding: DatabaseTenantSyncBinding,
  tables: readonly string[],
) {
  const session = await binding.beginSnapshot(tables);
  const rowsByTable: Record<string, unknown[]> = Object.fromEntries(
    tables.map((table) => [table, []]),
  );
  try {
    let cursor = 0;
    while (true) {
      const page = await session.page(cursor);
      for (const entry of page.rows) {
        rowsByTable[tables[entry.tableIndex]!]!.push(entry.row);
      }
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    return {
      databaseRef: session.databaseRef,
      generation: session.generation,
      syncEpoch: session.syncEpoch,
      sequence: session.sequence,
      tables: rowsByTable,
    };
  } finally {
    await session.abort();
  }
}

async function captureCode(
  operation: () => unknown | Promise<unknown>,
): Promise<string> {
  return (await captureDatabaseError(operation)).code;
}

async function captureDatabaseError(
  operation: () => unknown | Promise<unknown>,
): Promise<DatabaseError> {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
  throw new Error('Expected DatabaseError.');
}

function captureSynchronousError(operation: () => unknown): DatabaseError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
  throw new Error('Expected DatabaseError.');
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate() && Date.now() < deadline) await Bun.sleep(1);
  expect(predicate()).toBe(true);
}
