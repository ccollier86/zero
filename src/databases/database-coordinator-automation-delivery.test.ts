import { describe, expect, test } from 'bun:test';

import type { DatabaseAutomationDeliveryLease } from '../database-automations/automation-outbox-contracts';
import { AuthorityCommitCoordinator } from './authority-commit-coordinator';
import {
  createDatabaseCommitAuthority,
  type DatabaseCommitAuthority,
} from './database-commit-authority';
import {
  DATABASE_ACTOR_AUTOMATION_OUTBOX_OPERATION,
} from './database-automation-actor-protocol';
import {
  createCoordinatorDatabaseAutomationDeliverySource,
} from './database-coordinator-automation-delivery-source';
import {
  DatabaseCoordinatorAutomationDeliveryRuntime,
} from './database-coordinator-automation-delivery-runtime';
import {
  CoordinatorLease,
  type DatabaseCoordinatorCapabilityHost,
} from './database-coordinator-capability';
import type {
  DatabaseCoordinatorLease,
  DatabaseExecutionOptions,
} from './database-coordinator-contract';
import type { DatabaseCoordinatorEntry } from './database-coordinator-entry';
import { DatabaseError } from './database-error';
import type {
  DatabaseExecutor,
  DatabaseExecutorDiagnostics,
  DatabaseExecutorExecuteOptions,
  DatabaseExecutorRequest,
  DatabaseExecutorValue,
} from './database-executor';
import {
  createDatabaseRef,
  normalizeDatabaseId,
} from './database-file';
import { DatabaseWriterLane } from './database-writer-lane';
import * as publicDatabases from './index';

const fingerprint = `sha256:${'a'.repeat(64)}`;
const leaseFence = Object.freeze({
  deliveryId: 'delivery:one',
  leaseOwner: 'worker:one',
  leaseToken: 'lease:one',
  updatedAt: 1_000,
});

describe('DatabaseCoordinator automation delivery source', () => {
  test('sends exact action payloads to the writer FIFO and returns validated results', async () => {
    const harness = new RuntimeHarness();
    const entry = harness.createEntry('source-a');
    const lease = harness.createLease(entry);
    const source = createCoordinatorDatabaseAutomationDeliverySource(lease);

    const claim = await source.claim('worker:one', 1_000, 2_000);
    expect(claim).toEqual(claimedDelivery());
    expect(entry.lane.depth).toBe(0);
    expect(await source.renew(leaseFence, 1_500, 2_000)).toEqual(
      claimedDelivery({ updatedAt: 1_500, leaseExpiresAt: 3_500 }),
    );
    expect(await source.complete(leaseFence, 2_000)).toBe('completed');
    expect(await source.retry(
      leaseFence,
      'REMOTE_UNAVAILABLE',
      3_000,
      2_000,
    )).toBe('pending');
    expect(await source.dead(
      leaseFence,
      'REMOTE_REJECTED',
      2_000,
    )).toBe('dead');
    expect(await source.recoverExpired(5_000)).toEqual({ requeued: 2, dead: 1 });
    expect(await source.counts()).toEqual(countsResult());

    expect(entry.lane.depth).toBe(0);
    expect(harness.executor(entry).requests.map(({ request }) => ({
      operation: request.operation,
      kind: request.kind,
      payload: request.payload,
    }))).toEqual([
      {
        operation: DATABASE_ACTOR_AUTOMATION_OUTBOX_OPERATION,
        kind: 'write',
        payload: {
          databaseRef: entry.databaseRef,
          action: 'claim',
          leaseOwner: 'worker:one',
          now: 1_000,
          leaseMs: 2_000,
        },
      },
      {
        operation: DATABASE_ACTOR_AUTOMATION_OUTBOX_OPERATION,
        kind: 'write',
        payload: {
          databaseRef: entry.databaseRef,
          action: 'renew',
          lease: leaseFence,
          now: 1_500,
          leaseMs: 2_000,
        },
      },
      {
        operation: DATABASE_ACTOR_AUTOMATION_OUTBOX_OPERATION,
        kind: 'write',
        payload: {
          databaseRef: entry.databaseRef,
          action: 'complete',
          lease: leaseFence,
          now: 2_000,
        },
      },
      {
        operation: DATABASE_ACTOR_AUTOMATION_OUTBOX_OPERATION,
        kind: 'write',
        payload: {
          databaseRef: entry.databaseRef,
          action: 'retry',
          lease: leaseFence,
          errorCode: 'REMOTE_UNAVAILABLE',
          retryAt: 3_000,
          now: 2_000,
        },
      },
      {
        operation: DATABASE_ACTOR_AUTOMATION_OUTBOX_OPERATION,
        kind: 'write',
        payload: {
          databaseRef: entry.databaseRef,
          action: 'dead',
          lease: leaseFence,
          errorCode: 'REMOTE_REJECTED',
          now: 2_000,
        },
      },
      {
        operation: DATABASE_ACTOR_AUTOMATION_OUTBOX_OPERATION,
        kind: 'write',
        payload: {
          databaseRef: entry.databaseRef,
          action: 'recover-expired',
          now: 5_000,
        },
      },
      {
        operation: DATABASE_ACTOR_AUTOMATION_OUTBOX_OPERATION,
        kind: 'read',
        payload: { databaseRef: entry.databaseRef, action: 'counts' },
      },
    ]);
    expect(harness.executor(entry).requests.every(
      ({ options }) => options?.timeoutMs === 2_500,
    )).toBe(true);
    expect(harness.operationClasses).toEqual([
      'mutation',
      'mutation',
      'mutation',
      'mutation',
      'mutation',
      'mutation',
      'query',
    ]);
  });

  test('revalidates authority only when each action reaches the FIFO head', async () => {
    const authorityOwner = new AuthorityCommitCoordinator();
    let current = true;
    let checks = 0;
    const harness = new RuntimeHarness({
      authorityCommitCoordinator: authorityOwner,
      requireCommitAuthority: true,
    });
    const entry = harness.createEntry('source-authority');
    const authority = createDatabaseCommitAuthority(
      authorityOwner,
      entry.id,
      () => {
        checks += 1;
        if (!current) throw new Error('private tenant membership detail');
        return undefined;
      },
    );
    const releaseFirst = deferred<void>();
    const firstStarted = deferred<void>();
    harness.executor(entry).respond = async (request) => {
      const payload = request.payload as Record<string, unknown>;
      if (payload.action === 'recover-expired') {
        firstStarted.resolve();
        await releaseFirst.promise;
        return { requeued: 0, dead: 0 };
      }
      return defaultActorResult(payload);
    };
    const source = createCoordinatorDatabaseAutomationDeliverySource(
      harness.createLease(entry, authority),
    );

    const first = source.recoverExpired(1_000);
    await firstStarted.promise;
    const blocked = captureDatabaseError(() => source.counts());
    await Promise.resolve();
    expect(checks).toBe(1);
    current = false;
    releaseFirst.resolve();
    await expect(first).resolves.toEqual({ requeued: 0, dead: 0 });
    const error = await blocked;
    expect(error).toMatchObject({
      code: 'DATABASE_AUTHORITY_CHANGED',
      outcome: 'not-started',
    });
    expect(error.message).not.toContain('private');
    expect(harness.executor(entry).requests).toHaveLength(1);
    await authorityOwner.close();
  });

  test('resumes against a replacement writer and preserves queue and operation deadlines', async () => {
    const harness = new RuntimeHarness();
    const entry = harness.createEntry('source-replacement');
    const opening = deferred<void>();
    entry.state = 'opening';
    entry.opening = opening.promise;
    const source = createCoordinatorDatabaseAutomationDeliverySource(
      harness.createLease(entry),
    );

    const waiting = source.counts();
    await Promise.resolve();
    expect(harness.executor(entry).requests).toHaveLength(0);
    expect(harness.replacementClasses).toEqual(['query']);
    const replacement = new FakeExecutor();
    entry.writer = replacement;
    entry.state = 'ready';
    opening.resolve();
    await expect(waiting).resolves.toEqual(countsResult());
    expect(replacement.requests).toHaveLength(1);

    const block = deferred<void>();
    const started = deferred<void>();
    replacement.respond = async (request) => {
      const payload = request.payload as Record<string, unknown>;
      if (payload.action === 'recover-expired') {
        started.resolve();
        await block.promise;
      }
      return defaultActorResult(payload);
    };
    const first = harness.runtime.execute(entry, {
      action: 'recover-expired',
      now: 2_000,
    });
    await started.promise;
    const timedOut = harness.runtime.execute(
      entry,
      { action: 'counts' },
      { queueTimeoutMs: 5, operationTimeoutMs: 99 },
    );
    const timeout = await captureDatabaseError(() => timedOut);
    expect(timeout.code).toBe('DATABASE_QUEUE_TIMEOUT');
    block.resolve();
    await first;
  });

  test('returns stale lifecycle results unchanged and rejects use after lease release', async () => {
    const harness = new RuntimeHarness();
    const entry = harness.createEntry('source-stale');
    harness.executor(entry).respond = (request) => {
      const payload = request.payload as Record<string, unknown>;
      if (payload.action === 'complete'
        || payload.action === 'retry'
        || payload.action === 'dead') return 'stale';
      return defaultActorResult(payload);
    };
    const lease = harness.createLease(entry);
    const source = createCoordinatorDatabaseAutomationDeliverySource(lease);

    expect(await source.complete(leaseFence, 2_000)).toBe('stale');
    expect(await source.retry(
      leaseFence,
      'REMOTE_UNAVAILABLE',
      3_000,
      2_000,
    )).toBe('stale');
    expect(await source.dead(
      leaseFence,
      'REMOTE_REJECTED',
      2_000,
    )).toBe('stale');
    harness.started = false;
    const lifecycleError = await captureDatabaseError(() => source.counts());
    expect(lifecycleError.code).toBe('DATABASE_CLOSED');
    harness.started = true;
    lease.release();
    expect(lease.released).toBe(true);
    expect(harness.releasedEntries).toBe(1);
    expect(() => source.counts()).toThrow(
      expect.objectContaining({ code: 'DATABASE_CLOSED' }),
    );
    expect(() => createCoordinatorDatabaseAutomationDeliverySource({} as never))
      .toThrow(expect.objectContaining({ code: 'DATABASE_CONFIG_INVALID' }));
    expect('executeAutomationDelivery' in ({} as DatabaseCoordinatorLease))
      .toBe(false);
    expect('createCoordinatorDatabaseAutomationDeliverySource' in publicDatabases)
      .toBe(false);
    const publicLeaseHasDeliveryMethod: 'executeAutomationDelivery' extends
      keyof DatabaseCoordinatorLease ? true : false = false;
    expect(publicLeaseHasDeliveryMethod).toBe(false);
  });

  test('rejects corrupted actor results, retires that generation, and hides payloads', async () => {
    const harness = new RuntimeHarness();
    const entry = harness.createEntry('source-corrupt');
    harness.executor(entry).respond = () => ({
      ...countsResult(),
      totalRecords: 99,
      privatePayload: 'tenant-secret',
    });
    const source = createCoordinatorDatabaseAutomationDeliverySource(
      harness.createLease(entry),
    );

    const error = await captureDatabaseError(() => source.counts());
    expect(error).toMatchObject({
      code: 'DATABASE_PROTOCOL_ERROR',
      outcome: 'unknown',
    });
    expect(JSON.stringify(error)).not.toContain('tenant-secret');
    expect(harness.retirements).toHaveLength(1);
    expect(harness.retirements[0]?.error.code).toBe('DATABASE_PROTOCOL_ERROR');
    expect(JSON.stringify(harness.events)).not.toContain('tenant-secret');
  });

  test('holds commit authority after an unknown actor outcome until settlement', async () => {
    const authorityOwner = new AuthorityCommitCoordinator();
    const harness = new RuntimeHarness({
      authorityCommitCoordinator: authorityOwner,
      requireCommitAuthority: true,
    });
    const entry = harness.createEntry('source-unknown');
    const settlement = deferred<void>();
    harness.executor(entry).settlement = settlement.promise;
    harness.executor(entry).respond = () => {
      throw new DatabaseError(
        'DATABASE_OPERATION_TIMEOUT',
        'private actor outcome',
        { retryable: false, outcome: 'unknown' },
      );
    };
    const source = createCoordinatorDatabaseAutomationDeliverySource(
      harness.createLease(entry, createDatabaseCommitAuthority(
        authorityOwner,
        entry.id,
        () => undefined,
      )),
    );

    const error = await captureDatabaseError(() => source.counts());
    expect(error).toMatchObject({
      code: 'DATABASE_OPERATION_TIMEOUT',
      outcome: 'unknown',
    });
    expect(error.message).not.toContain('private');
    expect(authorityOwner.diagnostics().activeShared).toBe(1);
    let exclusiveGranted = false;
    const exclusiveTask = authorityOwner.acquireExclusive().then((lease) => {
      exclusiveGranted = true;
      return lease;
    });
    await Promise.resolve();
    expect(exclusiveGranted).toBe(false);
    settlement.resolve();
    const exclusive = await exclusiveTask;
    expect(authorityOwner.diagnostics().activeShared).toBe(0);
    exclusive.release();
    await authorityOwner.close();
  });

  test('serializes one source while independent source writers operate concurrently', async () => {
    const harness = new RuntimeHarness();
    const entryA = harness.createEntry('source-a');
    const entryB = harness.createEntry('source-b');
    const releaseA = deferred<void>();
    const releaseB = deferred<void>();
    const startedA = deferred<void>();
    const startedB = deferred<void>();
    const starts: string[] = [];
    harness.executor(entryA).respond = async (request) => {
      const action = (request.payload as Record<string, unknown>).action;
      starts.push(`a:${String(action)}`);
      if (action === 'claim') {
        startedA.resolve();
        await releaseA.promise;
      }
      return defaultActorResult(request.payload as Record<string, unknown>);
    };
    harness.executor(entryB).respond = async (request) => {
      const action = (request.payload as Record<string, unknown>).action;
      starts.push(`b:${String(action)}`);
      if (action === 'claim') {
        startedB.resolve();
        await releaseB.promise;
      }
      return defaultActorResult(request.payload as Record<string, unknown>);
    };
    const sourceA = createCoordinatorDatabaseAutomationDeliverySource(
      harness.createLease(entryA),
    );
    const sourceB = createCoordinatorDatabaseAutomationDeliverySource(
      harness.createLease(entryB),
    );

    const a1 = sourceA.claim('worker:a', 1_000, 2_000);
    const a2 = sourceA.counts();
    const b1 = sourceB.claim('worker:b', 1_000, 2_000);
    await Promise.all([startedA.promise, startedB.promise]);
    expect(starts).toEqual(['a:claim', 'b:claim']);
    releaseA.resolve();
    await a1;
    await waitUntil(() => starts.includes('a:counts'));
    expect(starts).toEqual(['a:claim', 'b:claim', 'a:counts']);
    releaseB.resolve();
    await Promise.all([a2, b1]);
  });
});

interface RuntimeHarnessOptions {
  readonly authorityCommitCoordinator?: AuthorityCommitCoordinator;
  readonly requireCommitAuthority?: boolean;
}

class RuntimeHarness {
  readonly operationClasses: string[] = [];
  readonly replacementClasses: string[] = [];
  readonly retirements: Array<Readonly<{
    entry: DatabaseCoordinatorEntry;
    executor: DatabaseExecutor;
    error: DatabaseError;
  }>> = [];
  readonly events: unknown[] = [];
  readonly runtime: DatabaseCoordinatorAutomationDeliveryRuntime;
  releasedEntries = 0;
  started = true;
  #nextSlot = 0;

  constructor(options: RuntimeHarnessOptions = {}) {
    this.runtime = new DatabaseCoordinatorAutomationDeliveryRuntime({
      queueTimeoutMs: 1_000,
      operationTimeoutMs: 2_500,
      now: Date.now,
      authorityCommitCoordinator: options.authorityCommitCoordinator ?? null,
      requireCommitAuthority: options.requireCommitAuthority ?? false,
      assertStarted: () => {
        if (!this.started) {
          throw new DatabaseError(
            'DATABASE_CLOSED',
            'Database coordinator is not accepting work.',
          );
        }
      },
      canAwaitOpening: (entry) => entry.state === 'opening',
      awaitReplacementOpening: async (entry, _execution, operation, resume) => {
        this.replacementClasses.push(operation);
        await entry.opening;
        return await resume();
      },
      assertUsableEntry: (entry) => {
        if (entry.state !== 'ready') {
          throw new DatabaseError(
            'DATABASE_NOT_READY',
            'Database binding is unavailable.',
          );
        }
      },
      enqueueLane: (entry, operation, execution, run) => {
        this.operationClasses.push(operation);
        return entry.lane.enqueue(run, {
          ...(execution.signal ? { signal: execution.signal } : {}),
          timeoutMs: execution.queueTimeoutMs ?? 1_000,
          operationClass: operation,
        });
      },
      requireWriter: (entry) => {
        if (!entry.writer) {
          throw new DatabaseError(
            'DATABASE_NOT_READY',
            'Database writer is unavailable.',
          );
        }
        return entry.writer;
      },
      isTerminalFailure: (executor, error) => (
        error.code === 'DATABASE_PROTOCOL_ERROR'
        || executor.diagnostics().state !== 'ready'
      ),
      retire: async (entry, executor, error) => {
        this.retirements.push(Object.freeze({ entry, executor, error }));
      },
      holdAuthorityUntilSettlement: (lease, executor) => {
        void executor.settled().then(() => lease.release());
      },
      emit: (event) => { this.events.push(event); },
    });
  }

  createEntry(id: string): DatabaseCoordinatorEntry {
    const executor = new FakeExecutor();
    const databaseRef = createDatabaseRef(id);
    const entry = {
      id: normalizeDatabaseId(id),
      databaseRef,
      placement: Object.freeze({ mode: 'file' as const }),
      slot: this.#nextSlot++,
      lane: new DatabaseWriterLane({
        databaseRef,
        placement: 'file',
        maxQueued: 100,
        now: Date.now,
        onQueued: () => true,
        onDequeued: () => undefined,
        observability: null,
      }),
      state: 'ready',
      writer: executor,
      reader: null,
      opening: Promise.resolve(),
      recovery: null,
      settlement: null,
      closeTask: null,
      failure: null,
      closeFailure: null,
      restartRetryCount: 0,
      restartAbortController: null,
      leases: 1,
      activeOperations: 0,
      recoveryWaiters: 0,
      lastUsedAt: Date.now(),
      syncIdentity: null,
      tenantSyncBindingSlots: 0,
      syncBindings: new Set(),
    } as unknown as DatabaseCoordinatorEntry;
    return entry;
  }

  executor(entry: DatabaseCoordinatorEntry): FakeExecutor {
    return entry.writer as FakeExecutor;
  }

  createLease(
    entry: DatabaseCoordinatorEntry,
    authority: DatabaseCommitAuthority | null = null,
  ): CoordinatorLease {
    const host = {
      executeAutomationDelivery: <TInput extends Parameters<
        DatabaseCoordinatorAutomationDeliveryRuntime['execute']
      >[1]>(
        ownedEntry: DatabaseCoordinatorEntry,
        input: TInput,
        execution: DatabaseExecutionOptions | undefined,
        commitAuthority: DatabaseCommitAuthority | null,
      ) => this.runtime.execute(
        ownedEntry,
        input,
        execution,
        commitAuthority,
      ),
      releaseEntry: () => { this.releasedEntries += 1; },
    } as unknown as DatabaseCoordinatorCapabilityHost;
    return new CoordinatorLease(host, entry, authority);
  }
}

class FakeExecutor implements DatabaseExecutor {
  readonly requests: Array<Readonly<{
    request: DatabaseExecutorRequest;
    options: DatabaseExecutorExecuteOptions | undefined;
  }>> = [];
  respond: (
    request: DatabaseExecutorRequest,
  ) => DatabaseExecutorValue | Promise<DatabaseExecutorValue> = (request) => (
    defaultActorResult(request.payload as Record<string, unknown>)
  );
  settlement: Promise<void> = Promise.resolve();

  async start(): Promise<void> {}

  async execute<
    Result extends DatabaseExecutorValue = DatabaseExecutorValue,
    Payload extends DatabaseExecutorValue = DatabaseExecutorValue,
  >(
    request: DatabaseExecutorRequest<Payload>,
    options?: DatabaseExecutorExecuteOptions,
  ): Promise<Result> {
    this.requests.push(Object.freeze({ request, options }));
    return await this.respond(request) as Result;
  }

  settled(): Promise<void> { return this.settlement; }
  async close(): Promise<void> {}
  diagnostics(): DatabaseExecutorDiagnostics {
    return {
      state: 'ready',
      slot: 0,
      generation: 1,
      inFlight: 0,
      maxInFlight: 64,
      disconnectObserved: false,
      exitObserved: false,
      settled: false,
      exitCode: null,
      signalCode: null,
      lastFailureCode: null,
    };
  }
  async [Symbol.asyncDispose](): Promise<void> {}
}

function defaultActorResult(payload: Record<string, unknown>): DatabaseExecutorValue {
  switch (payload.action) {
    case 'claim':
      return claimedDelivery({
        leaseOwner: payload.leaseOwner,
        updatedAt: payload.now,
        leaseExpiresAt: (payload.now as number) + (payload.leaseMs as number),
      });
    case 'renew': {
      const lease = payload.lease as DatabaseAutomationDeliveryLease;
      const updatedAt = Math.max(payload.now as number, lease.updatedAt);
      return claimedDelivery({
        deliveryId: lease.deliveryId,
        leaseOwner: lease.leaseOwner,
        leaseToken: lease.leaseToken,
        updatedAt,
        leaseExpiresAt: updatedAt + (payload.leaseMs as number),
      });
    }
    case 'complete':
      return 'completed';
    case 'retry':
      return 'pending';
    case 'dead':
      return 'dead';
    case 'recover-expired':
      return { requeued: 2, dead: 1 };
    case 'counts':
      return countsResult();
    default:
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Fake automation action is unsupported.',
      );
  }
}

function claimedDelivery(overrides: Record<string, unknown> = {}) {
  return {
    deliveryId: 'delivery:one',
    invocationId: 'invocation:one',
    triggerIdentity: 'trigger:orders.changed@1',
    functionIdentity: 'function:orders.notify@1',
    manifestFingerprint: fingerprint,
    realmName: 'orders',
    realmFingerprint: fingerprint,
    sourceSequence: 7,
    sourceTable: 'orders',
    sourceOperation: 'update' as const,
    sourceRowId: 'order-one',
    input: { task: 'notify' },
    status: 'processing' as const,
    attemptCount: 1,
    maxAttempts: 20,
    availableAt: 900,
    createdAt: 100,
    updatedAt: 1_000,
    completedAt: null,
    lastErrorCode: null,
    insertionOrdinal: 1,
    leaseOwner: 'worker:one',
    leaseToken: 'lease:one',
    leaseExpiresAt: 3_000,
    ...overrides,
  };
}

function countsResult() {
  return {
    totalRecords: 10,
    activeRecords: 5,
    activeBytes: 2_048,
    pendingRecords: 3,
    processingRecords: 2,
    completedRecords: 4,
    deadRecords: 1,
  };
}

function deferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve(value: T extends void ? void : T): void;
}> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return Object.freeze({ promise, resolve: resolve as never });
}

async function captureDatabaseError(
  operation: () => Promise<unknown>,
): Promise<DatabaseError> {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
  throw new Error('Expected DatabaseError.');
}

async function waitUntil(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await Bun.sleep(1);
  }
  throw new Error('Condition did not become true.');
}
