import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEventStore } from '../observability/memory-event-store';
import {
  DATABASE_ACTOR_OPERATIONS,
} from './database-actor-protocol';
import {
  DatabaseCoordinator,
  type DatabaseExecutorFactoryContext,
} from './database-coordinator';
import { DatabaseError } from './database-error';
import type {
  DatabaseExecutor,
  DatabaseExecutorDiagnostics,
  DatabaseExecutorEventListener,
  DatabaseExecutorExecuteOptions,
  DatabaseExecutorRequest,
  DatabaseExecutorValue,
  DatabaseExecutorState,
} from './database-executor';
import {
  createDatabaseObservability,
  type DatabaseObservability,
} from './database-observability';
import { defineDatabaseRealm } from './database-realm';

const realm = defineDatabaseRealm({
  name: 'coordinator-executor-boundary-tests',
  version: '1',
  tables: {
    todos: {
      id: 'text primary key',
      title: 'text not null',
    },
  },
});

interface ExecutorBehavior {
  readonly malformedFirstDiagnostics?: boolean;
  readonly mutateSecondGeneration?: boolean;
  readonly throwEventListener?: boolean;
  readonly failReadinessAfterBind?: boolean;
  readonly failClose?: boolean;
  readonly singleReadRequiredMethods?: boolean;
  readonly emitDuringListenerRegistration?: boolean;
}

describe('DatabaseCoordinator executor boundary', () => {
  const roots: string[] = [];
  const coordinators: DatabaseCoordinator[] = [];

  afterEach(async () => {
    for (const coordinator of coordinators.splice(0)) {
      await coordinator.close().catch(() => undefined);
    }
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('normalizes malformed startup diagnostics and restores a settled slot', async () => {
    const harness = createBoundaryHarness(roots, coordinators, () => ({
      malformedFirstDiagnostics: true,
    }));

    const error = await captureDatabaseError(
      () => harness.coordinator.acquire('tenant-malformed-diagnostics'),
    );

    expect(error).toMatchObject({
      code: 'DATABASE_EXECUTOR_START_FAILED',
      retryable: false,
      outcome: 'not-started',
    });
    expect(harness.coordinator.diagnostics()).toMatchObject({
      openDatabases: 0,
      availableSlots: 1,
      quarantinedSlots: 0,
      databases: [],
    });
  });

  test('pins executor identity across every diagnostics read', async () => {
    const harness = createBoundaryHarness(roots, coordinators, () => ({
      mutateSecondGeneration: true,
    }));

    const error = await captureDatabaseError(
      () => harness.coordinator.acquire('tenant-mutated-generation'),
    );

    expect(error).toMatchObject({
      code: 'DATABASE_PROTOCOL_ERROR',
      retryable: false,
      outcome: 'unknown',
    });
    expect(harness.coordinator.diagnostics()).toMatchObject({
      availableSlots: 1,
      quarantinedSlots: 0,
      databases: [],
    });
  });

  test('captures required executor methods once at the factory boundary', async () => {
    const harness = createBoundaryHarness(roots, coordinators, () => ({
      singleReadRequiredMethods: true,
    }));
    const lease = await harness.coordinator.acquire('tenant-method-pinning');

    await expect(lease.execute({
      type: 'get',
      table: 'todos',
      id: 'one',
      consistency: { mode: 'strong' },
    })).resolves.toMatchObject({ value: { actor: 'writer' } });

    lease.release();
    await expect(harness.coordinator.close()).resolves.toBeUndefined();
  });

  test('classifies event-listener registration exceptions as start failures', async () => {
    const harness = createBoundaryHarness(roots, coordinators, () => ({
      throwEventListener: true,
    }));

    const error = await captureDatabaseError(
      () => harness.coordinator.acquire('tenant-listener-failure'),
    );

    expect(error).toMatchObject({
      code: 'DATABASE_EXECUTOR_START_FAILED',
      retryable: false,
      outcome: 'not-started',
    });
    expect(harness.coordinator.diagnostics()).toMatchObject({
      availableSlots: 1,
      quarantinedSlots: 0,
      databases: [],
    });
  });

  test('rejects a synchronous lifecycle event before identity is pinned', async () => {
    const store = new MemoryEventStore();
    const harness = createBoundaryHarness(
      roots,
      coordinators,
      () => ({ emitDuringListenerRegistration: true }),
      {
        placement: {
          default: 'hot',
          hot: {
            durability: 'periodic',
            maxBytes: 8 * 1024 * 1024,
            snapshotIntervalMs: 60_000,
          },
        },
        observability: createDatabaseObservability({
          sink: store,
          store,
          config: { console: false, store },
        }),
      },
    );

    const error = await captureDatabaseError(
      () => harness.coordinator.acquire('tenant-premature-event'),
    );

    expect(error).toMatchObject({
      code: 'DATABASE_EXECUTOR_START_FAILED',
      retryable: false,
      outcome: 'not-started',
    });
    expect(store.query({ code: 'database.hot_durability.dirty' }).events)
      .toHaveLength(0);
    expect(harness.coordinator.diagnostics()).toMatchObject({
      availableSlots: 1,
      quarantinedSlots: 0,
      databases: [],
    });
  });

  test('retires and replaces a ready executor whose settlement proof rejects', async () => {
    const harness = createBoundaryHarness(roots, coordinators, () => ({}));
    const lease = await harness.coordinator.acquire('tenant-settlement-rejected');
    const initialGeneration = harness.coordinator
      .diagnostics().databases[0]!.writerGeneration!;

    harness.executors[0]!.rejectSettlementProof();
    await waitUntil(() => {
      const current = harness.coordinator.diagnostics().databases[0];
      return current?.state === 'ready'
        && current.writerGeneration !== initialGeneration;
    });

    expect(harness.executors[0]!.diagnostics().settled).toBe(true);
    await expect(lease.execute({
      type: 'get',
      table: 'todos',
      id: 'one',
      consistency: { mode: 'strong' },
    })).resolves.toMatchObject({ value: { actor: 'writer' } });
    lease.release();
  });

  test('quarantines hot startup when its required durability close fails', async () => {
    const harness = createBoundaryHarness(
      roots,
      coordinators,
      () => ({ failReadinessAfterBind: true, failClose: true }),
      {
        placement: {
          default: 'hot',
          hot: {
            durability: 'final',
            maxBytes: 8 * 1024 * 1024,
          },
        },
      },
    );

    const error = await captureDatabaseError(
      () => harness.coordinator.acquire('tenant-hot-startup-close'),
    );

    expect(error).toMatchObject({
      code: 'DATABASE_EXECUTOR_FAILED',
      retryable: false,
      outcome: 'unknown',
    });
    expect(harness.coordinator.diagnostics()).toMatchObject({
      availableSlots: 0,
      quarantinedSlots: 1,
      databases: [{ placement: 'hot', state: 'quarantined' }],
    });
  });
});

function createBoundaryHarness(
  roots: string[],
  coordinators: DatabaseCoordinator[],
  behavior: (
    context: DatabaseExecutorFactoryContext,
    index: number,
  ) => ExecutorBehavior,
  options: Readonly<{
    placement?: ConstructorParameters<typeof DatabaseCoordinator>[0]['placement'];
    observability?: DatabaseObservability;
  }> = {},
): Readonly<{
  coordinator: DatabaseCoordinator;
  executors: BoundaryExecutor[];
}> {
  const root = realpathSync.native(
    mkdtempSync(join(tmpdir(), 'zero-coordinator-executor-boundary-')),
  );
  roots.push(root);
  const executors: BoundaryExecutor[] = [];
  let generation = 0;
  const coordinator = new DatabaseCoordinator({
    rootDirectory: root,
    realm,
    readers: false,
    maxDatabases: 1,
    sweepIntervalMs: false,
    placement: options.placement,
    observability: options.observability,
    createExecutor: (context) => {
      const executorBehavior = behavior(context, executors.length);
      const executor = new BoundaryExecutor(
        context,
        ++generation,
        executorBehavior,
      );
      executors.push(executor);
      if (executorBehavior.singleReadRequiredMethods) {
        installSingleReadRequiredMethods(executor);
      }
      return executor;
    },
  });
  coordinators.push(coordinator);
  coordinator.start();
  return Object.freeze({ coordinator, executors });
}

class BoundaryExecutor implements DatabaseExecutor {
  readonly #settlement = deferred<void>();
  readonly #context: DatabaseExecutorFactoryContext;
  readonly #generation: number;
  readonly #behavior: ExecutorBehavior;
  #state: DatabaseExecutorState = 'created';
  #settled = false;
  #diagnosticsReads = 0;
  #eventListener: DatabaseExecutorEventListener | null = null;

  constructor(
    context: DatabaseExecutorFactoryContext,
    generation: number,
    behavior: ExecutorBehavior,
  ) {
    this.#context = context;
    this.#generation = generation;
    this.#behavior = behavior;
  }

  setEventListener(listener: DatabaseExecutorEventListener): void {
    if (this.#behavior.throwEventListener) {
      throw new Error('private event-listener failure');
    }
    this.#eventListener = listener;
    if (this.#behavior.emitDuringListenerRegistration) {
      listener(Object.freeze({
        type: 'hot-periodic-durability-dirty',
      }));
    }
  }

  async start(): Promise<void> {
    this.#state = 'ready';
  }

  async execute<
    Result extends DatabaseExecutorValue = DatabaseExecutorValue,
    Payload extends DatabaseExecutorValue = DatabaseExecutorValue,
  >(
    request: DatabaseExecutorRequest<Payload>,
    _options?: DatabaseExecutorExecuteOptions,
  ): Promise<Result> {
    const payload = request.payload as Record<string, any>;
    if (request.operation === DATABASE_ACTOR_OPERATIONS.bindWriter) {
      if (this.#behavior.failReadinessAfterBind) this.#state = 'failed';
      return {
        databaseRef: payload.databaseRef,
        role: 'writer',
        fileIdentity: payload.fileIdentity,
        instanceId: payload.instanceId,
        placement: payload.placement,
        realmFingerprint: payload.realmFingerprint,
        schemaChecksum: realm.schemaChecksum,
        sequence: { seq: 0 },
        syncEpoch: `epoch-${this.#generation}`,
      } as unknown as Result;
    }
    if (request.operation === DATABASE_ACTOR_OPERATIONS.execute) {
      return {
        value: { actor: 'writer' },
        sequence: { seq: 0 },
      } as unknown as Result;
    }
    throw new DatabaseError(
      'DATABASE_OPERATION_UNSUPPORTED',
      'Boundary test operation is unsupported.',
    );
  }

  settled(): Promise<void> {
    return this.#settlement.promise;
  }

  rejectSettlementProof(): void {
    this.#settlement.reject(new Error('private settlement failure'));
  }

  async close(): Promise<void> {
    this.#settle();
    if (this.#behavior.failClose) {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Private final durability failure.',
        { retryable: false, outcome: 'unknown' },
      );
    }
  }

  diagnostics(): DatabaseExecutorDiagnostics {
    this.#diagnosticsReads += 1;
    if (this.#behavior.malformedFirstDiagnostics
      && this.#diagnosticsReads === 1) {
      return null as unknown as DatabaseExecutorDiagnostics;
    }
    const generation = this.#behavior.mutateSecondGeneration
      && this.#diagnosticsReads === 2
      ? this.#generation + 10_000
      : this.#generation;
    return {
      state: this.#state,
      slot: this.#context.slot,
      generation,
      inFlight: 0,
      maxInFlight: 1,
      disconnectObserved: false,
      exitObserved: this.#settled,
      settled: this.#settled,
      exitCode: this.#settled ? 0 : null,
      signalCode: null,
      lastFailureCode: null,
    };
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  #settle(): void {
    if (this.#settled) return;
    this.#settled = true;
    this.#state = 'closed';
    this.#settlement.resolve(undefined);
  }
}

function installSingleReadRequiredMethods(executor: BoundaryExecutor): void {
  const captured = {
    start: executor.start.bind(executor),
    execute: executor.execute.bind(executor),
    settled: executor.settled.bind(executor),
    close: executor.close.bind(executor),
    diagnostics: executor.diagnostics.bind(executor),
  } satisfies Pick<
    DatabaseExecutor,
    'start' | 'execute' | 'settled' | 'close' | 'diagnostics'
  >;
  for (const name of Object.keys(captured) as Array<keyof typeof captured>) {
    let reads = 0;
    Object.defineProperty(executor, name, {
      configurable: true,
      get() {
        reads += 1;
        if (reads > 1) throw new Error(`Executor method ${name} was re-read.`);
        return captured[name];
      },
    });
  }
}

async function captureDatabaseError(
  run: () => unknown | Promise<unknown>,
): Promise<DatabaseError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
  throw new Error('Expected database operation to fail.');
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for state.');
    await Bun.sleep(5);
  }
}

function deferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return Object.freeze({ promise, resolve, reject });
}
