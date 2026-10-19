import { describe, expect, test } from 'bun:test';

import type { DatabaseAutomationSourceRecord } from './automation-source-catalog-contract';
import type { DatabaseAutomationSourceCatalog } from './automation-source-catalog-store';
import type {
  ClaimedDatabaseAutomationDelivery,
  DatabaseAutomationDeliveryLease,
  DatabaseAutomationOutboxCounts,
} from './automation-outbox-contracts';
import { defineDatabaseAutomations } from './database-automations';
import type {
  DatabaseAutomationDeliverySource,
  DatabaseAutomationExecutionServiceProvider,
} from './database-automation-delivery-contracts';
import { DatabaseAutomationDispatcher } from './database-automation-dispatcher';
import { defineDatabaseFunction } from './database-function';

describe('DatabaseAutomationDispatcher', () => {
  test('backs off empty sources, wakes on commits, and retains bounded recovery without hints', async () => {
    const durable = defineDatabaseFunction({ name: 'jobs.dispatch', version: 1, mode: 'durable', handler: async () => undefined });
    const registry = defineDatabaseAutomations({ functions: [durable] });
    const record = sourceRecord('a', 1);
    const queue: ClaimedDatabaseAutomationDelivery[] = [];
    const source = new QueuedDeliverySource(queue);
    let now = 0, acquisitions = 0, unsubscribed = 0;
    let notify!: (sourceRef: string) => void;
    const dispatcher = new DatabaseAutomationDispatcher({
      catalog: catalog([record]), leaseOwner: 'idle-test', scanIntervalMs: 10, now: () => now,
      subscribe: listener => { notify = listener; return () => { unsubscribed++; }; },
      acquire: async () => { acquisitions++; return { delivery: source, registry, services: serviceProvider(), release() {} }; },
    });
    try {
      await dispatcher.drainNow();
      await dispatcher.drainNow();
      expect(acquisitions).toBe(1);
      queue.push(claim('woken', durable.identity, registry.fingerprint));
      notify(record.sourceRef);
      await dispatcher.drainNow();
      await waitUntil(() => source.completed === 1);
      expect(source.completed).toBe(1);
      // A missing hint can delay discovery, never make durable work invisible.
      await dispatcher.drainNow();
      const before = acquisitions;
      queue.push(claim('lost-hint', durable.identity, registry.fingerprint));
      await dispatcher.drainNow();
      expect(acquisitions).toBe(before);
      now += 30_001;
      await dispatcher.drainNow();
      expect(source.completed).toBe(2);
    } finally { await dispatcher.close(); }
    expect(unsubscribed).toBe(1);
    notify(record.sourceRef);
    expect(unsubscribed).toBe(1);
  });

  test('invalidates idle state when catalog authority revision changes', async () => {
    const durable = defineDatabaseFunction({ name: 'jobs.dispatch', version: 1, mode: 'durable', handler: async () => undefined });
    const registry = defineDatabaseAutomations({ functions: [durable] });
    const records = [sourceRecord('a', 1)];
    let acquisitions = 0;
    const dispatcher = new DatabaseAutomationDispatcher({
      catalog: catalog(records), leaseOwner: 'revision-test', now: () => 0,
      acquire: async () => { acquisitions++; return { delivery: new QueuedDeliverySource([]), registry, services: serviceProvider(), release() {} }; },
    });
    try {
      await dispatcher.drainNow();
      records[0] = { ...records[0]!, revision: 2 };
      await dispatcher.drainNow();
      expect(acquisitions).toBe(2);
    } finally { await dispatcher.close(); }
  });

  test('does not back off a future retry or a commit arriving during the empty check', async () => {
    const durable = defineDatabaseFunction({ name: 'jobs.dispatch', version: 1, mode: 'durable', handler: async () => undefined });
    const registry = defineDatabaseAutomations({ functions: [durable] });
    const record = sourceRecord('a', 1), queue: ClaimedDatabaseAutomationDelivery[] = [];
    const source = new QueuedDeliverySource(queue);
    let notify!: (sourceRef: string) => void;
    let acquisitions = 0, countsCalls = 0;
    const counts = source.counts.bind(source);
    source.counts = async () => {
      const result = await counts();
      if (++countsCalls === 1) { queue.push(claim('racing', durable.identity, registry.fingerprint)); notify(record.sourceRef); }
      return result;
    };
    const dispatcher = new DatabaseAutomationDispatcher({
      catalog: catalog([record]), leaseOwner: 'race-test', now: () => 0,
      subscribe: listener => { notify = listener; return () => undefined; },
      acquire: async () => { acquisitions++; return { delivery: source, registry, services: serviceProvider(), release() {} }; },
    });
    try {
      await dispatcher.drainNow();
      await waitUntil(() => source.completed === 1);
      expect(acquisitions).toBeGreaterThanOrEqual(2);
      await dispatcher.drainNow();
      notify(record.sourceRef);
      source.counts = async () => ({ ...await counts(), activeRecords: 1, pendingRecords: 1 });
      await dispatcher.drainNow();
      const before = acquisitions;
      await dispatcher.drainNow();
      expect(acquisitions).toBe(before + 1);
    } finally { await dispatcher.close(); }
  });

  test('drains distinct source databases concurrently and shares overlapping scans', async () => {
    let active = 0;
    let maximumActive = 0;
    const releases: Array<() => void> = [];
    const started: string[] = [];
    const durable = defineDatabaseFunction<{ source: string }, void, {}>({
      name: 'jobs.dispatch',
      version: 1,
      mode: 'durable',
      handler: async ({ input }) => {
        started.push(input.source);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
      },
    });
    const registry = defineDatabaseAutomations({ functions: [durable] });
    const sources = [sourceRecord('a', 1), sourceRecord('b', 2)];
    const deliverySources = new Map(sources.map((source) => [
      source.sourceRef,
      new OneDeliverySource(claim(source.logicalSourceId, durable.identity, registry.fingerprint)),
    ]));
    const released: string[] = [];
    const dispatcher = new DatabaseAutomationDispatcher({
      catalog: catalog(sources),
      leaseOwner: 'dispatcher-one',
      sourceConcurrency: 2,
      acquire: async (source) => ({
        delivery: deliverySources.get(source.sourceRef)!,
        registry,
        services: serviceProvider(),
        release: () => {
          released.push(source.logicalSourceId);
        },
      }),
    });

    const first = dispatcher.drainNow();
    expect(dispatcher.drainNow()).toBe(first);
    await waitUntil(() => started.length === 2);
    expect(new Set(started)).toEqual(new Set(['a', 'b']));
    expect(maximumActive).toBe(2);
    for (const release of releases) release();
    await first;
    expect(released.sort()).toEqual(['a', 'b']);
    expect([...deliverySources.values()].every((source) => source.completed === 1))
      .toBe(true);
    await dispatcher.close();
  });

  test('isolates one source failure and continues draining other catalog entries', async () => {
    const durable = defineDatabaseFunction({
      name: 'jobs.dispatch',
      version: 1,
      mode: 'durable',
      handler: async () => undefined,
    });
    const registry = defineDatabaseAutomations({ functions: [durable] });
    const failed = sourceRecord('failed', 1);
    const healthy = sourceRecord('healthy', 2);
    const healthySource = new OneDeliverySource(
      claim('healthy', durable.identity, registry.fingerprint),
    );
    const errors: unknown[] = [];
    const dispatcher = new DatabaseAutomationDispatcher({
      catalog: catalog([failed, healthy]),
      leaseOwner: 'dispatcher-one',
      sourceConcurrency: 2,
      acquire: async (source) => {
        if (source.sourceRef === failed.sourceRef) {
          throw new Error('private source failure');
        }
        return {
          delivery: healthySource,
          registry,
          services: serviceProvider(),
          release: () => undefined,
        };
      },
      onError: (error) => errors.push(error),
    });

    await dispatcher.drainNow();
    expect(errors).toHaveLength(1);
    expect(healthySource.completed).toBe(1);
    await dispatcher.close();
    await expect(dispatcher.drainNow()).rejects.toMatchObject({
      code: 'DATABASE_CLOSED',
    });
  });

  test('gives a later source a turn before continuing an earlier backlog', async () => {
    const handled: string[] = [];
    const durable = defineDatabaseFunction<{ source: string }, void, {}>({
      name: 'jobs.dispatch',
      version: 1,
      mode: 'durable',
      handler: async ({ input }) => {
        handled.push(input.source);
      },
    });
    const registry = defineDatabaseAutomations({ functions: [durable] });
    const heavy = sourceRecord('heavy', 1);
    const late = sourceRecord('late', 2);
    const deliverySources = new Map([
      [heavy.sourceRef, new QueuedDeliverySource(Array.from(
        { length: 5 },
        (_, index) => claim(
          `heavy-${index}`,
          durable.identity,
          registry.fingerprint,
        ),
      ))],
      [late.sourceRef, new QueuedDeliverySource([
        claim('late', durable.identity, registry.fingerprint),
      ])],
    ]);
    const dispatcher = new DatabaseAutomationDispatcher({
      catalog: catalog([heavy, late]),
      leaseOwner: 'dispatcher-fairness',
      sourceConcurrency: 1,
      acquire: async (source) => ({
        delivery: deliverySources.get(source.sourceRef)!,
        registry,
        services: serviceProvider(),
        release: () => undefined,
      }),
    });

    await dispatcher.drainNow();
    expect(handled.slice(0, 2)).toEqual(['heavy-0', 'late']);
    await waitUntil(() => deliverySources.get(heavy.sourceRef)!.completed === 5);
    expect(deliverySources.get(late.sourceRef)!.completed).toBe(1);
    await dispatcher.close();
  });
});

class OneDeliverySource implements DatabaseAutomationDeliverySource {
  private next: ClaimedDatabaseAutomationDelivery | null;
  completed = 0;

  constructor(delivery: ClaimedDatabaseAutomationDelivery) {
    this.next = delivery;
  }

  async claim(): Promise<ClaimedDatabaseAutomationDelivery | null> {
    const next = this.next;
    this.next = null;
    return next;
  }

  async renew(
    lease: DatabaseAutomationDeliveryLease,
    now: number,
    leaseMs: number,
  ): Promise<ClaimedDatabaseAutomationDelivery | null> {
    return { ...(lease as ClaimedDatabaseAutomationDelivery), updatedAt: now,
      leaseExpiresAt: now + leaseMs };
  }

  async complete(): Promise<'completed'> {
    this.completed += 1;
    return 'completed';
  }

  async retry(): Promise<'pending'> { return 'pending'; }
  async dead(): Promise<'dead'> { return 'dead'; }
  async recoverExpired(): Promise<{ requeued: number; dead: number }> {
    return { requeued: 0, dead: 0 };
  }
  async counts(): Promise<DatabaseAutomationOutboxCounts> {
    return {
      totalRecords: 0,
      activeRecords: 0,
      activeBytes: 0,
      pendingRecords: 0,
      processingRecords: 0,
      completedRecords: 0,
      deadRecords: 0,
    };
  }
}

class QueuedDeliverySource implements DatabaseAutomationDeliverySource {
  completed = 0;

  constructor(
    private readonly deliveries: ClaimedDatabaseAutomationDelivery[],
  ) {}

  async claim(): Promise<ClaimedDatabaseAutomationDelivery | null> {
    return this.deliveries.shift() ?? null;
  }

  async renew(
    lease: DatabaseAutomationDeliveryLease,
    now: number,
    leaseMs: number,
  ): Promise<ClaimedDatabaseAutomationDelivery | null> {
    return {
      ...(lease as ClaimedDatabaseAutomationDelivery),
      updatedAt: now,
      leaseExpiresAt: now + leaseMs,
    };
  }

  async complete(): Promise<'completed'> {
    this.completed += 1;
    return 'completed';
  }

  async retry(): Promise<'pending'> { return 'pending'; }
  async dead(): Promise<'dead'> { return 'dead'; }
  async recoverExpired(): Promise<{ requeued: number; dead: number }> {
    return { requeued: 0, dead: 0 };
  }
  async counts(): Promise<DatabaseAutomationOutboxCounts> {
    return {
      totalRecords: this.deliveries.length,
      activeRecords: this.deliveries.length,
      activeBytes: 0,
      pendingRecords: this.deliveries.length,
      processingRecords: 0,
      completedRecords: this.completed,
      deadRecords: 0,
    };
  }
}

function serviceProvider(): DatabaseAutomationExecutionServiceProvider<{}> {
  return {
    async create() {
      return {
        zero: {},
        assertCurrentAuthority: () => undefined,
        close: () => undefined,
      };
    },
  };
}

function catalog(
  sources: readonly DatabaseAutomationSourceRecord[],
): DatabaseAutomationSourceCatalog {
  return {
    scan: () => ({
      sources,
      page: {
        limit: 100,
        count: sources.length,
        hasMore: false,
        nextCursor: null,
      },
    }),
  } as unknown as DatabaseAutomationSourceCatalog;
}

function sourceRecord(id: string, ordinal: number): DatabaseAutomationSourceRecord {
  return {
    sourceRef: id.repeat(64),
    sourceKind: 'named',
    logicalSourceId: id,
    authority: {
      scopeKind: 'application',
      scopeId: 'application',
      tenantId: null,
    },
    status: 'active',
    revision: 1,
    ordinal,
    registeredAt: 1,
    updatedAt: 1,
  };
}

function claim(
  source: string,
  functionIdentity: string,
  manifestFingerprint: string,
): ClaimedDatabaseAutomationDelivery {
  return {
    deliveryId: `delivery-${source}`,
    invocationId: `invocation-${source}`,
    triggerIdentity: 'trigger:jobs.changed@1',
    functionIdentity,
    manifestFingerprint,
    realmName: 'jobs.realm',
    realmFingerprint: `sha256:${'a'.repeat(64)}`,
    sourceSequence: 1,
    sourceTable: 'jobs',
    sourceOperation: 'insert',
    sourceRowId: source,
    input: { source },
    status: 'processing',
    attemptCount: 1,
    maxAttempts: 20,
    availableAt: 1,
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
    lastErrorCode: null,
    insertionOrdinal: 1,
    leaseOwner: 'dispatcher-one',
    leaseToken: `lease-${source}`,
    leaseExpiresAt: 10_000,
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Bun.sleep(1);
  }
  throw new Error('condition not reached');
}
