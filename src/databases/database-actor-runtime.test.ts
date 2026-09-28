import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DATABASE_ACTOR_OPERATIONS } from './database-actor-protocol';
import { DatabaseActorRuntime } from './database-actor-runtime';
import { DatabaseError, type DatabaseErrorCode } from './database-error';
import { createDatabaseRef, type DatabaseRef } from './database-file';
import type { DatabaseExecutorValue } from './database-executor';
import { SubprocessDatabaseExecutor } from './subprocess-database-executor';
import { databaseActorFixtureRealm as realm } from './test-fixtures/database-actor-realm';

const CHILD_PATH = fileURLToPath(new URL(
  './test-fixtures/database-actor-child.ts',
  import.meta.url,
));

describe('DatabaseActorRuntime', () => {
  test('binds, executes, replays, unbinds, and reuses one writer slot', () => {
    const directory = createDirectory();
    const firstPath = join(directory, 'first.sqlite');
    const secondPath = join(directory, 'second.sqlite');
    const firstRef = createDatabaseRef('actor-writer-first');
    const secondRef = createDatabaseRef('actor-writer-second');
    const actor = new DatabaseActorRuntime({ role: 'writer', realm });
    try {
      expect(call(actor, DATABASE_ACTOR_OPERATIONS.bindWriter, 'write', {
        databaseRef: firstRef,
        filePath: firstPath,
        realmFingerprint: realm.fingerprint,
        sqlite: { ringBufferDepth: 32 },
      })).toMatchObject({
        databaseRef: firstRef,
        role: 'writer',
        realmFingerprint: realm.fingerprint,
        schemaChecksum: realm.schemaChecksum,
        sequence: { seq: 0 },
        syncEpoch: expect.any(String),
      });

      expect(call(actor, DATABASE_ACTOR_OPERATIONS.execute, 'write', {
        databaseRef: firstRef,
        operation: {
          type: 'mutate',
          idempotencyKey: 'writer:first:1',
          mutation: {
            type: 'create',
            table: 'todos',
            row: { id: 'a', title: 'First' },
          },
        },
      })).toMatchObject({
        idempotencyKey: 'writer:first:1',
        replayed: false,
        sequence: { seq: 1 },
      });

      expect(call(actor, DATABASE_ACTOR_OPERATIONS.replay, 'read', {
        databaseRef: firstRef,
        afterSeq: 0,
        limit: 1,
      })).toMatchObject({
        sequence: { seq: 1 },
        value: {
          afterSeq: 0,
          throughSeq: 1,
          nextAfterSeq: null,
          changes: [{ seq: 1, table: 'todos', rowId: 'a' }],
        },
      });

      expectCode(() => call(actor, DATABASE_ACTOR_OPERATIONS.execute, 'read', {
        databaseRef: firstRef,
        operation: {
          type: 'mutate',
          idempotencyKey: 'wrong-kind',
          mutation: { type: 'delete', table: 'todos', id: 'a' },
        },
      }), 'DATABASE_PROTOCOL_ERROR');
      expectCode(() => call(actor, DATABASE_ACTOR_OPERATIONS.execute, 'read', {
        databaseRef: secondRef,
        operation: { type: 'get', table: 'todos', id: 'a' },
      }), 'DATABASE_AUTHORITY_CHANGED');
      expectCode(() => call(actor, DATABASE_ACTOR_OPERATIONS.bindWriter, 'write', {
        databaseRef: secondRef,
        filePath: secondPath,
        realmFingerprint: realm.fingerprint,
        sqlite: {},
      }), 'DATABASE_NOT_READY');

      expect(call(actor, DATABASE_ACTOR_OPERATIONS.unbind, 'read', {
        databaseRef: firstRef,
      })).toBeNull();
      expect(actor.diagnostics()).toMatchObject({
        state: 'unbound',
        role: 'writer',
        databaseRef: null,
      });
      expectCode(() => call(actor, DATABASE_ACTOR_OPERATIONS.execute, 'read', {
        databaseRef: firstRef,
        operation: { type: 'get', table: 'todos', id: 'a' },
      }), 'DATABASE_NOT_READY');

      expect(call(actor, DATABASE_ACTOR_OPERATIONS.bindWriter, 'write', {
        databaseRef: secondRef,
        filePath: secondPath,
        realmFingerprint: realm.fingerprint,
        sqlite: {},
      })).toMatchObject({
        databaseRef: secondRef,
        sequence: { seq: 0 },
      });
      expect(call(actor, DATABASE_ACTOR_OPERATIONS.execute, 'read', {
        databaseRef: secondRef,
        operation: { type: 'get', table: 'todos', id: 'a' },
      })).toEqual({ value: null, sequence: { seq: 0 } });
      expect(call(actor, DATABASE_ACTOR_OPERATIONS.unbind, 'read', {
        databaseRef: secondRef,
      })).toBeNull();

      expectCode(() => call(actor, DATABASE_ACTOR_OPERATIONS.bindReader, 'read', {
        databaseRef: secondRef,
        filePath: secondPath,
        realmFingerprint: realm.fingerprint,
        sqlite: {},
      }), 'DATABASE_OPERATION_UNSUPPORTED');
    } finally {
      actor.close();
      actor.close();
      rmSync(directory, { recursive: true, force: true });
    }
    expect(actor.diagnostics().state).toBe('closed');
  });

  test('uses a readonly reader capability and safely rebinds it', () => {
    const directory = createDirectory();
    const firstPath = join(directory, 'reader-first.sqlite');
    const secondPath = join(directory, 'reader-second.sqlite');
    const firstRef = createDatabaseRef('actor-reader-first');
    const secondRef = createDatabaseRef('actor-reader-second');
    const firstWriter = seedFile(firstPath, firstRef, 'a', 'First');
    const secondWriter = seedFile(secondPath, secondRef, 'b', 'Second');

    const actor = new DatabaseActorRuntime({ role: 'reader', realm });
    try {
      expect(call(actor, DATABASE_ACTOR_OPERATIONS.bindReader, 'read', {
        databaseRef: firstRef,
        filePath: firstPath,
        realmFingerprint: realm.fingerprint,
        sqlite: { busyTimeout: 1_000 },
      })).toMatchObject({
        databaseRef: firstRef,
        role: 'reader',
        sequence: { seq: 1 },
        syncEpoch: null,
      });
      expect(call(actor, DATABASE_ACTOR_OPERATIONS.execute, 'read', {
        databaseRef: firstRef,
        operation: { type: 'get', table: 'todos', id: 'a' },
      })).toEqual({
        value: { id: 'a', title: 'First' },
        sequence: { seq: 1 },
      });
      expect(call(actor, DATABASE_ACTOR_OPERATIONS.execute, 'read', {
        databaseRef: firstRef,
        operation: { type: 'query', name: 'todos.count', input: null },
      })).toEqual({ value: { count: 1 }, sequence: { seq: 1 } });

      expectCode(() => call(actor, DATABASE_ACTOR_OPERATIONS.execute, 'write', {
        databaseRef: firstRef,
        operation: {
          type: 'mutate',
          idempotencyKey: 'reader:forbidden',
          mutation: { type: 'delete', table: 'todos', id: 'a' },
        },
      }), 'DATABASE_OPERATION_UNSUPPORTED');
      expectCode(() => call(actor, DATABASE_ACTOR_OPERATIONS.execute, 'read', {
        databaseRef: firstRef,
        operation: {
          type: 'get',
          table: 'todos',
          id: 'a',
          consistency: { mode: 'strong' },
        },
      }), 'DATABASE_OPERATION_UNSUPPORTED');
      expectCode(() => call(actor, DATABASE_ACTOR_OPERATIONS.replay, 'read', {
        databaseRef: firstRef,
        afterSeq: 0,
        limit: 10,
      }), 'DATABASE_OPERATION_UNSUPPORTED');

      expect(call(actor, DATABASE_ACTOR_OPERATIONS.unbind, 'read', {
        databaseRef: firstRef,
      })).toBeNull();
      expect(call(actor, DATABASE_ACTOR_OPERATIONS.bindReader, 'read', {
        databaseRef: secondRef,
        filePath: secondPath,
        realmFingerprint: realm.fingerprint,
        sqlite: {},
      })).toMatchObject({ databaseRef: secondRef, sequence: { seq: 1 } });
      expect(call(actor, DATABASE_ACTOR_OPERATIONS.execute, 'read', {
        databaseRef: secondRef,
        operation: { type: 'get', table: 'todos', id: 'b' },
      })).toEqual({
        value: { id: 'b', title: 'Second' },
        sequence: { seq: 1 },
      });
    } finally {
      actor.close();
      firstWriter.close();
      secondWriter.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects realm mismatch and keeps open failures privacy safe', () => {
    const directory = createDirectory();
    const filePath = join(directory, 'private-actor-path.sqlite');
    const databaseRef = createDatabaseRef('actor-private-errors');
    const actor = new DatabaseActorRuntime({ role: 'writer', realm });
    try {
      expectCode(() => call(actor, DATABASE_ACTOR_OPERATIONS.bindWriter, 'write', {
        databaseRef,
        filePath,
        realmFingerprint: `sha256:${'0'.repeat(64)}`,
        sqlite: {},
      }), 'DATABASE_SCHEMA_MISMATCH');

      const unusablePath = join(directory, 'not-a-database');
      mkdirSync(unusablePath);
      const error = captureError(() => call(
        actor,
        DATABASE_ACTOR_OPERATIONS.bindWriter,
        'write',
        {
          databaseRef,
          filePath: unusablePath,
          realmFingerprint: realm.fingerprint,
          sqlite: {},
        },
      ));
      expect(['DATABASE_EXECUTOR_FAILED', 'DATABASE_OPEN_FAILED']).toContain(error.code);
      expect(`${error.message}\n${JSON.stringify(error)}`).not.toContain(unusablePath);
      expect(actor.diagnostics()).toMatchObject({ state: 'unbound', databaseRef: null });
      expect(JSON.stringify(actor.diagnostics())).not.toContain(directory);
    } finally {
      actor.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('database actor subprocess integration', () => {
  test('binds, executes, unbinds, and rebinds real writer and reader children', async () => {
    const directory = createDirectory();
    const firstPath = join(directory, 'ipc-first.sqlite');
    const secondPath = join(directory, 'ipc-second.sqlite');
    const firstRef = createDatabaseRef('actor-ipc-first');
    const secondRef = createDatabaseRef('actor-ipc-second');
    const writer = createExecutor('writer', 31);
    const firstWriter = createExecutor('writer', 33);
    const reader = createExecutor('reader', 32);
    try {
      await writer.start();
      await bindExecutor(writer, 'writer', firstRef, firstPath);
      await writer.execute({
        operation: DATABASE_ACTOR_OPERATIONS.execute,
        kind: 'write',
        payload: {
          databaseRef: firstRef,
          operation: {
            type: 'mutate',
            idempotencyKey: 'ipc:first:1',
            mutation: {
              type: 'create',
              table: 'todos',
              row: { id: 'a', title: 'IPC First' },
            },
          },
        },
      });
      await unbindExecutor(writer, firstRef);
      await bindExecutor(writer, 'writer', secondRef, secondPath);
      await writer.execute({
        operation: DATABASE_ACTOR_OPERATIONS.execute,
        kind: 'write',
        payload: {
          databaseRef: secondRef,
          operation: {
            type: 'mutate',
            idempotencyKey: 'ipc:second:1',
            mutation: {
              type: 'create',
              table: 'todos',
              row: { id: 'b', title: 'IPC Second' },
            },
          },
        },
      });
      // A reader actor is only useful while the coordinator retains the
      // corresponding writer authority. Keep one writer bound to each WAL
      // file while the reader slot moves between them.
      await firstWriter.start();
      await bindExecutor(firstWriter, 'writer', firstRef, firstPath);

      await reader.start();
      await withStage(
        'reader first bind',
        bindExecutor(reader, 'reader', firstRef, firstPath),
      );
      const firstRead: unknown = await reader.execute({
        operation: DATABASE_ACTOR_OPERATIONS.execute,
        kind: 'read',
        payload: {
          databaseRef: firstRef,
          operation: { type: 'get', table: 'todos', id: 'a' },
        },
      });
      expect(firstRead).toEqual({
        value: { id: 'a', title: 'IPC First' },
        sequence: { seq: 1 },
      });
      const firstFind: unknown = await reader.execute({
        operation: DATABASE_ACTOR_OPERATIONS.execute,
        kind: 'read',
        payload: {
          databaseRef: firstRef,
          operation: {
            type: 'find',
            table: 'todos',
            select: ['id'],
            filters: [{
              type: 'field', field: 'title', operator: 'contains', value: 'First',
            }],
            limit: 1,
          },
        },
      });
      expect(firstFind).toEqual({
        value: [{ id: 'a' }],
        sequence: { seq: 1 },
      });
      await unbindExecutor(reader, firstRef);
      await withStage(
        'reader second bind',
        bindExecutor(reader, 'reader', secondRef, secondPath),
      );
      const secondRead: unknown = await reader.execute({
        operation: DATABASE_ACTOR_OPERATIONS.execute,
        kind: 'read',
        payload: {
          databaseRef: secondRef,
          operation: { type: 'query', name: 'todos.count', input: null },
        },
      });
      expect(secondRead).toEqual({ value: { count: 1 }, sequence: { seq: 1 } });
      await unbindExecutor(reader, secondRef);
      await unbindExecutor(firstWriter, firstRef);
      await unbindExecutor(writer, secondRef);
    } finally {
      await Promise.allSettled([
        writer.close(),
        firstWriter.close(),
        reader.close(),
      ]);
      rmSync(directory, { recursive: true, force: true });
    }
  }, 15_000);
});

function createDirectory(): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), 'zero-database-actor-')));
}

function call(
  actor: DatabaseActorRuntime,
  operation: string,
  kind: 'read' | 'write',
  payload: DatabaseExecutorValue,
): DatabaseExecutorValue {
  return actor.handle({ operation, kind, payload });
}

function seedFile(
  filePath: string,
  databaseRef: DatabaseRef,
  id: string,
  title: string,
): DatabaseActorRuntime {
  const writer = new DatabaseActorRuntime({ role: 'writer', realm });
  try {
    call(writer, DATABASE_ACTOR_OPERATIONS.bindWriter, 'write', {
      databaseRef,
      filePath,
      realmFingerprint: realm.fingerprint,
      sqlite: {},
    });
    call(writer, DATABASE_ACTOR_OPERATIONS.execute, 'write', {
      databaseRef,
      operation: {
        type: 'mutate',
        idempotencyKey: `seed:${id}`,
        mutation: { type: 'create', table: 'todos', row: { id, title } },
      },
    });
    return writer;
  } catch (error) {
    writer.close();
    throw error;
  }
}

function expectCode(operation: () => unknown, code: DatabaseErrorCode): void {
  expect(captureError(operation).code).toBe(code);
}

function captureError(operation: () => unknown): DatabaseError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
  throw new Error('Expected a DatabaseError.');
}

function createExecutor(
  role: 'writer' | 'reader',
  slot: number,
): SubprocessDatabaseExecutor {
  return new SubprocessDatabaseExecutor({
    command: [process.execPath, CHILD_PATH, role, String(slot)],
    env: {},
    role,
    slot,
    maxInFlight: 1,
    startupTimeoutMs: 2_000,
    operationTimeoutMs: 3_000,
    shutdownAckTimeoutMs: 1_000,
    shutdownExitTimeoutMs: 1_000,
    sigtermTimeoutMs: 500,
    sigkillTimeoutMs: 500,
  });
}

async function bindExecutor(
  executor: SubprocessDatabaseExecutor,
  role: 'writer' | 'reader',
  databaseRef: DatabaseRef,
  filePath: string,
): Promise<void> {
  const value = await executor.execute({
    operation: role === 'writer'
      ? DATABASE_ACTOR_OPERATIONS.bindWriter
      : DATABASE_ACTOR_OPERATIONS.bindReader,
    kind: role === 'writer' ? 'write' : 'read',
    payload: {
      databaseRef,
      filePath,
      realmFingerprint: realm.fingerprint,
      sqlite: {},
    },
  });
  expect(value).toMatchObject({ databaseRef, role });
}

async function unbindExecutor(
  executor: SubprocessDatabaseExecutor,
  databaseRef: DatabaseRef,
): Promise<void> {
  expect(await executor.execute({
    operation: DATABASE_ACTOR_OPERATIONS.unbind,
    kind: 'read',
    payload: { databaseRef },
  })).toBeNull();
}

async function withStage<T>(stage: string, promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    throw new Error(`Database actor integration failed at ${stage}.`, { cause: error });
  }
}
