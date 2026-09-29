import { fileURLToPath } from 'node:url';
import type { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import {
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  DATABASE_ACTOR_OPERATIONS,
  type DatabaseActorBindPayload,
} from './database-actor-protocol';
import {
  probeDatabaseActorLiveness,
  type DatabaseActorLivenessBinding,
} from './database-actor-liveness';
import {
  createDatabaseActorServer,
  DatabaseActorRuntime,
} from './database-actor-runtime';
import {
  closeActorBinding,
  establishInitialHotDurability,
  openWriterBinding,
  releaseHotOpenedFileGuard,
} from './database-actor-binding';
import { prepareDatabaseBindingIdentity } from './database-binding-identity';
import { DatabaseError, type DatabaseErrorCode } from './database-error';
import { createDatabaseRef, type DatabaseRef } from './database-file';
import {
  openDatabaseFileIdentityGuard,
  type DatabaseFileIdentityProof,
} from './database-file-identity';
import type { DatabaseExecutorEvent, DatabaseExecutorValue } from './database-executor';
import type { SnapshotManager } from '../persistence';
import {
  DATABASE_EXECUTOR_PROTOCOL_KIND,
  DATABASE_EXECUTOR_PROTOCOL_VERSION,
  SubprocessDatabaseExecutor,
  type SubprocessDatabaseExecutorEvent,
} from './subprocess-database-executor';
import type { SubprocessDatabaseServerTransport } from './subprocess-database-server';
import { databaseActorFixtureRealm as realm } from './test-fixtures/database-actor-realm';

const CHILD_PATH = fileURLToPath(new URL(
  './test-fixtures/database-actor-child.ts',
  import.meta.url,
));
const FILE_PLACEMENT = Object.freeze({ mode: 'file' as const });
const HOT_MAX_BYTES = 16 * 1024 * 1024;
const actorLivenessByRoot = new Map<string, DatabaseActorLivenessBinding>();
const actorBindingByPath = new Map<string, Readonly<{
  databaseRef: DatabaseRef;
  instanceId: string;
  fileIdentity: DatabaseFileIdentityProof;
}>>();

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
        placement: FILE_PLACEMENT,
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

      const logicalReceiptFingerprint = `sha256:${'d'.repeat(64)}`;
      expect(call(actor, DATABASE_ACTOR_OPERATIONS.execute, 'write', {
        databaseRef: firstRef,
        logicalReceiptFingerprint,
        operation: {
          type: 'mutate',
          idempotencyKey: 'writer:logical:1',
          mutation: {
            type: 'update', table: 'todos', id: 'a', patch: { title: 'Updated' },
          },
        },
      })).toMatchObject({ replayed: false, sequence: { seq: 2 } });
      expect(call(actor, DATABASE_ACTOR_OPERATIONS.findReceipt, 'read', {
        databaseRef: firstRef,
        idempotencyKey: 'writer:logical:1',
        logicalReceiptFingerprint,
      })).toMatchObject({
        status: 'hit',
        result: { replayed: true, sequence: { seq: 2 } },
      });
      expect(call(actor, DATABASE_ACTOR_OPERATIONS.replay, 'read', {
        databaseRef: firstRef,
        afterSeq: 0,
        limit: 2,
      })).toMatchObject({
        sequence: { seq: 2 },
        value: {
          afterSeq: 0,
          throughSeq: 2,
          nextAfterSeq: null,
          changes: [
            { seq: 1, table: 'todos', rowId: 'a' },
            { seq: 2, table: 'todos', rowId: 'a' },
          ],
        },
      });
      expect(call(actor, DATABASE_ACTOR_OPERATIONS.execute, 'read', {
        databaseRef: firstRef,
        operation: {
          type: 'query', name: 'todos.capabilityProbe', input: null,
        },
      })).toEqual({
        value: {
          pragma: 'DATABASE_OPERATION_UNSUPPORTED',
          pathQuery: 'DATABASE_OPERATION_UNSUPPORTED',
          insert: 'DATABASE_OPERATION_UNSUPPORTED',
          connectionKeys: ['prepare', 'query'],
          statementKeys: ['all', 'get', 'iterate', 'raw', 'values'],
          mutableSurfaces: [],
          nativeStatement: false,
        },
        sequence: { seq: 2 },
      });
      expect(call(actor, DATABASE_ACTOR_OPERATIONS.execute, 'read', {
        databaseRef: firstRef,
        operation: { type: 'get', table: 'todos', id: 'hostile' },
      })).toEqual({ value: null, sequence: { seq: 2 } });

      const ownerToken = '11111111-1111-4111-8111-111111111111';
      const begun = call(
        actor,
        DATABASE_ACTOR_OPERATIONS.tenantSyncSnapshotBegin,
        'read',
        {
          databaseRef: firstRef,
          generation: 1,
          ownerToken,
          tables: ['todos'],
        },
      ) as Record<string, any>;
      expect(begun).toMatchObject({
        sequence: { seq: 2 },
        tables: ['todos'],
        totalRows: 1,
      });
      expect(call(actor, DATABASE_ACTOR_OPERATIONS.execute, 'write', {
        databaseRef: firstRef,
        operation: {
          type: 'mutate',
          idempotencyKey: 'writer:after-snapshot',
          mutation: {
            type: 'create',
            table: 'todos',
            row: { id: 'b', title: 'After snapshot' },
          },
        },
      })).toMatchObject({ sequence: { seq: 3 } });
      const pagePayload = {
        databaseRef: firstRef,
        generation: 1,
        ownerToken,
        sessionId: begun.sessionId,
        tables: ['todos'],
        cursor: 0,
      };
      const firstPage = call(
        actor,
        DATABASE_ACTOR_OPERATIONS.tenantSyncSnapshotPage,
        'read',
        pagePayload,
      );
      expect(firstPage).toMatchObject({
        cursor: 0,
        nextCursor: null,
        rows: [{ ordinal: 0, tableIndex: 0, rowId: 'a', row: {
          id: 'a', title: 'Updated',
        } }],
      });
      expect(call(
        actor,
        DATABASE_ACTOR_OPERATIONS.tenantSyncSnapshotPage,
        'read',
        pagePayload,
      )).toEqual(firstPage);
      const abortPayload = {
        databaseRef: firstRef,
        generation: 1,
        ownerToken,
        sessionId: begun.sessionId,
        tables: ['todos'],
      };
      expect(call(
        actor,
        DATABASE_ACTOR_OPERATIONS.tenantSyncSnapshotAbort,
        'read',
        abortPayload,
      )).toEqual({ aborted: true });
      expect(call(
        actor,
        DATABASE_ACTOR_OPERATIONS.tenantSyncSnapshotAbort,
        'read',
        abortPayload,
      )).toEqual({ aborted: false });
      for (let index = 0; index < 8; index += 1) {
        expect(call(
          actor,
          DATABASE_ACTOR_OPERATIONS.tenantSyncSnapshotBegin,
          'read',
          {
            databaseRef: firstRef,
            generation: 1,
            ownerToken: `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`,
            tables: [],
          },
        )).toMatchObject({ totalRows: 0 });
      }
      const snapshotCapacity = captureError(() => call(
        actor,
        DATABASE_ACTOR_OPERATIONS.tenantSyncSnapshotBegin,
        'read',
        {
          databaseRef: firstRef,
          generation: 1,
          ownerToken: '55555555-5555-4555-8555-555555555555',
          tables: [],
        },
      ));
      expect(snapshotCapacity).toMatchObject({
        code: 'DATABASE_BACKPRESSURE',
        retryable: true,
        outcome: 'not-started',
        details: { snapshotReason: 'sessions' },
      });
      expect(JSON.stringify(snapshotCapacity)).not.toContain('44444444');

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
        placement: FILE_PLACEMENT,
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
        placement: FILE_PLACEMENT,
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
        placement: FILE_PLACEMENT,
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
        placement: FILE_PLACEMENT,
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
        placement: FILE_PLACEMENT,
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

  test('rejects hot placement on a readonly actor before opening a binding', () => {
    const directory = createDirectory();
    const actor = new DatabaseActorRuntime({ role: 'reader', realm });
    try {
      expectCode(() => call(actor, DATABASE_ACTOR_OPERATIONS.bindReader, 'read', {
        databaseRef: createDatabaseRef('actor-hot-reader-rejected'),
        filePath: join(directory, 'reader-hot.sqlite'),
        placement: hotPlacement('on-write'),
        realmFingerprint: realm.fingerprint,
        sqlite: {},
      }), 'DATABASE_OPERATION_UNSUPPORTED');
      expect(actor.diagnostics()).toMatchObject({
        state: 'unbound',
        databaseRef: null,
        placement: null,
      });
    } finally {
      actor.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('restores hot state and replays a durable receipt without another snapshot', () => {
    const directory = createDirectory();
    const filePath = join(directory, 'hot-on-write.sqlite');
    const databaseRef = createDatabaseRef('actor-hot-on-write');
    const operation = {
      type: 'mutate',
      idempotencyKey: 'hot:on-write:1',
      mutation: {
        type: 'create',
        table: 'todos',
        row: { id: 'hot-a', title: 'Durable' },
      },
    } as const;

    const first = new DatabaseActorRuntime({ role: 'writer', realm });
    try {
      expect(call(first, DATABASE_ACTOR_OPERATIONS.bindWriter, 'write', {
        databaseRef,
        filePath,
        placement: hotPlacement('on-write'),
        realmFingerprint: realm.fingerprint,
        sqlite: {},
      })).toMatchObject({
        databaseRef,
        role: 'writer',
        placement: hotPlacement('on-write'),
      });
      expect(call(first, DATABASE_ACTOR_OPERATIONS.execute, 'write', {
        databaseRef,
        operation,
      })).toMatchObject({ replayed: false, sequence: { seq: 1 } });
    } finally {
      first.close();
    }

    const restored = new DatabaseActorRuntime({ role: 'writer', realm });
    try {
      expect(call(restored, DATABASE_ACTOR_OPERATIONS.bindWriter, 'write', {
        databaseRef,
        filePath,
        placement: hotPlacement('on-write'),
        realmFingerprint: realm.fingerprint,
        sqlite: {},
      })).toMatchObject({ sequence: { seq: 1 } });
      expect(call(restored, DATABASE_ACTOR_OPERATIONS.execute, 'read', {
        databaseRef,
        operation: { type: 'get', table: 'todos', id: 'hot-a' },
      })).toMatchObject({ value: { id: 'hot-a', title: 'Durable' } });

      const hotOwner = '33333333-3333-4333-8333-333333333333';
      const hotSession = call(
        restored,
        DATABASE_ACTOR_OPERATIONS.tenantSyncSnapshotBegin,
        'read',
        {
          databaseRef,
          generation: 2,
          ownerToken: hotOwner,
          tables: ['todos'],
        },
      ) as Record<string, any>;
      expect(call(
        restored,
        DATABASE_ACTOR_OPERATIONS.tenantSyncSnapshotPage,
        'read',
        {
          databaseRef,
          generation: 2,
          ownerToken: hotOwner,
          sessionId: hotSession.sessionId,
          tables: ['todos'],
          cursor: 0,
        },
      )).toMatchObject({ rows: [{ rowId: 'hot-a' }] });
      expect(call(
        restored,
        DATABASE_ACTOR_OPERATIONS.tenantSyncSnapshotAbort,
        'read',
        {
          databaseRef,
          generation: 2,
          ownerToken: hotOwner,
          sessionId: hotSession.sessionId,
          tables: ['todos'],
        },
      )).toEqual({ aborted: true });

      const snapshot = hotSnapshot(restored);
      const originalSnapshotSync = snapshot.snapshotSyncDetailed.bind(snapshot);
      snapshot.snapshotSyncDetailed = () => {
        throw new Error('a replay must not request another snapshot');
      };
      try {
        expect(call(restored, DATABASE_ACTOR_OPERATIONS.execute, 'write', {
          databaseRef,
          operation,
        })).toMatchObject({ replayed: true, sequence: { seq: 1 } });
      } finally {
        snapshot.snapshotSyncDetailed = originalSnapshotSync;
      }
    } finally {
      restored.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('retains a verified physical proof across each hot startup publication', () => {
    const directory = createDirectory();
    const filePath = join(directory, 'hot-readiness-proof.sqlite');
    const databaseRef = createDatabaseRef('actor-hot-readiness-proof');
    const payload = prepareBindPayload({
      databaseRef,
      filePath,
      placement: hotPlacement('on-write'),
      realmFingerprint: realm.fingerprint,
      sqlite: {},
    }) as unknown as DatabaseActorBindPayload;
    const binding = openWriterBinding(payload, realm, {
      onStart() {},
      onFinish() {},
      onDirty() {},
      onClean() {},
      onFailure() {},
    });
    try {
      expect(binding.fileGuard).not.toBeNull();
      binding.fileGuard!.assertCurrent();
      const migratedProof = binding.fileGuard!.proof;
      expect(migratedProof).not.toEqual(payload.fileIdentity);

      establishInitialHotDurability(binding, payload, realm);
      expect(binding.fileGuard).not.toBeNull();
      binding.fileGuard!.assertCurrent();
      expect(binding.fileGuard!.proof).not.toEqual(migratedProof);

      releaseHotOpenedFileGuard(binding);
      expect(binding.fileGuard).toBeNull();
    } finally {
      closeActorBinding(binding);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('returns an unknown outcome on on-write snapshot failure and recovers by key', () => {
    const directory = createDirectory();
    const filePath = join(directory, 'hot-snapshot-failure.sqlite');
    const databaseRef = createDatabaseRef('actor-hot-snapshot-failure');
    const operation = {
      type: 'mutate',
      idempotencyKey: 'hot:snapshot-failure:1',
      mutation: {
        type: 'create',
        table: 'todos',
        row: { id: 'hot-failure', title: 'Committed in RAM' },
      },
    } as const;
    const actor = new DatabaseActorRuntime({ role: 'writer', realm });
    let restoredSnapshot: (() => unknown) | null = null;
    try {
      call(actor, DATABASE_ACTOR_OPERATIONS.bindWriter, 'write', {
        databaseRef,
        filePath,
        placement: hotPlacement('on-write'),
        realmFingerprint: realm.fingerprint,
        sqlite: {},
      });
      const snapshot = hotSnapshot(actor);
      const originalSnapshotSync = snapshot.snapshotSyncDetailed.bind(snapshot);
      restoredSnapshot = () => { snapshot.snapshotSyncDetailed = originalSnapshotSync; };
      snapshot.snapshotSyncDetailed = () => ({
        status: 'failed',
        durable: false,
        error: new Error(`injected private failure at ${filePath}`),
      });

      const error = captureError(() => call(
        actor,
        DATABASE_ACTOR_OPERATIONS.execute,
        'write',
        { databaseRef, operation },
      ));
      expect(error).toMatchObject({
        code: 'DATABASE_OUTCOME_UNKNOWN',
        retryable: false,
        outcome: 'unknown',
        details: {},
      });
      expect(`${error.message}\n${JSON.stringify(error)}`).not.toContain(filePath);
      expect(actor.diagnostics().state).toBe('failed');
    } finally {
      restoredSnapshot?.();
      actor.close();
    }

    const recovered = new DatabaseActorRuntime({ role: 'writer', realm });
    try {
      call(recovered, DATABASE_ACTOR_OPERATIONS.bindWriter, 'write', {
        databaseRef,
        filePath,
        placement: hotPlacement('on-write'),
        realmFingerprint: realm.fingerprint,
        sqlite: {},
      });
      expect(call(recovered, DATABASE_ACTOR_OPERATIONS.execute, 'write', {
        databaseRef,
        operation,
      })).toMatchObject({ replayed: true, sequence: { seq: 1 } });
    } finally {
      recovered.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('watchdogs stalled periodic hot work and emits one payload-free fatal signal', async () => {
    const directory = createDirectory();
    const filePath = join(directory, 'hot-periodic-failure.sqlite');
    const databaseRef = createDatabaseRef('actor-hot-periodic-failure');
    const events: unknown[] = [];
    const actor = new DatabaseActorRuntime({
      role: 'writer',
      realm,
      onEvent: (event) => events.push(event),
    });
    let restoreSnapshot: (() => void) | null = null;
    try {
      call(actor, DATABASE_ACTOR_OPERATIONS.bindWriter, 'write', {
        databaseRef,
        filePath,
        placement: {
          mode: 'hot',
          durability: 'periodic',
          maxBytes: HOT_MAX_BYTES,
          snapshotIntervalMs: 5,
          snapshotTimeoutMs: 10,
        },
        realmFingerprint: realm.fingerprint,
        sqlite: {},
      });
      const snapshot = hotSnapshot(actor);
      const originalSnapshot = snapshot.snapshotDetailed.bind(snapshot);
      restoreSnapshot = () => { snapshot.snapshotDetailed = originalSnapshot; };
      snapshot.snapshotDetailed = () => new Promise(() => undefined);

      await waitForActorState(actor, 'failed');
      await Bun.sleep(20);
      expect(events).toEqual([
        { type: 'hot-periodic-snapshot-started' },
        { type: 'hot-periodic-durability-failed' },
      ]);
      expect(JSON.stringify(events)).not.toContain(filePath);
      expectCode(() => call(actor, DATABASE_ACTOR_OPERATIONS.execute, 'read', {
        databaseRef,
        operation: { type: 'get', table: 'todos', id: 'one' },
      }), 'DATABASE_EXECUTOR_FAILED');
    } finally {
      restoreSnapshot?.();
      actor.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('opens the periodic dirty window before returning a mutation response', async () => {
    const directory = createDirectory();
    const filePath = join(directory, 'hot-periodic-dirty-order.sqlite');
    const databaseRef = createDatabaseRef('actor-hot-periodic-dirty-order');
    const events: DatabaseExecutorEvent[] = [];
    const actor = new DatabaseActorRuntime({
      role: 'writer',
      realm,
      onEvent: (event) => events.push(event),
    });
    try {
      call(actor, DATABASE_ACTOR_OPERATIONS.bindWriter, 'write', {
        databaseRef,
        filePath,
        placement: {
          mode: 'hot',
          durability: 'periodic',
          maxBytes: HOT_MAX_BYTES,
          snapshotIntervalMs: 60_000,
          snapshotTimeoutMs: 120_000,
        },
        realmFingerprint: realm.fingerprint,
        sqlite: {},
      });

      const result = call(actor, DATABASE_ACTOR_OPERATIONS.execute, 'write', {
        databaseRef,
        operation: {
          type: 'mutate',
          idempotencyKey: 'hot:periodic:dirty-order',
          mutation: {
            type: 'create', table: 'todos',
            row: { id: 'ordered', title: 'Dirty before response' },
          },
        },
      });

      expect(result).toMatchObject({ replayed: false, sequence: { seq: 1 } });
      expect(events.slice(0, 2)).toEqual([
        { type: 'hot-periodic-durability-dirty' },
        { type: 'hot-periodic-snapshot-started' },
      ]);
      await waitForActorEvent(events, 'hot-periodic-durability-clean');
      await waitForActorEvent(events, 'hot-periodic-snapshot-finished');
      expect(JSON.stringify(events)).not.toContain(filePath);
    } finally {
      actor.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('returns unknown and retires when a periodic post-commit fence fails', () => {
    const directory = createDirectory();
    const filePath = join(directory, 'hot-periodic-fence-failure.sqlite');
    const databaseRef = createDatabaseRef('actor-hot-periodic-fence-failure');
    const actor = new DatabaseActorRuntime({ role: 'writer', realm });
    try {
      call(actor, DATABASE_ACTOR_OPERATIONS.bindWriter, 'write', {
        databaseRef,
        filePath,
        placement: {
          mode: 'hot',
          durability: 'periodic',
          maxBytes: HOT_MAX_BYTES,
          snapshotIntervalMs: 60_000,
          snapshotTimeoutMs: 120_000,
        },
        realmFingerprint: realm.fingerprint,
        sqlite: {},
      });
      const snapshot = hotSnapshot(actor);
      const originalRequiresFence = snapshot.requiresPeriodicWriteFence.bind(snapshot);
      const originalSnapshotSync = snapshot.snapshotSyncDetailed.bind(snapshot);
      snapshot.requiresPeriodicWriteFence = () => true;
      snapshot.snapshotSyncDetailed = () => ({
        status: 'failed',
        durable: false,
        error: new Error(`private fence failure ${filePath}`),
      });
      const error = captureError(() => call(
        actor,
        DATABASE_ACTOR_OPERATIONS.execute,
        'write',
        {
          databaseRef,
          operation: {
            type: 'mutate',
            idempotencyKey: 'hot:periodic:fence',
            mutation: {
              type: 'create', table: 'todos',
              row: { id: 'fenced', title: 'Committed before failed fence' },
            },
          },
        },
      ));
      expect(error).toMatchObject({
        code: 'DATABASE_OUTCOME_UNKNOWN',
        retryable: false,
        outcome: 'unknown',
      });
      expect(JSON.stringify(error)).not.toContain(filePath);
      expect(actor.diagnostics().state).toBe('failed');
      snapshot.requiresPeriodicWriteFence = originalRequiresFence;
      snapshot.snapshotSyncDetailed = originalSnapshotSync;
    } finally {
      actor.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('does not apply periodic acknowledgement fences to final durability', () => {
    const directory = createDirectory();
    const filePath = join(directory, 'hot-final-no-write-fence.sqlite');
    const databaseRef = createDatabaseRef('actor-hot-final-no-write-fence');
    const actor = new DatabaseActorRuntime({ role: 'writer', realm });
    try {
      call(actor, DATABASE_ACTOR_OPERATIONS.bindWriter, 'write', {
        databaseRef,
        filePath,
        placement: hotPlacement('final'),
        realmFingerprint: realm.fingerprint,
        sqlite: {},
      });
      const snapshot = hotSnapshot(actor);
      const originalRequiresFence = snapshot.requiresPeriodicWriteFence.bind(snapshot);
      snapshot.requiresPeriodicWriteFence = () => {
        throw new Error('final durability must not ask for a periodic fence');
      };
      try {
        expect(call(actor, DATABASE_ACTOR_OPERATIONS.execute, 'write', {
          databaseRef,
          operation: {
            type: 'mutate',
            idempotencyKey: 'hot:final:no-fence',
            mutation: {
              type: 'create', table: 'todos',
              row: { id: 'final', title: 'Snapshot only at close' },
            },
          },
        })).toMatchObject({ replayed: false, sequence: { seq: 1 } });
      } finally {
        snapshot.requiresPeriodicWriteFence = originalRequiresFence;
      }
    } finally {
      actor.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('does not snapshot a replayed periodic receipt again', () => {
    const directory = createDirectory();
    const filePath = join(directory, 'hot-periodic-replay.sqlite');
    const databaseRef = createDatabaseRef('actor-hot-periodic-replay');
    const actor = new DatabaseActorRuntime({ role: 'writer', realm });
    const operation = {
      type: 'mutate',
      idempotencyKey: 'hot:periodic:replay',
      mutation: {
        type: 'create' as const,
        table: 'todos',
        row: { id: 'periodic-replay', title: 'Exactly once' },
      },
    } as const;
    try {
      call(actor, DATABASE_ACTOR_OPERATIONS.bindWriter, 'write', {
        databaseRef,
        filePath,
        placement: {
          mode: 'hot',
          durability: 'periodic',
          maxBytes: HOT_MAX_BYTES,
          snapshotIntervalMs: 60_000,
          snapshotTimeoutMs: 120_000,
        },
        realmFingerprint: realm.fingerprint,
        sqlite: {},
      });
      expect(call(actor, DATABASE_ACTOR_OPERATIONS.execute, 'write', {
        databaseRef, operation,
      })).toMatchObject({ replayed: false, sequence: { seq: 1 } });

      const snapshot = hotSnapshot(actor);
      const originalRequiresFence = snapshot.requiresPeriodicWriteFence.bind(snapshot);
      let fenceChecks = 0;
      snapshot.requiresPeriodicWriteFence = () => {
        fenceChecks += 1;
        return true;
      };
      try {
        expect(call(actor, DATABASE_ACTOR_OPERATIONS.execute, 'write', {
          databaseRef, operation,
        })).toMatchObject({ replayed: true, sequence: { seq: 1 } });
        expect(fenceChecks).toBe(0);
      } finally {
        snapshot.requiresPeriodicWriteFence = originalRequiresFence;
      }
    } finally {
      actor.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('retries a transient final snapshot failure before acknowledging child shutdown', async () => {
    const directory = createDirectory();
    const filePath = join(directory, 'hot-final-retry.sqlite');
    const databaseRef = createDatabaseRef('actor-hot-final-retry');
    const transport = new ActorServerTransport();
    const created = createDatabaseActorServer({
      role: 'writer',
      slot: 7,
      realm,
      transport,
    });
    const session = {
      protocol: DATABASE_EXECUTOR_PROTOCOL_KIND,
      version: DATABASE_EXECUTOR_PROTOCOL_VERSION,
      nonce: 'c7416b73-4585-4b9c-b06b-86d4c6a9eff3',
      role: 'writer',
      slot: 7,
      generation: 41,
    } as const;
    try {
      const starting = created.server.start();
      transport.emit({ ...session, type: 'handshake' });
      await starting;
      transport.emit({
        ...session,
        type: 'request',
        requestId: 1,
        operation: DATABASE_ACTOR_OPERATIONS.bindWriter,
        operationKind: 'write',
        payload: prepareBindPayload({
          databaseRef,
          filePath,
          placement: hotPlacement('final'),
          realmFingerprint: realm.fingerprint,
          sqlite: {},
        }),
      });
      await waitForActorServerMessages(transport, 2);
      expect(transport.sent[1]).toMatchObject({
        type: 'response', requestId: 1, ok: true,
      });

      const snapshot = hotSnapshot(created.actor);
      const originalSnapshotSync = snapshot.snapshotSyncDetailed.bind(snapshot);
      let attempts = 0;
      snapshot.snapshotSyncDetailed = () => {
        attempts += 1;
        return attempts === 1
          ? {
              status: 'failed',
              durable: false,
              error: new Error(`private transient close failure ${filePath}`),
            }
          : originalSnapshotSync();
      };

      transport.emit({ ...session, type: 'shutdown' });
      await created.server.finished();
      expect(attempts).toBe(2);
      expect(transport.sent.filter((message) => message.type === 'shutdown-ack'))
        .toHaveLength(1);
      expect(created.actor.diagnostics().state).toBe('closed');
      expect(JSON.stringify(transport.sent)).not.toContain(filePath);
    } finally {
      await Promise.resolve(created.server.close()).catch(() => undefined);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects a hot image over its page budget before commit', () => {
    const directory = createDirectory();
    const filePath = join(directory, 'hot-max-bytes.sqlite');
    const databaseRef = createDatabaseRef('actor-hot-max-bytes');
    const seed = new DatabaseActorRuntime({ role: 'writer', realm });
    let initialBytes = 0;
    try {
      call(seed, DATABASE_ACTOR_OPERATIONS.bindWriter, 'write', {
        databaseRef,
        filePath,
        placement: hotPlacement('on-write'),
        realmFingerprint: realm.fingerprint,
        sqlite: {},
      });
      initialBytes = hotRaw(seed).serialize().byteLength;
    } finally {
      seed.close();
    }

    const bounded = new DatabaseActorRuntime({ role: 'writer', realm });
    try {
      call(bounded, DATABASE_ACTOR_OPERATIONS.bindWriter, 'write', {
        databaseRef,
        filePath,
        placement: hotPlacement('on-write', initialBytes + 4_096),
        realmFingerprint: realm.fingerprint,
        sqlite: {},
      });
      const failure = captureError(() => call(
        bounded,
        DATABASE_ACTOR_OPERATIONS.execute,
        'write',
        {
          databaseRef,
          operation: {
            type: 'mutate',
            idempotencyKey: 'hot:max-bytes:1',
            mutation: {
              type: 'create',
              table: 'todos',
              row: { id: 'large', title: 'x'.repeat(65_536) },
            },
          },
        },
      ));
      expect(failure.code).toBe('DATABASE_PAYLOAD_LIMIT');
      expect(failure.retryable).toBe(false);
      expect(failure.outcome).toBe('not-committed');
      expect(failure.details).toEqual({ reason: 'max-bytes' });
      expect(bounded.diagnostics().state).toBe('bound');
    } finally {
      bounded.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('flushes periodic and final hot placements on release and fails closed', () => {
    const directory = createDirectory();
    try {
      for (const durability of ['periodic', 'final'] as const) {
        const filePath = join(directory, `${durability}.sqlite`);
        const databaseRef = createDatabaseRef(`actor-hot-${durability}`);
        const actor = new DatabaseActorRuntime({ role: 'writer', realm });
        call(actor, DATABASE_ACTOR_OPERATIONS.bindWriter, 'write', {
          databaseRef,
          filePath,
          placement: hotPlacement(durability),
          realmFingerprint: realm.fingerprint,
          sqlite: {},
        });
        call(actor, DATABASE_ACTOR_OPERATIONS.execute, 'write', {
          databaseRef,
          operation: {
            type: 'mutate',
            idempotencyKey: `hot:${durability}:1`,
            mutation: {
              type: 'create', table: 'todos',
              row: { id: durability, title: `${durability} row` },
            },
          },
        });

        if (durability === 'final') {
          const snapshot = hotSnapshot(actor);
          const originalSnapshotSync = snapshot.snapshotSyncDetailed.bind(snapshot);
          snapshot.snapshotSyncDetailed = () => ({
            status: 'failed', durable: false,
            error: new Error('injected final snapshot failure'),
          });
          expectCode(() => call(actor, DATABASE_ACTOR_OPERATIONS.unbind, 'read', {
            databaseRef,
          }), 'DATABASE_EXECUTOR_FAILED');
          expect(actor.diagnostics()).toMatchObject({
            state: 'failed', databaseRef,
          });
          snapshot.snapshotSyncDetailed = originalSnapshotSync;
          actor.close();
        } else {
          actor.close();
        }

        const restored = new DatabaseActorRuntime({ role: 'writer', realm });
        try {
          call(restored, DATABASE_ACTOR_OPERATIONS.bindWriter, 'write', {
            databaseRef,
            filePath,
            placement: hotPlacement('on-write'),
            realmFingerprint: realm.fingerprint,
            sqlite: {},
          });
          expect(call(restored, DATABASE_ACTOR_OPERATIONS.execute, 'read', {
            databaseRef,
            operation: { type: 'get', table: 'todos', id: durability },
          })).toMatchObject({
            value: { id: durability, title: `${durability} row` },
          });
        } finally {
          restored.close();
        }
      }
    } finally {
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
        placement: FILE_PLACEMENT,
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
          placement: FILE_PLACEMENT,
          realmFingerprint: realm.fingerprint,
          sqlite: {},
        },
      ));
      expect(error).toMatchObject({
        code: 'DATABASE_OPEN_FAILED',
        retryable: false,
        outcome: 'not-started',
        details: { phase: 'identity' },
      });
      expect(`${error.message}\n${JSON.stringify(error)}`).not.toContain(unusablePath);
      expect(actor.diagnostics()).toMatchObject({ state: 'unbound', databaseRef: null });
      expect(JSON.stringify(actor.diagnostics())).not.toContain(directory);
    } finally {
      actor.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects a pathname replacement between parent proof and actor open', () => {
    const directory = createDirectory();
    const filePath = join(directory, 'handoff-swap.sqlite');
    const databaseRef = createDatabaseRef('actor-handoff-swap');
    const payload = prepareBindPayload({
      databaseRef,
      filePath,
      placement: FILE_PLACEMENT,
      realmFingerprint: realm.fingerprint,
      sqlite: {},
    });
    const replacement = `${filePath}.replacement`;
    copyFileSync(filePath, replacement);
    renameSync(replacement, filePath);
    const actor = new DatabaseActorRuntime({ role: 'writer', realm });
    try {
      const error = captureError(() => call(
        actor,
        DATABASE_ACTOR_OPERATIONS.bindWriter,
        'write',
        payload,
      ));
      expect(error).toMatchObject({
        code: 'DATABASE_OPEN_FAILED',
        retryable: false,
        outcome: 'not-started',
        details: { phase: 'identity' },
      });
      expect(`${error.message}\n${JSON.stringify(error)}`).not.toContain(filePath);
      expect(`${error.message}\n${JSON.stringify(error)}`).not.toContain(databaseRef);
      expect(actor.diagnostics()).toMatchObject({ state: 'unbound' });
    } finally {
      actor.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects a bind buffered before replacement startup rotates liveness', () => {
    const directory = createDirectory();
    const filePath = join(directory, 'stale-liveness-bind.sqlite');
    const databaseRef = createDatabaseRef('actor-stale-liveness-bind');
    const stalePayload = prepareBindPayload({
      databaseRef,
      filePath,
      placement: FILE_PLACEMENT,
      realmFingerprint: realm.fingerprint,
      sqlite: {},
    }) as unknown as DatabaseActorBindPayload;
    const staleLiveness = stalePayload.actorLiveness;
    const currentLiveness = probeDatabaseActorLiveness(directory);
    const actor = new DatabaseActorRuntime({ role: 'writer', realm });
    try {
      const error = captureError(() => call(
        actor,
        DATABASE_ACTOR_OPERATIONS.bindWriter,
        'write',
        stalePayload as unknown as DatabaseExecutorValue,
      ));
      expect(error).toMatchObject({
        code: 'DATABASE_AUTHORITY_CHANGED',
        retryable: false,
        outcome: 'not-started',
        details: {},
      });
      const publicFailure = `${error.message}\n${JSON.stringify(error)}`;
      expect(publicFailure).not.toContain(directory);
      expect(publicFailure).not.toContain(databaseRef);
      expect(publicFailure).not.toContain(staleLiveness.generation);
      expect(publicFailure).not.toContain(currentLiveness.generation);
      expect(actor.diagnostics()).toMatchObject({ state: 'unbound' });

      expect(call(actor, DATABASE_ACTOR_OPERATIONS.bindWriter, 'write', {
        ...stalePayload,
        actorLiveness: currentLiveness,
      } as unknown as DatabaseExecutorValue)).toMatchObject({
        databaseRef,
        role: 'writer',
      });
      call(actor, DATABASE_ACTOR_OPERATIONS.unbind, 'read', { databaseRef });
    } finally {
      actor.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('preserves only the fixed expired-receipt state across the actor boundary', () => {
    const directory = createDirectory();
    const filePath = join(directory, 'receipt-errors.sqlite');
    const databaseRef = createDatabaseRef('actor-receipt-errors');
    const actor = new DatabaseActorRuntime({ role: 'writer', realm });
    try {
      call(actor, DATABASE_ACTOR_OPERATIONS.bindWriter, 'write', {
        databaseRef,
        filePath,
        placement: FILE_PLACEMENT,
        realmFingerprint: realm.fingerprint,
        sqlite: {},
      });
      const internal = actor as unknown as {
        binding: {
          engine: {
            findReceipt: (key: string, fingerprint: string) => unknown;
          };
        };
      };
      internal.binding.engine.findReceipt = () => {
        throw new DatabaseError(
          'DATABASE_OUTCOME_UNKNOWN',
          'private receipt identity must not cross the actor boundary',
          {
            retryable: false,
            outcome: 'unknown',
            details: {
              receiptState: 'expired',
              receiptKey: 'private-receipt-key',
              fingerprint: `sha256:${'f'.repeat(64)}`,
            },
          },
        );
      };

      const error = captureError(() => call(
        actor,
        DATABASE_ACTOR_OPERATIONS.findReceipt,
        'read',
        {
          databaseRef,
          idempotencyKey: 'receipt:expired',
          logicalReceiptFingerprint: `sha256:${'a'.repeat(64)}`,
        },
      ));
      expect(error).toMatchObject({
        code: 'DATABASE_OUTCOME_UNKNOWN',
        outcome: 'unknown',
        retryable: false,
        details: { receiptState: 'expired' },
      });
      expect(error.message).not.toContain('private receipt');
      expect(error.details.receiptKey).toBeUndefined();
      expect(error.details.fingerprint).toBeUndefined();
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
      const snapshotOwner = '22222222-2222-4222-8222-222222222222';
      const subprocessSnapshot = await writer.execute({
        operation: DATABASE_ACTOR_OPERATIONS.tenantSyncSnapshotBegin,
        kind: 'read',
        payload: {
          databaseRef: secondRef,
          generation: 1,
          ownerToken: snapshotOwner,
          tables: ['todos'],
        },
      }) as Record<string, any>;
      expect(subprocessSnapshot).toMatchObject({
        sequence: { seq: 1 },
        totalRows: 1,
      });
      expect(await writer.execute({
        operation: DATABASE_ACTOR_OPERATIONS.tenantSyncSnapshotPage,
        kind: 'read',
        payload: {
          databaseRef: secondRef,
          generation: 1,
          ownerToken: snapshotOwner,
          sessionId: subprocessSnapshot.sessionId,
          tables: ['todos'],
          cursor: 0,
        },
      })).toMatchObject({
        rows: [{ rowId: 'b', row: { id: 'b', title: 'IPC Second' } }],
        nextCursor: null,
      });
      const subprocessAbort: unknown = await writer.execute({
        operation: DATABASE_ACTOR_OPERATIONS.tenantSyncSnapshotAbort,
        kind: 'read',
        payload: {
          databaseRef: secondRef,
          generation: 1,
          ownerToken: snapshotOwner,
          sessionId: subprocessSnapshot.sessionId,
          tables: ['todos'],
        },
      });
      expect(subprocessAbort).toEqual({ aborted: true });
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
  return actor.handle({
    operation,
    kind,
    payload: isBindOperation(operation)
      ? prepareBindPayload(payload)
      : payload,
  });
}

function isBindOperation(operation: string): boolean {
  return operation === DATABASE_ACTOR_OPERATIONS.bindWriter
    || operation === DATABASE_ACTOR_OPERATIONS.bindReader;
}

function prepareBindPayload(payload: DatabaseExecutorValue): DatabaseExecutorValue {
  const record = payload as Record<string, unknown>;
  if (record.fileIdentity && record.instanceId && record.actorLiveness) {
    return payload;
  }
  const filePath = record.filePath as string;
  const databaseRef = record.databaseRef as DatabaseRef;
  const root = dirname(filePath);
  let actorLiveness = actorLivenessByRoot.get(root);
  if (!actorLiveness) {
    actorLiveness = probeDatabaseActorLiveness(root);
    actorLivenessByRoot.set(root, actorLiveness);
  }

  const cached = actorBindingByPath.get(filePath);
  if (cached
    && existsSync(filePath)
    && (record.placement as { mode?: unknown } | undefined)?.mode === 'file') {
    return {
      ...record,
      fileIdentity: cached.fileIdentity,
      instanceId: cached.instanceId,
      actorLiveness,
    } as DatabaseActorBindPayload as unknown as DatabaseExecutorValue;
  }

  let fileIdentity: DatabaseFileIdentityProof = { device: '0', inode: '0' };
  let instanceId = cached?.instanceId
    ?? '00000000-0000-4000-8000-000000000001';
  let created = false;
  if (!existsSync(filePath)) {
    const descriptor = openSync(filePath, 'wx', 0o600);
    closeSync(descriptor);
    created = true;
  }
  if (lstatSync(filePath).isFile()) {
    const guard = openDatabaseFileIdentityGuard(filePath, { access: 'readwrite' });
    try {
      const previous = actorBindingByPath.get(filePath);
      const identity = prepareDatabaseBindingIdentity({
        filePath,
        fileIdentity: guard.proof,
        databaseRef,
        realmName: realm.name,
        initialize: created,
      });
      guard.assertCurrent();
      if (!created && previous && (previous.databaseRef !== databaseRef
        || previous.instanceId !== identity.instanceId)) {
        throw new Error('Test actor binding identity changed unexpectedly.');
      }
      actorBindingByPath.set(filePath, Object.freeze({
        databaseRef,
        instanceId: identity.instanceId,
        fileIdentity: guard.proof,
      }));
      fileIdentity = guard.proof;
      instanceId = identity.instanceId;
    } finally {
      guard.release();
    }
  }
  return {
    ...record,
    fileIdentity,
    instanceId,
    actorLiveness,
  } as DatabaseActorBindPayload as unknown as DatabaseExecutorValue;
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
      placement: FILE_PLACEMENT,
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
    payload: prepareBindPayload({
      databaseRef,
      filePath,
      placement: FILE_PLACEMENT,
      realmFingerprint: realm.fingerprint,
      sqlite: {},
    }),
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

async function waitForActorState(
  actor: DatabaseActorRuntime,
  state: ReturnType<DatabaseActorRuntime['diagnostics']>['state'],
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (actor.diagnostics().state !== state && Date.now() < deadline) {
    await Bun.sleep(1);
  }
  expect(actor.diagnostics().state).toBe(state);
}

async function waitForActorEvent(
  events: readonly DatabaseExecutorEvent[],
  type: DatabaseExecutorEvent['type'],
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!events.some((event) => event.type === type) && Date.now() < deadline) {
    await Bun.sleep(1);
  }
  expect(events.some((event) => event.type === type)).toBe(true);
}

function hotPlacement(
  durability: 'on-write' | 'periodic' | 'final',
  maxBytes = HOT_MAX_BYTES,
) {
  return Object.freeze({
    mode: 'hot' as const,
    durability,
    maxBytes,
    ...(durability === 'periodic' ? { snapshotIntervalMs: 60_000 } : {}),
  });
}

function hotSnapshot(actor: DatabaseActorRuntime) {
  const snapshot = (actor as unknown as {
    binding: {
      runtime: {
        sqlite: { snapshot: SnapshotManager | null };
      };
    };
  }).binding.runtime.sqlite.snapshot;
  if (!snapshot) throw new Error('Expected a hot actor snapshot manager.');
  return snapshot;
}

function hotRaw(actor: DatabaseActorRuntime) {
  return (actor as unknown as {
    binding: { runtime: { sqlite: { raw: Database } } };
  }).binding.runtime.sqlite.raw;
}

class ActorServerTransport implements SubprocessDatabaseServerTransport {
  readonly sent: SubprocessDatabaseExecutorEvent[] = [];
  private messageListener: ((message: unknown) => void) | null = null;
  private disconnectListener: (() => void) | null = null;

  send(message: SubprocessDatabaseExecutorEvent): void {
    this.sent.push(message);
  }

  disconnect(): void {}

  onMessage(listener: (message: unknown) => void): void {
    this.messageListener = listener;
  }

  offMessage(listener: (message: unknown) => void): void {
    if (this.messageListener === listener) this.messageListener = null;
  }

  onDisconnect(listener: () => void): void {
    this.disconnectListener = listener;
  }

  offDisconnect(listener: () => void): void {
    if (this.disconnectListener === listener) this.disconnectListener = null;
  }

  emit(message: unknown): void {
    this.messageListener?.(message);
  }
}

async function waitForActorServerMessages(
  transport: ActorServerTransport,
  count: number,
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (transport.sent.length < count && Date.now() < deadline) {
    await Bun.sleep(1);
  }
  expect(transport.sent.length).toBeGreaterThanOrEqual(count);
}
