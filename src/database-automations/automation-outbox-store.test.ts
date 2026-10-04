import { afterEach, describe, expect, test } from 'bun:test';
import { ReactiveDB } from '../sync/reactive-db';
import type { DatabaseAutomationValue } from './database-function';
import {
  type ClaimedDatabaseAutomationDelivery,
  type DatabaseAutomationOutboxEnqueueInput,
  type DatabaseAutomationOutboxLimits,
} from './automation-outbox-contracts';
import {
  DATABASE_AUTOMATION_OUTBOX_UPDATE_STATE,
} from './automation-outbox-schema-sql';
import { DatabaseAutomationOutboxStore } from './automation-outbox-store';

const fingerprintA = `sha256:${'a'.repeat(64)}`;
const fingerprintB = `sha256:${'b'.repeat(64)}`;
const filePaths: string[] = [];

afterEach(async () => {
  for (const path of filePaths.splice(0)) {
    await Bun.file(path).delete().catch(() => {});
    await Bun.file(`${path}-wal`).delete().catch(() => {});
    await Bun.file(`${path}-shm`).delete().catch(() => {});
  }
});

describe('DatabaseAutomationOutboxStore', () => {
  test('commits and rolls back with the originating ReactiveDB transaction', () => {
    const harness = memoryHarness();
    expect(() => harness.db.transaction(() => {
      harness.db.insert('items', { id: 'rolled-back', value: 1 });
      harness.store.enqueue(command(1), 100);
      throw new Error('application transaction rejected');
    })).toThrow('application transaction rejected');

    expect(harness.db.get('items', 'rolled-back')).toBeNull();
    expect(harness.store.get('delivery:1')).toBeNull();
    expect(harness.store.counts()).toEqual({
      totalRecords: 0,
      activeRecords: 0,
      activeBytes: 0,
      pendingRecords: 0,
      processingRecords: 0,
      completedRecords: 0,
      deadRecords: 0,
    });

    harness.db.transaction(() => {
      harness.db.insert('items', { id: 'committed', value: 2 });
      harness.store.enqueue(command(2), 200);
    });
    expect(harness.db.get('items', 'committed')).toEqual({
      id: 'committed',
      value: 2,
    });
    expect(harness.store.get('delivery:2')?.status).toBe('pending');
    harness.close();
  });

  test('preserves source insertion order across availability and active claims', () => {
    const harness = memoryHarness();
    harness.store.enqueue(command(1, { availableAt: 300 }), 100);
    harness.store.enqueue(command(2, { availableAt: 200 }), 100);
    harness.store.enqueue(command(3, { availableAt: 200 }), 100);

    expect(harness.store.claim('worker:one', 200, 1_000)).toBeNull();
    const first = requiredClaim(harness.store.claim('worker:one', 300, 1_000));
    expect(harness.store.claim('worker:two', 300, 1_000)).toBeNull();
    expect(harness.store.complete(first, 301)).toBe('completed');
    const second = requiredClaim(harness.store.claim('worker:one', 300, 1_000));
    expect(harness.store.complete(second, 302)).toBe('completed');
    const third = requiredClaim(harness.store.claim('worker:one', 300, 1_000));
    expect([first.deliveryId, second.deliveryId, third.deliveryId]).toEqual([
      'delivery:1',
      'delivery:2',
      'delivery:3',
    ]);
    expect(harness.store.complete(third, 303)).toBe('completed');
    expect(harness.store.claim('worker:one', 300, 1_000)).toBeNull();
    harness.close();
  });

  test('does not leapfrog an earlier delivery while it waits to retry', () => {
    const harness = memoryHarness();
    harness.store.enqueue(command(1), 100);
    harness.store.enqueue(command(2), 100);

    const first = requiredClaim(harness.store.claim('worker:one', 100, 1_000));
    expect(harness.store.retry(first, 'AUTOMATION_RETRY', 500, 200))
      .toBe('pending');
    expect(harness.store.claim('worker:one', 499, 1_000)).toBeNull();
    const retried = requiredClaim(harness.store.claim('worker:one', 500, 1_000));
    expect(retried.deliveryId).toBe('delivery:1');
    expect(harness.store.complete(retried, 501)).toBe('completed');
    expect(requiredClaim(
      harness.store.claim('worker:one', 501, 1_000),
    ).deliveryId).toBe('delivery:2');
    harness.close();
  });

  test('claims canonical null inputs and accepts minimal lease fences', () => {
    const harness = memoryHarness();
    harness.store.enqueue(command(1, { input: null }), 100);

    const claim = requiredClaim(harness.store.claim('worker:one', 100, 1_000));
    expect(claim.input).toBeNull();
    const lease = {
      deliveryId: claim.deliveryId,
      leaseOwner: claim.leaseOwner,
      leaseToken: claim.leaseToken,
      updatedAt: claim.updatedAt,
    };
    const renewed = requiredClaim(harness.store.renew(lease, 200, 1_000));
    expect(renewed.input).toBeNull();
    expect(harness.store.complete({
      ...lease,
      updatedAt: renewed.updatedAt,
    }, 300)).toBe('completed');
    harness.close();
  });

  test('fences expired leases and stale renew, completion, retry, and dead calls', () => {
    const harness = memoryHarness();
    harness.store.enqueue(command(1), 1_000);
    const stale = requiredClaim(harness.store.claim('worker:one', 1_000, 1_000));
    expect(harness.store.recoverExpired(2_000)).toEqual({ requeued: 1, dead: 0 });
    const current = requiredClaim(harness.store.claim('worker:two', 2_000, 1_000));
    expect(current.leaseToken).not.toBe(stale.leaseToken);

    expect(harness.store.renew(stale, 2_001, 1_000)).toBeNull();
    expect(harness.store.complete(stale, 2_001)).toBe('stale');
    expect(harness.store.retry(stale, 'AUTOMATION_TEMPORARY', 2_500, 2_001))
      .toBe('stale');
    expect(harness.store.dead(stale, 'AUTOMATION_PERMANENT', 2_001)).toBe('stale');
    expect(harness.store.get(current.deliveryId)?.status).toBe('processing');

    const renewed = requiredClaim(harness.store.renew(current, 2_100, 1_000));
    expect(renewed.leaseToken).toBe(current.leaseToken);
    expect(renewed.leaseExpiresAt).toBe(3_100);
    expect(harness.store.recoverExpired(3_000)).toEqual({ requeued: 0, dead: 0 });
    expect(harness.store.complete(renewed, 3_000)).toBe('completed');
    expect(harness.store.renew(renewed, 3_001, 1_000)).toBeNull();
    harness.close();
  });

  test('renewed attempts can retry but cannot renew after the transition', () => {
    const harness = memoryHarness();
    harness.store.enqueue(command(1), 100);
    const claim = requiredClaim(harness.store.claim('worker:one', 100, 1_000));
    const renewed = requiredClaim(harness.store.renew(claim, 200, 1_000));
    expect(harness.store.retry(renewed, 'AUTOMATION_RETRY', 400, 300))
      .toBe('pending');
    expect(harness.store.renew(renewed, 301, 1_000)).toBeNull();
    expect(harness.store.get(claim.deliveryId)?.status).toBe('pending');
    harness.close();
  });

  test('retries until the persisted maximum then scrubs a dead letter', () => {
    const harness = memoryHarness({ maxAttempts: 2 });
    harness.store.enqueue(command(1), 100);
    const first = requiredClaim(harness.store.claim('worker:one', 100, 1_000));
    expect(harness.store.retry(first, 'AUTOMATION_RETRY', 200, 150)).toBe('pending');
    const second = requiredClaim(harness.store.claim('worker:one', 200, 1_000));
    expect(second.attemptCount).toBe(2);
    expect(harness.store.retry(second, 'AUTOMATION_RETRY', 300, 250)).toBe('dead');
    expect(harness.store.get(second.deliveryId)).toMatchObject({
      status: 'dead',
      input: null,
      attemptCount: 2,
      lastErrorCode: 'AUTOMATION_RETRY',
    });
    expect(harness.store.counts()).toMatchObject({
      activeRecords: 0,
      activeBytes: 0,
      deadRecords: 1,
    });
    harness.close();
  });

  test('dead-letters an exhausted attempt during expired-lease recovery', () => {
    const harness = memoryHarness({ maxAttempts: 1 });
    harness.store.enqueue(command(1), 100);
    harness.store.claim('worker:one', 100, 1_000);
    expect(harness.store.recoverExpired(1_100)).toEqual({ requeued: 0, dead: 1 });
    expect(harness.store.get('delivery:1')).toMatchObject({
      status: 'dead',
      input: null,
      lastErrorCode: 'AUTOMATION_MAX_ATTEMPTS',
    });
    harness.close();
  });

  test('enforces payload and active bounds while compacting terminal metadata', () => {
    const payloadHarness = memoryHarness({
      maxPayloadBytes: 16,
      maxActiveBytes: 16,
    });
    expect(captureError(() => payloadHarness.store.enqueue(command(1, {
      input: 'this payload exceeds sixteen bytes',
    }), 100))).toMatchObject({ code: 'DATABASE_PAYLOAD_LIMIT' });
    payloadHarness.close();

    const harness = memoryHarness({
      maxActiveRecords: 1,
      maxStoredRecords: 2,
      maxTerminalRecords: 1,
    });
    harness.store.enqueue(command(1), 100);
    expect(captureError(() => harness.store.enqueue(command(2), 100))).toMatchObject({
      code: 'DATABASE_BACKPRESSURE',
      retryable: true,
      outcome: 'not-started',
    });
    const first = requiredClaim(harness.store.claim('worker:one', 100, 1_000));
    expect(harness.store.complete(first, 200)).toBe('completed');
    harness.store.enqueue(command(2), 200);
    const second = requiredClaim(harness.store.claim('worker:one', 200, 1_000));
    expect(harness.store.complete(second, 300)).toBe('completed');
    expect(harness.store.get('delivery:1')).toBeNull();
    expect(harness.store.get('delivery:2')).toMatchObject({
      status: 'completed',
      insertionOrdinal: 2,
    });
    expect(harness.store.enqueue(command(3), 300)).toMatchObject({
      status: 'enqueued',
      deliveryId: 'delivery:3',
    });
    expect(harness.store.get('delivery:3')).toMatchObject({
      status: 'pending',
      insertionOrdinal: 3,
    });
    harness.close();
  });

  test('keeps ordinals monotonic when terminal retention is disabled', () => {
    const harness = memoryHarness({
      maxActiveRecords: 1,
      maxStoredRecords: 1,
      maxTerminalRecords: 0,
    });
    harness.store.enqueue(command(1), 100);
    const first = requiredClaim(harness.store.claim('worker:one', 100, 1_000));
    expect(harness.store.complete(first, 200)).toBe('completed');
    expect(harness.store.counts()).toMatchObject({
      totalRecords: 0,
      activeRecords: 0,
      completedRecords: 0,
    });
    harness.store.enqueue(command(2), 200);
    expect(harness.store.get('delivery:2')).toMatchObject({
      insertionOrdinal: 2,
      status: 'pending',
    });
    harness.close();
  });

  test('compacts retained terminal rows on restart and never deletes active work', () => {
    const harness = memoryHarness();
    harness.store.enqueue(command(1), 100);
    const deleteActive = harness.db.prepare(`
      DELETE FROM _zero_database_automation_outbox
      WHERE delivery_id = 'delivery:1'
    `);
    try {
      expect(() => deleteActive.run())
        .toThrow(/active automation delivery cannot be deleted/u);
    } finally {
      deleteActive.finalize();
    }
    const first = requiredClaim(harness.store.claim('worker:one', 100, 1_000));
    expect(harness.store.complete(first, 200)).toBe('completed');
    harness.store.enqueue(command(2), 200);
    const second = requiredClaim(harness.store.claim('worker:one', 200, 1_000));
    expect(harness.store.complete(second, 300)).toBe('completed');
    harness.store.close();

    const reopened = new DatabaseAutomationOutboxStore({
      db: harness.db,
      limits: {
        maxActiveRecords: 1,
        maxStoredRecords: 2,
        maxTerminalRecords: 1,
      },
    });
    expect(reopened.get('delivery:1')).toBeNull();
    expect(reopened.get('delivery:2')).toMatchObject({
      status: 'completed',
      insertionOrdinal: 2,
    });
    reopened.enqueue(command(3), 300);
    expect(reopened.get('delivery:3')).toMatchObject({
      status: 'pending',
      insertionOrdinal: 3,
    });
    reopened.close();
    harness.db.dispose();
  });

  test('keeps stable IDs idempotent and rejects changed commands', () => {
    const harness = memoryHarness();
    expect(harness.store.enqueue(command(1), 100).status).toBe('enqueued');
    expect(harness.store.enqueue(command(1), 101).status).toBe('existing');
    expect(captureError(() => harness.store.enqueue(command(1, {
      input: { changed: true },
    }), 102))).toMatchObject({
      code: 'DATABASE_CONFLICT',
      outcome: 'not-committed',
    });
    const privateValue = 'private-payload-value-98c1';
    let failure: unknown;
    try {
      harness.store.enqueue(command(1, { input: privateValue }), 103);
    } catch (error) {
      failure = error;
    }
    expect(JSON.stringify(failure)).not.toContain(privateValue);
    harness.close();
  });

  test('rejects non-JSON input instead of silently collapsing it', () => {
    const harness = memoryHarness();
    for (const input of [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -0,
      new Date(),
      new Uint8Array([1, 2, 3]),
    ]) {
      expect(() => harness.store.enqueue(command(1, {
        input: input as DatabaseAutomationValue,
      }), 100)).toThrow();
    }
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(captureError(() => harness.store.enqueue(command(1, {
      input: cyclic as DatabaseAutomationValue,
    }), 100))).toMatchObject({ code: 'DATABASE_PAYLOAD_INVALID' });
    harness.close();
  });

  test('persists active commands across a clean database restart', async () => {
    const path = `/tmp/zero-automation-outbox-${crypto.randomUUID()}.sqlite`;
    filePaths.push(path);
    const firstDb = createDatabase(path);
    const firstStore = new DatabaseAutomationOutboxStore({ db: firstDb });
    firstStore.enqueue(command(1, { input: { durable: true } }), 100);
    firstStore.close();
    firstDb.dispose();

    const secondDb = createDatabase(path);
    const secondStore = new DatabaseAutomationOutboxStore({ db: secondDb });
    expect(secondStore.get('delivery:1')).toMatchObject({
      status: 'pending',
      input: { durable: true },
    });
    const claim = requiredClaim(secondStore.claim('worker:restart', 100, 1_000));
    expect(secondStore.complete(claim, 200)).toBe('completed');
    secondStore.close();
    secondDb.dispose();
  });

  test('fails closed when a private schema object is missing or changed', () => {
    const harness = memoryHarness();
    harness.store.enqueue(command(1), 100);
    harness.store.close();
    harness.db.exec(`DROP TRIGGER ${DATABASE_AUTOMATION_OUTBOX_UPDATE_STATE}`);
    expect(captureError(() => new DatabaseAutomationOutboxStore({ db: harness.db })))
      .toMatchObject({ code: 'DATABASE_SCHEMA_MISMATCH' });
    harness.db.dispose();
  });

  test('keeps independent records isolated through terminal transitions', () => {
    const harness = memoryHarness();
    harness.store.enqueue(command(1, { input: { value: 'one' } }), 100);
    harness.store.enqueue(command(2, { input: { value: 'two' } }), 100);
    const before = harness.store.counts();
    const first = requiredClaim(harness.store.claim('worker:one', 100, 1_000));
    expect(first.deliveryId).toBe('delivery:1');
    expect(harness.store.complete(first, 200)).toBe('completed');
    const remaining = harness.store.get('delivery:2');
    expect(remaining).toMatchObject({
      status: 'pending',
      input: { value: 'two' },
      attemptCount: 0,
    });
    expect(harness.store.counts()).toMatchObject({
      totalRecords: 2,
      activeRecords: 1,
      completedRecords: 1,
      pendingRecords: 1,
      activeBytes: before.activeBytes
        - new TextEncoder().encode('{"value":"one"}').byteLength,
    });
    harness.close();
  });
});

function memoryHarness(limits: Partial<DatabaseAutomationOutboxLimits> = {}) {
  const db = createDatabase('memory');
  const store = new DatabaseAutomationOutboxStore({ db, limits });
  return {
    db,
    store,
    close() {
      store.close();
      db.dispose();
    },
  };
}

function createDatabase(mode: string): ReactiveDB {
  const db = new ReactiveDB({
    mode,
    emitCode: () => {},
    emitTelemetry: false,
  });
  db.defineTable('items', {
    id: 'text primary key',
    value: 'integer not null',
  });
  return db;
}

function command(
  sequence: number,
  overrides: Partial<DatabaseAutomationOutboxEnqueueInput> = {},
): DatabaseAutomationOutboxEnqueueInput {
  return {
    deliveryId: `delivery:${sequence}`,
    invocationId: `invocation:${sequence}`,
    triggerIdentity: 'trigger:items.changed@1',
    functionIdentity: 'function:items.project@1',
    manifestFingerprint: fingerprintA,
    realmName: 'test.realm',
    realmFingerprint: fingerprintB,
    sourceSequence: sequence,
    sourceTable: 'items',
    sourceOperation: 'insert',
    sourceRowId: `row:${sequence}`,
    input: { sequence },
    ...overrides,
  };
}

function requiredClaim(
  value: ClaimedDatabaseAutomationDelivery | null,
): ClaimedDatabaseAutomationDelivery {
  expect(value).not.toBeNull();
  return value!;
}

function captureError(operation: () => unknown): unknown {
  try {
    operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to fail.');
}
