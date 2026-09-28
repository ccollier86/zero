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
  'DATABASE_EXECUTOR_STARTED',
  'DATABASE_EXECUTOR_READY',
  'DATABASE_EXECUTOR_EXITED',
  'DATABASE_EXECUTOR_RESTARTED',
  'DATABASE_EXECUTOR_FAILED',
  'DATABASE_RUNTIME_OPENED',
  'DATABASE_RUNTIME_CLOSED',
  'DATABASE_RUNTIME_OPEN_FAILED',
  'DATABASE_RUNTIME_EVICTED',
  'DATABASE_MIGRATION_STARTED',
  'DATABASE_MIGRATION_COMPLETED',
  'DATABASE_MIGRATION_FAILED',
  'DATABASE_QUEUE_SATURATED',
  'DATABASE_QUEUE_TIMEOUT',
  'DATABASE_OPERATION_SLOW',
  'DATABASE_OPERATION_FAILED',
  'DATABASE_OPERATION_OUTCOME_UNKNOWN',
  'DATABASE_CHANGE_WAKEUP',
  'DATABASE_REPLAY_STARTED',
  'DATABASE_REPLAY_COMPLETED',
  'DATABASE_REPLAY_FAILED',
  'DATABASE_HISTORY_GAP',
  'DATABASE_SHUTDOWN_GRACEFUL_STARTED',
  'DATABASE_SHUTDOWN_GRACEFUL_COMPLETED',
  'DATABASE_SHUTDOWN_GRACEFUL_FAILED',
  'DATABASE_SHUTDOWN_FORCED',
  'DATABASE_SHUTDOWN_FORCED_FAILED',
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

  test('emits change wakeups, replay ranges, and history gaps without row data', () => {
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
      type: 'replay-completed',
      databaseRef,
      generation: 2,
      sequenceStart: 10,
      sequenceEnd: 14,
      durationMs: 9,
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
      OBS_CODES.DATABASE_REPLAY_COMPLETED.code,
      OBS_CODES.DATABASE_HISTORY_GAP.code,
    ]);
    expect(events.map((event) => event.metadata)).toEqual([
      { databaseRef, generation: 2, sequenceStart: 10, sequenceEnd: 14 },
      {
        databaseRef,
        generation: 2,
        sequenceStart: 10,
        sequenceEnd: 14,
        durationMs: 9,
      },
      {
        databaseRef,
        generation: 2,
        sequenceStart: 15,
        sequenceEnd: 20,
        reason: 'history-gap',
      },
    ]);
  });

  test('fails closed on raw fields, malformed references, and unbounded values', () => {
    const store = new MemoryEventStore();
    const observer = createDatabaseObservability(runtimeFor(store));
    const databaseRef = createDatabaseRef('bounded-database');
    const valid = {
      type: 'operation-slow',
      databaseRef,
      operation: 'query',
      durationMs: 20,
      slowLimitMs: 10,
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
      { ...valid, slowLimitMs: -1 },
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
