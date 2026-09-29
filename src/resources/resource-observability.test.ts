import { describe, expect, test } from 'bun:test';

import { DatabaseError } from '../databases/database-error';
import { MemoryEventStore, OBS_CODES } from '../observability';
import type { PlatformObservabilityRuntime } from '../observability/types';
import {
  bindResourceObservabilityOwner,
  emitResourceCrudFailure,
  emitResourceReceiptCapacityExhausted,
  emitResourceReceiptCompacted,
  emitResourceReceiptExpired,
  warnResourcePolicy,
} from './resource-observability';

const PRIVATE_VALUE = '/private/workspace/tenant-secret.sqlite';

describe('Resource observability privacy boundary', () => {
  test('drops raw policy errors and unsupported metadata', () => {
    const store = new MemoryEventStore();
    const runtime = runtimeFor(store);
    const resource = {};
    bindResourceObservabilityOwner(resource, runtime);

    const event = warnResourcePolicy(
      resource,
      OBS_CODES.RESOURCE_POLICY_EVALUATION_FAILED,
      {
        metadata: {
          kind: 'custom',
          table: 'notes',
          action: 'list',
          tenantId: PRIVATE_VALUE,
          sql: `SELECT * FROM ${PRIVATE_VALUE}`,
        },
        error: new Error(PRIVATE_VALUE),
        userId: PRIVATE_VALUE,
      } as never,
    );

    expect(event.error).toBeUndefined();
    expect(event.userId).toBeUndefined();
    expect(event.metadata).toEqual({
      kind: 'custom',
      table: 'notes',
      action: 'list',
    });
    expect(JSON.stringify(store.query().events)).not.toContain(PRIVATE_VALUE);
  });

  test('emits only the closed CRUD failure fields', () => {
    const store = new MemoryEventStore();
    const event = emitResourceCrudFailure(runtimeFor(store), {
      resource: 'notes',
      table: 'notes',
      action: 'update',
      failureKind: 'tenant-database',
      databasePlane: 'tenant',
      databaseCode: 'DATABASE_EXECUTOR_FAILED',
      databaseOutcome: 'unknown',
      databaseConflictType: 'none',
      error: new DatabaseError('DATABASE_EXECUTOR_FAILED', PRIVATE_VALUE),
      tenantId: PRIVATE_VALUE,
    } as never);

    expect(event.error).toBeUndefined();
    expect(event.metadata).toEqual({
      resource: 'notes',
      table: 'notes',
      action: 'update',
      failureKind: 'tenant-database',
      databasePlane: 'tenant',
      databaseCode: 'DATABASE_EXECUTOR_FAILED',
      databaseOutcome: 'unknown',
      databaseConflictType: 'none',
    });
    expect(JSON.stringify(store.query().events)).not.toContain(PRIVATE_VALUE);
  });

  test('bounds declarative labels and receipt compaction counters', () => {
    const store = new MemoryEventStore();
    const runtime = runtimeFor(store);
    const context = {
      resource: PRIVATE_VALUE,
      table: 'notes',
      action: 'create' as const,
      databasePlane: 'default' as const,
      tenantId: PRIVATE_VALUE,
    };

    const expired = emitResourceReceiptExpired(runtime, context);
    const compacted = emitResourceReceiptCompacted(runtime, context, {
      totalKeys: Number.POSITIVE_INFINITY,
      retainedResults: 10_000,
      retainedResultBytes: Number.POSITIVE_INFINITY,
      expiredTombstones: 1,
      keyLimit: 1_000_000,
      prunedCount: 1,
      prunedResultBytes: Number.POSITIVE_INFINITY,
      retainedLimit: 10_000,
      retainedByteLimit: Number.POSITIVE_INFINITY,
      resultByteLimit: 4_194_304,
    });
    const capacity = emitResourceReceiptCapacityExhausted(runtime, context);

    expect(expired.error).toBeUndefined();
    expect(expired.metadata).toEqual({
      resource: '[invalid]',
      table: 'notes',
      action: 'create',
      databasePlane: 'default',
    });
    expect(compacted.metadata).toEqual({
      resource: '[invalid]',
      table: 'notes',
      action: 'create',
      databasePlane: 'default',
      totalKeys: 0,
      retainedResults: 10_000,
      retainedResultBytes: 0,
      expiredTombstones: 1,
      keyLimit: 1_000_000,
      prunedCount: 1,
      prunedResultBytes: 0,
      retainedLimit: 10_000,
      retainedByteLimit: 0,
      resultByteLimit: 4_194_304,
    });
    expect(capacity.error).toBeUndefined();
    expect(capacity.metadata).toEqual({
      resource: '[invalid]',
      table: 'notes',
      action: 'create',
      databasePlane: 'default',
      permanentKeyLimit: 1_000_000,
    });
    expect(JSON.stringify(store.query().events)).not.toContain(PRIVATE_VALUE);
  });
});

function runtimeFor(store: MemoryEventStore): PlatformObservabilityRuntime {
  return {
    sink: store,
    store,
    config: { console: false, store },
  };
}
