import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

import { DatabaseError } from './database-error';
import { createDatabaseRef } from './database-file';
import {
  DATABASE_ACTOR_MAX_REPLAY_CHANGES,
  validateDatabaseActorBindPayload,
  validateDatabaseActorBindResult,
  validateDatabaseActorExecutePayload,
  validateDatabaseActorFindReceiptPayload,
  validateDatabaseActorReplayPayload,
  validateDatabaseActorUnbindPayload,
} from './database-actor-protocol';

const databaseRef = createDatabaseRef('tenant-a');
const realmFingerprint = `sha256:${'a'.repeat(64)}`;
const schemaChecksum = 'b'.repeat(64);
const fileIdentity = Object.freeze({ device: '12', inode: '34' });
const instanceId = '00000000-0000-4000-8000-000000000001';
const actorLiveness = Object.freeze({
  filePath: resolve('/tmp/zero-databases/.zero-internal/liveness.sqlite'),
  fileIdentity: Object.freeze({ device: '12', inode: '35' }),
  generation: '00000000-0000-4000-8000-000000000002',
});
const catalog = {
  tables: Object.freeze(['todos']),
  queries: Object.freeze(['todos.byOwner']),
  commands: Object.freeze(['todos.archive']),
  columns: Object.freeze({ todos: Object.freeze(['id', 'title']) }),
  primaryKeys: Object.freeze({ todos: 'id' }),
};

describe('database actor protocol', () => {
  test('validates and freezes one canonical writer binding', () => {
    const value = validateDatabaseActorBindPayload({
      databaseRef,
      filePath: resolve('/tmp/zero-databases/db.sqlite'),
      fileIdentity,
      instanceId,
      actorLiveness,
      placement: { mode: 'file' },
      realmFingerprint,
      sqlite: {
        cacheSize: -4096,
        mmapSize: 0,
        walAutocheckpoint: 1000,
        pageSize: 4096,
        synchronous: 'NORMAL',
        tempStore: 'MEMORY',
        busyTimeout: 5000,
        statementCacheSize: 100,
        ringBufferDepth: 1000,
        bufferPool: { maxPoolSize: 10, preallocate: false },
      },
    });

    expect(value.databaseRef).toBe(databaseRef);
    expect(value.realmFingerprint).toBe(realmFingerprint);
    expect(value.fileIdentity).toEqual(fileIdentity);
    expect(value.instanceId).toBe(instanceId);
    expect(value.actorLiveness).toEqual(actorLiveness);
    expect(value.placement).toEqual({ mode: 'file' });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.sqlite)).toBe(true);
    expect(Object.isFrozen(value.sqlite.bufferPool)).toBe(true);
  });

  test('validates role-specific binding results and durable sequence', () => {
    expect(validateDatabaseActorBindResult({
      databaseRef,
      role: 'writer',
      fileIdentity,
      instanceId,
      placement: { mode: 'hot', durability: 'on-write', maxBytes: 67_108_864 },
      realmFingerprint,
      schemaChecksum,
      sequence: { seq: 12 },
      syncEpoch: 'actor-epoch:1',
    })).toEqual({
      databaseRef,
      role: 'writer',
      fileIdentity,
      instanceId,
      placement: { mode: 'hot', durability: 'on-write', maxBytes: 67_108_864 },
      realmFingerprint,
      schemaChecksum,
      sequence: { seq: 12 },
      syncEpoch: 'actor-epoch:1',
    });

    expectCode(() => validateDatabaseActorBindResult({
      databaseRef,
      role: 'reader',
      fileIdentity,
      instanceId,
      placement: { mode: 'file' },
      realmFingerprint,
      schemaChecksum,
      sequence: { seq: 12 },
      syncEpoch: 'writer-only',
    }));
  });

  test('validates routed public operations without accepting routing overrides', () => {
    const value = validateDatabaseActorExecutePayload({
      databaseRef,
      operation: {
        type: 'list',
        table: 'todos',
        limit: 20,
        after: 'todo-10',
        consistency: { mode: 'snapshot' },
      },
    }, catalog);

    expect(value.operation).toEqual({
      type: 'list',
      table: 'todos',
      limit: 20,
      after: 'todo-10',
      consistency: { mode: 'snapshot' },
    });
    expect(validateDatabaseActorExecutePayload({
      databaseRef,
      operation: {
        type: 'find',
        table: 'todos',
        select: ['id'],
        filters: [{
          type: 'allOf',
          filters: [{
            type: 'field', field: 'title', operator: 'eq', value: 'Open',
            match: 'exact',
          }],
        }],
        order: [{ field: 'title', direction: 'asc' }],
        limit: 25,
        offset: 5,
      },
    }, catalog).operation).toMatchObject({
      type: 'find',
      select: ['id'],
      limit: 25,
      offset: 5,
    });
    expectCode(() => validateDatabaseActorExecutePayload({
      databaseRef,
      operation: {
        type: 'get',
        table: 'todos',
        id: 'todo-1',
        tenantId: 'caller-controlled',
      },
    }, catalog));
    expect(validateDatabaseActorExecutePayload({
      databaseRef,
      authorityRevision: 7,
      operation: {
        type: 'mutate',
        idempotencyKey: 'todo:update:authority-revision',
        mutation: {
          type: 'update',
          table: 'todos',
          id: 'todo-1',
          patch: { title: 'Current authority' },
        },
      },
    }, catalog).authorityRevision).toBe(7);
    expectCode(() => validateDatabaseActorExecutePayload({
      databaseRef,
      authorityRevision: 7,
      operation: { type: 'get', table: 'todos', id: 'todo-1' },
    }, catalog));
  });

  test('bounds replay and validates unbind references', () => {
    expect(validateDatabaseActorReplayPayload({
      databaseRef,
      afterSeq: 4,
      limit: DATABASE_ACTOR_MAX_REPLAY_CHANGES,
    })).toEqual({ databaseRef, afterSeq: 4, limit: 500 });
    expect(validateDatabaseActorUnbindPayload({ databaseRef })).toEqual({ databaseRef });
    expectCode(() => validateDatabaseActorReplayPayload({
      databaseRef,
      afterSeq: 0,
      limit: DATABASE_ACTOR_MAX_REPLAY_CHANGES + 1,
    }));
  });

  test('admits fixed logical receipt fingerprints only on trusted writes', () => {
    const logicalReceiptFingerprint = `sha256:${'c'.repeat(64)}` as const;
    expect(validateDatabaseActorExecutePayload({
      databaseRef,
      logicalReceiptFingerprint,
      operation: {
        type: 'mutate',
        idempotencyKey: 'resource:update:1',
        mutation: {
          type: 'update', table: 'todos', id: 'one', patch: { title: 'new' },
        },
      },
    }, catalog).logicalReceiptFingerprint).toBe(logicalReceiptFingerprint);
    expect(validateDatabaseActorFindReceiptPayload({
      databaseRef,
      idempotencyKey: 'resource:update:1',
      logicalReceiptFingerprint,
    })).toEqual({
      databaseRef,
      idempotencyKey: 'resource:update:1',
      logicalReceiptFingerprint,
    });
    expectCode(() => validateDatabaseActorExecutePayload({
      databaseRef,
      logicalReceiptFingerprint,
      operation: { type: 'get', table: 'todos', id: 'one' },
    }, catalog));
    expectCode(() => validateDatabaseActorFindReceiptPayload({
      databaseRef,
      idempotencyKey: 'resource:update:1',
      logicalReceiptFingerprint: 'arbitrary-request-data',
    }));
  });

  test('rejects paths, fingerprints, settings, extensions, and hostile data', () => {
    const valid = {
      databaseRef,
      filePath: resolve('/tmp/zero-databases/db.sqlite'),
      fileIdentity,
      instanceId,
      actorLiveness,
      placement: { mode: 'file' },
      realmFingerprint,
      sqlite: {},
    };
    const values: unknown[] = [
      { ...valid, filePath: '../db.sqlite' },
      { ...valid, realmFingerprint: 'a'.repeat(64) },
      { ...valid, databaseRef: 'tenant-a' },
      { ...valid, sqlite: { busyTimeout: 0 } },
      { ...valid, sqlite: { mode: 'hot' } },
      { ...valid, placement: { mode: 'file', maxBytes: 1 } },
      { ...valid, placement: { mode: 'hot', durability: 'periodic', maxBytes: 1 } },
      { ...valid, placement: { mode: 'hot', durability: 'periodic', maxBytes: 1, snapshotIntervalMs: 2_147_483_648 } },
      { ...valid, placement: { mode: 'hot', durability: 'periodic', maxBytes: 1, snapshotIntervalMs: 10, snapshotTimeoutMs: 9 } },
      { ...valid, placement: { mode: 'hot', durability: 'periodic', maxBytes: 1, snapshotIntervalMs: 10, snapshotTimeoutMs: 2_147_483_648 } },
      { ...valid, placement: { mode: 'hot', durability: 'final', maxBytes: 1, snapshotIntervalMs: 10 } },
      { ...valid, placement: { mode: 'hot', durability: 'final', maxBytes: 1, snapshotTimeoutMs: 10 } },
      { ...valid, placement: { mode: 'hot', durability: 'on-write', maxBytes: 0 } },
      { ...valid, actorLiveness: { ...actorLiveness, generation: 'stale' } },
      { ...valid, tenantId: 'must-not-cross' },
      { ...valid, sqlite: new Proxy({}, {}) },
    ];

    for (const value of values) expectCode(() => validateDatabaseActorBindPayload(value));
  });

  test('normalizes exact hot placement and rejects hot reader readiness', () => {
    expect(validateDatabaseActorBindPayload({
      databaseRef,
      filePath: resolve('/tmp/zero-databases/db.sqlite'),
      fileIdentity,
      instanceId,
      actorLiveness,
      placement: {
        mode: 'hot',
        durability: 'periodic',
        maxBytes: 8_388_608,
        snapshotIntervalMs: 5_000,
      },
      realmFingerprint,
      sqlite: {},
    }).placement).toEqual({
      mode: 'hot',
      durability: 'periodic',
      maxBytes: 8_388_608,
      snapshotIntervalMs: 5_000,
      snapshotTimeoutMs: 120_000,
    });

    expectCode(() => validateDatabaseActorBindResult({
      databaseRef,
      role: 'reader',
      fileIdentity,
      instanceId,
      placement: { mode: 'hot', durability: 'final', maxBytes: 8_388_608 },
      realmFingerprint,
      schemaChecksum,
      sequence: { seq: 0 },
      syncEpoch: null,
    }));
  });
});

function expectCode(operation: () => unknown): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe('DATABASE_PAYLOAD_INVALID');
    return;
  }
  throw new Error('Expected DATABASE_PAYLOAD_INVALID.');
}
