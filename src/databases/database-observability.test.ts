import { describe, expect, test } from 'bun:test';

import { OBS_CODES } from '../observability/codes';
import { MemoryEventStore } from '../observability/memory-event-store';
import { configureObservability } from '../observability/sink';
import type { PlatformObservabilityRuntime } from '../observability/types';
import { DatabaseError } from './database-error';
import { createDatabaseRef } from './database-file';
import {
  DATABASE_OBSERVABILITY_MAX_COUNT,
  DatabaseObservability,
  createDatabaseObservability,
  emitDatabaseObservabilityEvent,
  type DatabaseObservabilityEvent,
} from './database-observability';

const EXPECTED_DATABASE_CODES = [
  'DATABASE_COORDINATOR_CONFIGURED',
  'DATABASE_COORDINATOR_STARTED',
  'DATABASE_COORDINATOR_DRAINING',
  'DATABASE_COORDINATOR_STOPPED',
  'DATABASE_COORDINATOR_FAILED',
  'DATABASE_EXECUTOR_RESTARTED',
  'DATABASE_EXECUTOR_FAILED',
  'DATABASE_RUNTIME_OPENED',
  'DATABASE_RUNTIME_CLOSED',
  'DATABASE_RUNTIME_OPEN_FAILED',
  'DATABASE_RUNTIME_EVICTED',
  'DATABASE_QUEUE_SATURATED',
  'DATABASE_CAPACITY_EXHAUSTED',
  'DATABASE_QUEUE_TIMEOUT',
  'DATABASE_OPERATION_FAILED',
  'DATABASE_OPERATION_OUTCOME_UNKNOWN',
  'DATABASE_CHANGE_WAKEUP',
  'DATABASE_REPLAY_FAILED',
  'DATABASE_TENANT_SNAPSHOT_FAILED',
  'DATABASE_HOT_SNAPSHOT_STARTED',
  'DATABASE_HOT_SNAPSHOT_FINISHED',
  'DATABASE_HOT_DURABILITY_DIRTY',
  'DATABASE_HOT_DURABILITY_CLEAN',
  'DATABASE_HOT_DURABILITY_FAILED',
  'DATABASE_RECEIPT_LOOKUP_FAILED',
  'DATABASE_RECEIPT_EXPIRED',
  'DATABASE_RECEIPT_COMPACTED',
  'DATABASE_HISTORY_GAP',
] as const;

describe('database observability codes', () => {
  test('registers one stable database category and prefix namespace', () => {
    const names = Object.keys(OBS_CODES)
      .filter((name) => name.startsWith('DATABASE_'));

    expect(names).toEqual([...EXPECTED_DATABASE_CODES]);
    for (const name of EXPECTED_DATABASE_CODES) {
      const definition = OBS_CODES[name];
      expect(definition.category).toBe('database');
      expect(definition.code.startsWith('database.')).toBe(true);
      expect(definition.prefix).toBe(`ZERO_${name}`);
    }
  });
});

describe('DatabaseObservability', () => {
  test('emits only closed permanent-capacity metadata', () => {
    const store = new MemoryEventStore();
    const observer = createDatabaseObservability(runtimeFor(store));
    const databaseRef = createDatabaseRef('capacity-database');
    const event = observer.emit({
      type: 'capacity-exhausted',
      databaseRef,
      capacityType: 'receipts',
      capacityLimit: 1_000_000,
    });

    expect(event.code).toBe(OBS_CODES.DATABASE_CAPACITY_EXHAUSTED.code);
    expect(event.error).toBeUndefined();
    expect(event.metadata).toEqual({
      databaseRef,
      capacityType: 'receipts',
      capacityLimit: 1_000_000,
    });
    expect(() => observer.emit({
      type: 'capacity-exhausted',
      databaseRef,
      capacityType: 'tenant-private' as never,
      capacityLimit: 1,
    })).toThrow('capacity type');
  });

  test('emits bounded coordinator file and tenant Sync limits', () => {
    const store = new MemoryEventStore();
    const event = createDatabaseObservability(runtimeFor(store)).emit({
      type: 'coordinator-configured',
      writerLimit: 16,
      readerLimit: 16,
      runtimeLimit: 16,
      fileLimit: 10_000,
      syncDatabaseLimit: 15,
      syncBindingLimit: 64,
      queueLimit: 1_024,
    });

    expect(event.metadata).toEqual({
      writerLimit: 16,
      readerLimit: 16,
      runtimeLimit: 16,
      fileLimit: 10_000,
      syncDatabaseLimit: 15,
      syncBindingLimit: 64,
      queueLimit: 1_024,
    });
  });

  test('emits only to its explicitly bound app runtime', () => {
    const ambientStore = new MemoryEventStore();
    const appAStore = new MemoryEventStore();
    const appBStore = new MemoryEventStore();
    configureObservability({ console: false, store: ambientStore });

    try {
      const appA = createDatabaseObservability(runtimeFor(appAStore));
      const appB = new DatabaseObservability(runtimeFor(appBStore));

      appA.emit({
        type: 'coordinator-started',
        writerCount: 2,
        readerCount: 4,
        runtimeCount: 0,
      });
      appB.emit({
        type: 'coordinator-draining',
        reason: 'shutdown',
        activeCount: 1,
        queueDepth: 0,
      });

      expect(appAStore.query().events.map((event) => event.code)).toEqual([
        OBS_CODES.DATABASE_COORDINATOR_STARTED.code,
      ]);
      expect(appBStore.query().events.map((event) => event.code)).toEqual([
        OBS_CODES.DATABASE_COORDINATOR_DRAINING.code,
      ]);
      expect(ambientStore.query().count).toBe(0);
    } finally {
      configureObservability(false);
    }
  });

  test('normalizes failures without emitting raw errors, messages, or details', () => {
    const store = new MemoryEventStore();
    const databaseRef = createDatabaseRef('private-tenant-name');
    const secret = '/private/tenant.sqlite SELECT secret FROM patients';
    const cause = new Error(secret);
    cause.stack = `private-stack:${secret}`;
    const error = new DatabaseError(
      'DATABASE_OPERATION_TIMEOUT',
      secret,
      {
        cause,
        details: {
          path: '/private/tenant.sqlite',
          sql: 'SELECT secret FROM patients',
          queueDepth: 7,
        },
      },
    );

    const event = createDatabaseObservability(runtimeFor(store)).emit({
      type: 'operation-failed',
      databaseRef,
      role: 'writer',
      slot: 3,
      generation: 8,
      operation: 'mutation',
      durationMs: 250,
      error,
    });
    const encoded = JSON.stringify(event);

    expect(event.code).toBe(OBS_CODES.DATABASE_OPERATION_FAILED.code);
    expect(event.message).toBe(OBS_CODES.DATABASE_OPERATION_FAILED.message);
    expect(event.metadata).toEqual({
      databaseRef,
      role: 'writer',
      slot: 3,
      generation: 8,
      operation: 'mutation',
      durationMs: 250,
      errorCode: 'DATABASE_OPERATION_TIMEOUT',
      retryable: false,
      outcome: 'unknown',
    });
    expect(event.error).toBeUndefined();
    expect(encoded).not.toContain('private-tenant-name');
    expect(encoded).not.toContain('/private/tenant.sqlite');
    expect(encoded).not.toContain('SELECT secret');
    expect(encoded).not.toContain('private-stack');
    expect(encoded).not.toContain('queueDepth');
  });

  test('emits only the correlated hot max-bytes failure classifier', () => {
    const store = new MemoryEventStore();
    const observer = createDatabaseObservability(runtimeFor(store));
    const databaseRef = createDatabaseRef('hot-capacity-database');
    const error = new DatabaseError(
      'DATABASE_PAYLOAD_LIMIT',
      'private SQLite failure',
      {
        outcome: 'not-committed',
        details: {
          reason: 'max-bytes',
          path: '/private/hot.sqlite',
        },
      },
    );
    const event = observer.emit({
      type: 'operation-failed',
      databaseRef,
      placement: 'hot',
      role: 'writer',
      slot: 1,
      generation: 2,
      operation: 'mutation',
      durationMs: 3,
      failureReason: 'hot-max-bytes',
      error,
    });

    expect(event.metadata).toEqual({
      databaseRef,
      placement: 'hot',
      role: 'writer',
      slot: 1,
      generation: 2,
      operation: 'mutation',
      durationMs: 3,
      failureReason: 'hot-max-bytes',
      errorCode: 'DATABASE_PAYLOAD_LIMIT',
      retryable: false,
      outcome: 'not-committed',
    });
    expect(JSON.stringify(event)).not.toContain('/private/hot.sqlite');
    expect(() => observer.emit({
      type: 'operation-failed',
      databaseRef,
      placement: 'file',
      role: 'writer',
      slot: 1,
      generation: 2,
      operation: 'mutation',
      durationMs: 3,
      failureReason: 'hot-max-bytes',
      error,
    })).toThrow('operation failure reason');
    expect(() => observer.emit({
      type: 'operation-failed',
      databaseRef,
      placement: 'hot',
      role: 'writer',
      slot: 1,
      generation: 2,
      operation: 'mutation',
      durationMs: 3,
      failureReason: 'private-value' as never,
      error,
    })).toThrow('operation failure reason');
  });

  test('normalizes unknown caught values to the safe executor failure contract', () => {
    const store = new MemoryEventStore();
    const databaseRef = createDatabaseRef('unknown-failure-database');
    const privateText = 'token=private path=/private/database.sqlite';
    const runtime = runtimeFor(store);
    const event = emitDatabaseObservabilityEvent(runtime, {
      type: 'runtime-open-failed',
      databaseRef,
      durationMs: 11,
      error: new Error(privateText, {
        cause: { sql: 'SELECT * FROM private_rows' },
      }),
    });

    expect(event.metadata).toEqual({
      databaseRef,
      durationMs: 11,
      errorCode: 'DATABASE_EXECUTOR_FAILED',
      retryable: false,
      outcome: 'unknown',
    });
    expect(JSON.stringify(event)).not.toContain(privateText);
    expect(JSON.stringify(event)).not.toContain('private_rows');

    const hostileError = new Proxy({}, {
      getPrototypeOf() {
        throw new Error(privateText);
      },
    });
    const hostileEvent = emitDatabaseObservabilityEvent(runtime, {
      type: 'coordinator-failed',
      phase: 'start',
      error: hostileError,
    });
    expect(hostileEvent.metadata).toEqual({
      phase: 'start',
      errorCode: 'DATABASE_EXECUTOR_FAILED',
      retryable: false,
      outcome: 'unknown',
    });
    expect(JSON.stringify(hostileEvent)).not.toContain(privateText);
  });

  test('emits only bounded placement data for periodic hot durability failure', () => {
    const store = new MemoryEventStore();
    const databaseRef = createDatabaseRef('private-periodic-tenant');
    const privateFailure = '/private/tenant.sqlite token=secret';
    const event = createDatabaseObservability(runtimeFor(store)).emit({
      type: 'hot-durability-failed',
      databaseRef,
      placement: 'hot',
      durability: 'periodic',
      role: 'writer',
      slot: 2,
      generation: 4,
      error: new Error(privateFailure),
    });

    expect(event.code).toBe(OBS_CODES.DATABASE_HOT_DURABILITY_FAILED.code);
    expect(event.metadata).toEqual({
      databaseRef,
      placement: 'hot',
      durability: 'periodic',
      role: 'writer',
      slot: 2,
      generation: 4,
      errorCode: 'DATABASE_EXECUTOR_FAILED',
      retryable: false,
      outcome: 'unknown',
    });
    expect(JSON.stringify(event)).not.toContain(privateFailure);
    expect(() => createDatabaseObservability(runtimeFor(store)).emit({
      type: 'hot-durability-failed',
      databaseRef,
      placement: 'file' as 'hot',
      durability: 'periodic',
      role: 'writer',
      slot: 2,
      generation: 4,
      error: new Error(privateFailure),
    })).toThrow('Invalid hot database durability observability event');
  });

  test('emits payload-free periodic hot snapshot and dirty-window lifecycle', () => {
    const store = new MemoryEventStore();
    const observer = createDatabaseObservability(runtimeFor(store));
    const databaseRef = createDatabaseRef('periodic-lifecycle-tenant');
    const inputs = [
      ['hot-snapshot-started', OBS_CODES.DATABASE_HOT_SNAPSHOT_STARTED.code],
      ['hot-snapshot-finished', OBS_CODES.DATABASE_HOT_SNAPSHOT_FINISHED.code],
      ['hot-durability-dirty', OBS_CODES.DATABASE_HOT_DURABILITY_DIRTY.code],
      ['hot-durability-clean', OBS_CODES.DATABASE_HOT_DURABILITY_CLEAN.code],
    ] as const;

    for (const [type, code] of inputs) {
      const event = observer.emit({
        type,
        databaseRef,
        placement: 'hot',
        durability: 'periodic',
        role: 'writer',
        slot: 3,
        generation: 7,
      });
      expect(event.code).toBe(code);
      expect(event.metadata).toEqual({
        databaseRef,
        placement: 'hot',
        durability: 'periodic',
        role: 'writer',
        slot: 3,
        generation: 7,
      });
    }

    expect(() => observer.emit({
      type: 'hot-durability-dirty',
      databaseRef,
      placement: 'file' as 'hot',
      durability: 'periodic',
      role: 'writer',
      slot: 3,
      generation: 7,
    })).toThrow('Invalid hot database durability observability event');
  });

  test('emits change wakeups and history gaps without row data', () => {
    const store = new MemoryEventStore();
    const observer = createDatabaseObservability(runtimeFor(store));
    const databaseRef = createDatabaseRef('reactive-database');

    observer.emit({
      type: 'change-wakeup',
      databaseRef,
      generation: 2,
      sequenceStart: 10,
      sequenceEnd: 14,
    });
    observer.emit({
      type: 'history-gap',
      databaseRef,
      generation: 2,
      sequenceStart: 15,
      sequenceEnd: 20,
      reason: 'history-gap',
    });

    const events = store.query().events;
    expect(events.map((event) => event.code)).toEqual([
      OBS_CODES.DATABASE_CHANGE_WAKEUP.code,
      OBS_CODES.DATABASE_HISTORY_GAP.code,
    ]);
    expect(events.map((event) => event.metadata)).toEqual([
      { databaseRef, generation: 2, sequenceStart: 10, sequenceEnd: 14 },
      {
        databaseRef,
        generation: 2,
        sequenceStart: 15,
        sequenceEnd: 20,
        reason: 'history-gap',
      },
    ]);
  });

  test('keeps tenant snapshots and receipt outcomes distinct from replay', () => {
    const store = new MemoryEventStore();
    const observer = createDatabaseObservability(runtimeFor(store));
    const databaseRef = createDatabaseRef('private-tenant-receipts');
    const privateReceipt = 'receipt-key=private fingerprint=private';

    observer.emit({
      type: 'tenant-snapshot-failed',
      databaseRef,
      role: 'writer',
      slot: 1,
      generation: 2,
      sequenceStart: 14,
      sequenceEnd: 14,
      durationMs: 7,
      error: new DatabaseError('DATABASE_PROTOCOL_ERROR', privateReceipt),
    });
    observer.emit({
      type: 'receipt-lookup-failed',
      databaseRef,
      role: 'writer',
      slot: 1,
      generation: 2,
      durationMs: 3,
      error: new DatabaseError('DATABASE_EXECUTOR_FAILED', privateReceipt),
    });
    observer.emit({
      type: 'receipt-expired',
      databaseRef,
      role: 'writer',
      slot: 1,
      generation: 2,
      durationMs: 1,
      error: new DatabaseError('DATABASE_OUTCOME_UNKNOWN', privateReceipt, {
        details: { receiptState: 'expired', receiptKey: privateReceipt },
      }),
    });
    observer.emit({
      type: 'receipt-compacted',
      databaseRef,
      role: 'writer',
      slot: 1,
      generation: 2,
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

    expect(store.query().events.map((event) => event.code)).toEqual([
      OBS_CODES.DATABASE_TENANT_SNAPSHOT_FAILED.code,
      OBS_CODES.DATABASE_RECEIPT_LOOKUP_FAILED.code,
      OBS_CODES.DATABASE_RECEIPT_EXPIRED.code,
      OBS_CODES.DATABASE_RECEIPT_COMPACTED.code,
    ]);
    expect(JSON.stringify(store.query().events)).not.toContain(privateReceipt);
    expect(store.query().events.at(-1)?.metadata).toEqual({
      databaseRef,
      role: 'writer',
      slot: 1,
      generation: 2,
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
  });

  test('fails closed on raw fields, malformed references, and unbounded values', () => {
    const store = new MemoryEventStore();
    const observer = createDatabaseObservability(runtimeFor(store));
    const databaseRef = createDatabaseRef('bounded-database');
    const valid = {
      type: 'queue-timeout',
      databaseRef,
      operation: 'query',
      queueDepth: 1,
      durationMs: 20,
    } as const;
    const invalid: unknown[] = [
      { ...valid, path: '/private/database.sqlite' },
      { ...valid, sql: 'SELECT secret FROM patients' },
      { ...valid, rows: [{ private: true }] },
      { ...valid, queryInput: { password: 'private' } },
      { ...valid, metadata: { arbitrary: 'private' } },
      { ...valid, databaseRef: '/private/database.sqlite' },
      { ...valid, databaseRef: databaseRef.toUpperCase() },
      { ...valid, operation: 'SELECT' },
      { ...valid, durationMs: Number.POSITIVE_INFINITY },
      { ...valid, queueDepth: -1 },
      {
        type: 'coordinator-started',
        writerCount: DATABASE_OBSERVABILITY_MAX_COUNT + 1,
        readerCount: 0,
        runtimeCount: 0,
      },
      {
        type: 'change-wakeup',
        databaseRef,
        sequenceStart: 3,
        sequenceEnd: 2,
      },
      { ...valid, type: 'unknown-database-event' },
      { ...valid, get operation() { return 'query'; } },
      new Proxy({}, {
        ownKeys() {
          throw new Error('private proxy failure');
        },
      }),
    ];

    for (const value of invalid) {
      expect(() => observer.emit(
        value as DatabaseObservabilityEvent,
      )).toThrow();
    }
    expect(store.query().count).toBe(0);
  });

  test('requires an explicit app-local runtime', () => {
    expect(() => new DatabaseObservability(
      undefined as unknown as PlatformObservabilityRuntime,
    )).toThrow('app-local observability runtime');
    expect(() => new DatabaseObservability({
      sink: {} as PlatformObservabilityRuntime['sink'],
      store: null,
      config: {},
    })).toThrow('app-local observability runtime');
  });
});

function runtimeFor(store: MemoryEventStore): PlatformObservabilityRuntime {
  return {
    sink: store,
    store,
    config: { console: false, store },
  };
}
