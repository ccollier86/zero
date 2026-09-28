import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DATABASE_ACTOR_OPERATIONS } from './database-actor-protocol';
import { AuthorityCommitCoordinator } from './authority-commit-coordinator';
import { createDatabaseCommitAuthority } from './database-commit-authority';
import {
  DatabaseCoordinator,
  type DatabaseExecutorFactoryContext,
} from './database-coordinator';
import { DatabaseError } from './database-error';
import type {
  DatabaseExecutor,
  DatabaseExecutorDiagnostics,
  DatabaseExecutorExecuteOptions,
  DatabaseExecutorRequest,
  DatabaseExecutorValue,
  DatabaseExecutorState,
} from './database-executor';
import { defineDatabaseRealm } from './database-realm';

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

  test('rejects a second coordinator for the same physical root', async () => {
    const harness = createHarness(roots);
    const contender = new DatabaseCoordinator({
      rootDirectory: harness.root,
      realm,
      sweepIntervalMs: false,
      createExecutor: () => {
        throw new Error('Executor must not be created during coordinator start.');
      },
    });
    expect(captureSynchronousError(() => contender.start()).code).toBe(
      'DATABASE_CONFLICT',
    );

    await harness.coordinator.close();
    contender.start();
    await contender.close();
  });
});

interface HarnessOptions {
  maxDatabases?: number;
  maxBlockedDatabases?: number;
  maxQueuedPerDatabase?: number;
  maxQueuedTotal?: number;
  queueTimeoutMs?: number;
  fixedExecutorGenerations?: boolean;
  authorityCommitCoordinator?: AuthorityCommitCoordinator;
  requireCommitAuthority?: boolean;
}

interface OperationHookInput {
  role: 'writer' | 'reader';
  databaseRef: string;
  operation: any;
}

function createHarness(roots: string[], options: HarnessOptions = {}) {
  const root = realpathSync.native(
    mkdtempSync(join(tmpdir(), 'zero-database-coordinator-')),
  );
  roots.push(root);
  const harness: {
    root: string;
    coordinator: DatabaseCoordinator;
    onOperation?: (input: OperationHookInput) => void | Promise<void>;
    bindFailureOnce?: {
      role: 'writer' | 'reader';
      error: DatabaseError;
    };
    malformedReplayOnce?: boolean;
    blockNextWriterClose?: Promise<void>;
    blockedWriterCloseConsumed?: boolean;
    blockNextWriterBind?: Promise<void>;
    blockedWriterBindConsumed?: boolean;
    deferNextWriterSettlement?: Promise<void>;
    deferredWriterSettlementConsumed?: boolean;
    deferNextUnboundWriterSettlement?: Promise<void>;
    deferredUnboundWriterSettlementConsumed?: boolean;
    sequences: Map<string, number>;
    executors: FakeExecutor[];
    fixedExecutorGenerations: boolean;
  } = {
    root,
    coordinator: null as unknown as DatabaseCoordinator,
    sequences: new Map(),
    executors: [],
    fixedExecutorGenerations: options.fixedExecutorGenerations ?? false,
  };
  harness.coordinator = new DatabaseCoordinator({
    rootDirectory: root,
    realm,
    maxDatabases: options.maxDatabases,
    maxBlockedDatabases: options.maxBlockedDatabases,
    maxQueuedPerDatabase: options.maxQueuedPerDatabase,
    maxQueuedTotal: options.maxQueuedTotal,
    queueTimeoutMs: options.queueTimeoutMs,
    authorityCommitCoordinator: options.authorityCommitCoordinator,
    requireCommitAuthority: options.requireCommitAuthority,
    sweepIntervalMs: false,
    createExecutor: (context) => new FakeExecutor(context, harness),
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
        this.boundRef = payload.databaseRef;
        this.harness.sequences.set(
          this.boundRef!,
          this.harness.sequences.get(this.boundRef!) ?? 0,
        );
        return {
          databaseRef: this.boundRef,
          role: this.context.role,
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
        return {
          value: fakeWriteValue(operation, sequence),
          sequence: { seq: sequence },
          idempotencyKey: operation.idempotencyKey,
          replayed: false,
        } as unknown as Result;
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
      })),
    };
  }
  return { kind: 'command', name: operation.name, output: null };
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
