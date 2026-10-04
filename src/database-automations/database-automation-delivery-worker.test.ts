import { describe, expect, test } from 'bun:test';

import type {
  ClaimedDatabaseAutomationDelivery,
  DatabaseAutomationDeliveryLease,
  DatabaseAutomationOutboxCounts,
} from './automation-outbox-contracts';
import { defineDatabaseAutomations } from './database-automations';
import type {
  DatabaseAutomationDeliveryEvent,
  DatabaseAutomationDeliverySource,
  DatabaseAutomationExecutionServiceProvider,
} from './database-automation-delivery-contracts';
import { DatabaseAutomationDeliveryWorker } from './database-automation-delivery-worker';
import { defineDatabaseFunction } from './database-function';

const EMPTY_COUNTS: DatabaseAutomationOutboxCounts = Object.freeze({
  totalRecords: 0,
  activeRecords: 0,
  activeBytes: 0,
  pendingRecords: 0,
  processingRecords: 0,
  completedRecords: 0,
  deadRecords: 0,
});

describe('DatabaseAutomationDeliveryWorker', () => {
  test('executes an exact durable function with fenced services and completes its lease', async () => {
    const observations: unknown[] = [];
    const durable = defineDatabaseFunction<{ value: number }, void, { marker: string }>({
      name: 'orders.notify',
      version: 2,
      mode: 'durable',
      handler: async (context) => {
        observations.push({
          input: context.input,
          invocation: context.invocation,
          marker: context.zero.marker,
          aborted: context.signal.aborted,
        });
      },
    });
    const registry = defineDatabaseAutomations({ functions: [durable] });
    const source = new FakeDeliverySource([
      delivery(durable.identity, registry.fingerprint, { value: 7 }),
    ]);
    const services = new FakeServiceProvider({ marker: 'scoped' });
    const events: DatabaseAutomationDeliveryEvent[] = [];
    const worker = new DatabaseAutomationDeliveryWorker({
      source,
      registry,
      services,
      leaseOwner: 'worker-one',
      leaseMs: 1_000,
      renewIntervalMs: 100,
      executionTimeoutMs: 1_000,
      now: incrementingClock(1_000),
      emit: (event) => events.push(event),
    });

    await expect(worker.drain()).resolves.toMatchObject({
      claimed: 1,
      completed: 1,
      retried: 0,
      dead: 0,
      leaseLost: 0,
      abandoned: 0,
    });
    expect(observations).toEqual([{
      input: { value: 7 },
      invocation: {
        invocationId: 'invocation-one',
        functionIdentity: durable.identity,
        triggerIdentity: 'trigger:orders.inserted@1',
        table: 'orders',
        operation: 'insert',
      },
      marker: 'scoped',
      aborted: false,
    }]);
    expect(services.authorityChecks).toBe(2);
    expect(services.closes).toBe(1);
    expect(source.completed).toEqual([exactLease('delivery-1', 'lease-1', 1)]);
    expect(source.retried).toHaveLength(0);
    expect(events.map(({ type }) => type)).toEqual(['claimed', 'completed']);
    await worker.close();
  });

  test('retries handler failures without leaking the exception and dead-letters unavailable versions', async () => {
    const failure = defineDatabaseFunction({
      name: 'orders.fail',
      version: 1,
      mode: 'durable',
      handler: async () => {
        throw new Error('private downstream detail');
      },
    });
    const registry = defineDatabaseAutomations({ functions: [failure] });
    const source = new FakeDeliverySource([
      delivery(failure.identity, `sha256:${'0'.repeat(64)}`, null),
      delivery('function:orders.removed@9', registry.fingerprint, null, 2),
    ]);
    const events: DatabaseAutomationDeliveryEvent[] = [];
    const worker = new DatabaseAutomationDeliveryWorker({
      source,
      registry,
      services: new FakeServiceProvider({}),
      leaseOwner: 'worker-one',
      leaseMs: 1_000,
      renewIntervalMs: 100,
      executionTimeoutMs: 1_000,
      now: incrementingClock(10_000),
      emit: (event) => events.push(event),
    });

    await expect(worker.drain()).resolves.toMatchObject({
      claimed: 2,
      completed: 0,
      retried: 1,
      dead: 1,
    });
    expect(source.retried).toHaveLength(1);
    expect(source.retried[0]).toMatchObject({
      errorCode: 'AUTOMATION_HANDLER_FAILED',
    });
    expect(source.lifecycleLeases).toEqual([
      {
        action: 'retry',
        lease: exactLease('delivery-1', 'lease-1', 1),
      },
      {
        action: 'dead',
        lease: exactLease('delivery-2', 'lease-2', 1),
      },
    ]);
    expect(JSON.stringify(source.retried)).not.toContain('private downstream detail');
    expect(source.deadLetters).toEqual([{
      deliveryId: 'delivery-2',
      errorCode: 'AUTOMATION_FUNCTION_UNAVAILABLE',
    }]);
    expect(events.map(({ type }) => type)).toEqual([
      'claimed',
      'manifest-drift',
      'retry-scheduled',
      'claimed',
      'dead-lettered',
    ]);
    await worker.close();
  });

  test('fences services and abandons the attempt when lease renewal is lost', async () => {
    let handlerSignal: AbortSignal | null = null;
    let admitHandler!: () => void;
    const admitted = new Promise<void>((resolve) => {
      admitHandler = resolve;
    });
    const durable = defineDatabaseFunction({
      name: 'orders.long-running',
      version: 1,
      mode: 'durable',
      handler: async ({ signal }) => {
        handlerSignal = signal;
        admitHandler();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        });
      },
    });
    const registry = defineDatabaseAutomations({ functions: [durable] });
    const source = new FakeDeliverySource([
      delivery(durable.identity, registry.fingerprint, null),
    ]);
    source.renewResult = null;
    const services = new FakeServiceProvider({});
    const events: DatabaseAutomationDeliveryEvent[] = [];
    const worker = new DatabaseAutomationDeliveryWorker({
      source,
      registry,
      services,
      leaseOwner: 'worker-one',
      leaseMs: 1_000,
      renewIntervalMs: 1,
      executionTimeoutMs: 1_000,
      now: incrementingClock(20_000),
      emit: (event) => events.push(event),
    });

    const draining = worker.drain();
    await admitted;
    await expect(draining).resolves.toMatchObject({
      claimed: 1,
      leaseLost: 1,
      completed: 0,
      retried: 0,
      dead: 0,
    });
    expect((handlerSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(source.renewals).toBe(1);
    expect(source.lifecycleLeases).toEqual([{
      action: 'renew',
      lease: exactLease('delivery-1', 'lease-1', 1),
    }]);
    expect(source.completed).toHaveLength(0);
    expect(source.retried).toHaveLength(0);
    expect(services.closes).toBe(1);
    expect(events.at(-1)?.type).toBe('lease-lost');
    await worker.close();
  });

  test('shutdown abandons an active attempt and overlapping drains share one task', async () => {
    let started!: () => void;
    const handlerStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const durable = defineDatabaseFunction({
      name: 'orders.waiting',
      version: 1,
      mode: 'durable',
      handler: async ({ signal }) => {
        started();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('stopped')), {
            once: true,
          });
        });
      },
    });
    const registry = defineDatabaseAutomations({ functions: [durable] });
    const source = new FakeDeliverySource([
      delivery(durable.identity, registry.fingerprint, null),
    ]);
    const services = new FakeServiceProvider({});
    const events: DatabaseAutomationDeliveryEvent[] = [];
    const worker = new DatabaseAutomationDeliveryWorker({
      source,
      registry,
      services,
      leaseOwner: 'worker-one',
      leaseMs: 1_000,
      renewIntervalMs: 100,
      executionTimeoutMs: 1_000,
      now: incrementingClock(30_000),
      emit: (event) => events.push(event),
    });

    const first = worker.drain();
    expect(worker.drain()).toBe(first);
    await handlerStarted;
    await worker.close();
    await expect(first).resolves.toMatchObject({ claimed: 1, abandoned: 1 });
    expect(source.completed).toHaveLength(0);
    expect(source.retried).toHaveLength(0);
    expect(services.closes).toBe(1);
    expect(events.at(-1)).toMatchObject({
      type: 'execution-abandoned',
      reason: 'shutdown',
    });
    await expect(worker.drain()).rejects.toMatchObject({ code: 'DATABASE_CLOSED' });
  });

  test('telemetry failures cannot alter successful delivery state', async () => {
    const durable = defineDatabaseFunction({
      name: 'orders.telemetry-isolation',
      version: 1,
      mode: 'durable',
      handler: async () => undefined,
    });
    const registry = defineDatabaseAutomations({ functions: [durable] });
    const source = new FakeDeliverySource([
      delivery(durable.identity, registry.fingerprint, null),
    ]);
    const worker = new DatabaseAutomationDeliveryWorker({
      source,
      registry,
      services: new FakeServiceProvider({}),
      leaseOwner: 'worker-one',
      leaseMs: 1_000,
      renewIntervalMs: 100,
      executionTimeoutMs: 1_000,
      emit: () => {
        throw new Error('telemetry unavailable');
      },
    });

    await expect(worker.drain()).resolves.toMatchObject({ completed: 1 });
    expect(source.completed).toHaveLength(1);
    await worker.close();
  });
});

class FakeDeliverySource implements DatabaseAutomationDeliverySource {
  readonly completed: DatabaseAutomationDeliveryLease[] = [];
  readonly lifecycleLeases: Array<{
    readonly action: 'renew' | 'complete' | 'retry' | 'dead';
    readonly lease: DatabaseAutomationDeliveryLease;
  }> = [];
  readonly retried: Array<{
    deliveryId: string;
    errorCode: string;
    retryAt: number;
    now: number;
  }> = [];
  readonly deadLetters: Array<{ deliveryId: string; errorCode: string }> = [];
  renewResult: ClaimedDatabaseAutomationDelivery | null | undefined;
  renewals = 0;

  constructor(
    private readonly deliveries: ClaimedDatabaseAutomationDelivery[],
  ) {}

  async claim(): Promise<ClaimedDatabaseAutomationDelivery | null> {
    return this.deliveries.shift() ?? null;
  }

  async renew(
    claim: DatabaseAutomationDeliveryLease,
    now: number,
    leaseMs: number,
  ): Promise<ClaimedDatabaseAutomationDelivery | null> {
    this.renewals += 1;
    this.recordLease('renew', claim);
    if (this.renewResult !== undefined) return this.renewResult;
    const original = claim as ClaimedDatabaseAutomationDelivery;
    return Object.freeze({
      ...original,
      updatedAt: now,
      leaseExpiresAt: now + leaseMs,
    });
  }

  async complete(claim: DatabaseAutomationDeliveryLease): Promise<'completed'> {
    this.recordLease('complete', claim);
    this.completed.push(claim);
    return 'completed';
  }

  async retry(
    claim: DatabaseAutomationDeliveryLease,
    errorCode: string,
    retryAt: number,
    now: number,
  ): Promise<'pending'> {
    this.recordLease('retry', claim);
    this.retried.push({ deliveryId: claim.deliveryId, errorCode, retryAt, now });
    return 'pending';
  }

  async dead(
    claim: DatabaseAutomationDeliveryLease,
    errorCode: string,
  ): Promise<'dead'> {
    this.recordLease('dead', claim);
    this.deadLetters.push({ deliveryId: claim.deliveryId, errorCode });
    return 'dead';
  }

  async recoverExpired(): Promise<{ requeued: number; dead: number }> {
    return { requeued: 0, dead: 0 };
  }

  async counts(): Promise<DatabaseAutomationOutboxCounts> {
    return EMPTY_COUNTS;
  }

  private recordLease(
    action: 'renew' | 'complete' | 'retry' | 'dead',
    lease: DatabaseAutomationDeliveryLease,
  ): void {
    expect(Object.keys(lease)).toEqual([
      'deliveryId',
      'leaseOwner',
      'leaseToken',
      'updatedAt',
    ]);
    this.lifecycleLeases.push({ action, lease });
  }
}

class FakeServiceProvider<TServices>
implements DatabaseAutomationExecutionServiceProvider<TServices> {
  authorityChecks = 0;
  closes = 0;

  constructor(private readonly services: TServices) {}

  async create() {
    return {
      zero: this.services,
      assertCurrentAuthority: (): void => {
        this.authorityChecks += 1;
      },
      close: (): void => {
        this.closes += 1;
      },
    };
  }
}

function delivery(
  functionIdentity: string,
  manifestFingerprint: string,
  input: ClaimedDatabaseAutomationDelivery['input'],
  ordinal = 1,
): ClaimedDatabaseAutomationDelivery {
  return Object.freeze({
    deliveryId: `delivery-${ordinal}`,
    invocationId: 'invocation-one',
    triggerIdentity: 'trigger:orders.inserted@1',
    functionIdentity,
    manifestFingerprint,
    realmName: 'orders.realm',
    realmFingerprint: `sha256:${'a'.repeat(64)}`,
    sourceSequence: ordinal,
    sourceTable: 'orders',
    sourceOperation: 'insert',
    sourceRowId: `order-${ordinal}`,
    input,
    status: 'processing',
    attemptCount: 1,
    maxAttempts: 5,
    availableAt: 1,
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
    lastErrorCode: null,
    insertionOrdinal: ordinal,
    leaseOwner: 'worker-one',
    leaseToken: `lease-${ordinal}`,
    leaseExpiresAt: 1_001,
  });
}

function incrementingClock(initial: number): () => number {
  let current = initial;
  return () => current++;
}

function exactLease(
  deliveryId: string,
  leaseToken: string,
  updatedAt: number,
): DatabaseAutomationDeliveryLease {
  return {
    deliveryId,
    leaseOwner: 'worker-one',
    leaseToken,
    updatedAt,
  };
}
