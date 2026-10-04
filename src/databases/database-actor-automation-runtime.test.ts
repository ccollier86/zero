import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';

import {
  DATABASE_AUTOMATION_OUTBOX_TABLE,
} from '../database-automations/automation-outbox-schema-sql';
import {
  defineDatabaseAutomations,
} from '../database-automations/database-automations';
import { defineDatabaseFunction } from '../database-automations/database-function';
import type { DatabaseTransactionFunctionCapability } from '../database-automations/database-transaction-function-capability';
import type { DatabaseTriggerFunctionInput } from '../database-automations/database-trigger-input';
import { defineDatabaseTrigger } from '../database-automations/database-trigger';
import { createReactiveDB } from '../sync/reactive-db';
import type { SnapshotWriteResult } from '../persistence/snapshot-manager';
import type { DatabaseActorWriterBinding } from './database-actor-binding';
import { DatabaseActorAutomationSession } from './database-actor-automation-session';
import {
  DATABASE_ACTOR_AUTOMATION_OUTBOX_OPERATION,
} from './database-automation-actor-protocol';
import {
  probeDatabaseActorLiveness,
  type DatabaseActorLivenessBinding,
} from './database-actor-liveness';
import {
  DATABASE_ACTOR_OPERATIONS,
  type DatabaseActorBindPayload,
  type DatabaseActorPlacementConfig,
} from './database-actor-protocol';
import { DatabaseActorRuntime } from './database-actor-runtime';
import { prepareDatabaseBindingIdentity } from './database-binding-identity';
import { DatabaseError, type DatabaseErrorCode } from './database-error';
import {
  createDatabaseRef,
  prepareDatabaseFile,
  type DatabaseRef,
} from './database-file';
import type { DatabaseExecutorValue } from './database-executor';
import { defineDatabaseRealm, type DatabaseRealm } from './database-realm';

const FILE_PLACEMENT = Object.freeze({ mode: 'file' as const });
const HOT_MAX_BYTES = 16 * 1024 * 1024;
const TEST_ROOT = `/tmp/zero-actor-automation-${crypto.randomUUID()}`;
const paths = new Set<string>();
let actorLiveness: DatabaseActorLivenessBinding | null = null;

const rollup = defineDatabaseFunction<
  DatabaseTriggerFunctionInput,
  void,
  DatabaseTransactionFunctionCapability
>({
  name: 'orders.rollup',
  version: 1,
  mode: 'transaction',
  handler: ({ transaction }) => {
    const current = transaction.get('order_rollups', 'orders') as {
      id: string;
      count: number;
    } | null;
    if (current) {
      transaction.update('order_rollups', current.id, {
        count: current.count + 1,
      });
    } else {
      transaction.createStrict('order_rollups', { id: 'orders', count: 1 });
    }
  },
});
const notify = defineDatabaseFunction<DatabaseTriggerFunctionInput>({
  name: 'orders.notify',
  version: 1,
  mode: 'durable',
  handler: async () => undefined,
});
const allTrigger = defineDatabaseTrigger({
  name: 'orders.changed',
  version: 1,
  table: 'orders',
  after: { insert: true },
  run: [rollup, notify],
});
const transactionTrigger = defineDatabaseTrigger({
  name: 'orders.rollup-only',
  version: 1,
  table: 'orders',
  after: { insert: true },
  run: rollup,
});
const automatedRealm = createRealm('actor-automated', defineDatabaseAutomations({
  functions: [rollup, notify],
  triggers: [allTrigger],
}));
const transactionRealm = createRealm('actor-transaction-only', defineDatabaseAutomations({
  functions: [rollup],
  triggers: [transactionTrigger],
}));

afterEach(async () => {
  for (const path of paths) {
    await Bun.file(path).delete().catch(() => undefined);
    await Bun.file(`${path}-wal`).delete().catch(() => undefined);
    await Bun.file(`${path}-shm`).delete().catch(() => undefined);
  }
  paths.clear();
});

describe('database actor automation integration', () => {
  test('executes transaction-only triggers and rejects durable IPC on ephemeral sources', () => {
    const actor = new DatabaseActorRuntime({ role: 'writer', realm: transactionRealm });
    const fixture = bindActor(actor, transactionRealm, 'transaction-only');
    try {
      createOrder(actor, fixture.databaseRef, 'one');
      expect(readRollup(actor, fixture.databaseRef)).toMatchObject({ count: 1 });
      expectCode(() => actorCall(
        actor,
        DATABASE_ACTOR_AUTOMATION_OUTBOX_OPERATION,
        'read',
        { databaseRef: fixture.databaseRef, action: 'counts' },
      ), 'DATABASE_OPERATION_UNSUPPORTED');
    } finally {
      actor.close();
    }

    const db = createReactiveDB({
      mode: 'memory',
      emitCode: () => undefined,
      emitTelemetry: false,
    });
    db.defineTable('orders', { id: 'text primary key', status: 'text not null' });
    db.defineTable('order_rollups', {
      id: 'text primary key',
      count: 'integer not null',
    });
    try {
      expect(() => new DatabaseActorAutomationSession({
        db,
        registry: automatedRealm.automations!,
        realmName: automatedRealm.name,
        realmFingerprint: automatedRealm.fingerprint,
        storageMode: 'ephemeral',
      })).toThrow(expect.objectContaining({
        code: 'DATABASE_CONFIG_INVALID',
        outcome: 'not-started',
      }));
    } finally {
      db.dispose();
    }
  });

  test('runs the complete durable claim, renew, retry, recovery, and terminal lifecycle', () => {
    const actor = new DatabaseActorRuntime({ role: 'writer', realm: automatedRealm });
    const fixture = bindActor(actor, automatedRealm, 'durable-lifecycle');
    const now = Date.now() + 10_000;
    try {
      createOrder(actor, fixture.databaseRef, 'one');
      expect(automationCall(actor, 'read', {
        databaseRef: fixture.databaseRef,
        action: 'counts',
      })).toMatchObject({ pendingRecords: 1, processingRecords: 0 });

      const first = requireClaim(automationCall(actor, 'write', {
        databaseRef: fixture.databaseRef,
        action: 'claim',
        leaseOwner: 'worker:one',
        now,
        leaseMs: 1_000,
      }));
      const renewed = requireClaim(automationCall(actor, 'write', {
        databaseRef: fixture.databaseRef,
        action: 'renew',
        lease: deliveryLease(first),
        now: now + 100,
        leaseMs: 1_000,
      }));
      expect(renewed.leaseExpiresAt).toBe(now + 1_100);
      expect(automationCall(actor, 'write', {
        databaseRef: fixture.databaseRef,
        action: 'retry',
        lease: deliveryLease(renewed),
        errorCode: 'REMOTE_UNAVAILABLE',
        retryAt: now + 2_000,
        now: now + 200,
      })).toBe('pending');
      expect(automationCall(actor, 'write', {
        databaseRef: fixture.databaseRef,
        action: 'claim',
        leaseOwner: 'worker:early',
        now: now + 1_999,
        leaseMs: 1_000,
      })).toBeNull();
      const retried = requireClaim(automationCall(actor, 'write', {
        databaseRef: fixture.databaseRef,
        action: 'claim',
        leaseOwner: 'worker:two',
        now: now + 2_000,
        leaseMs: 1_000,
      }));
      expect(retried.attemptCount).toBe(2);
      expect(automationCall(actor, 'write', {
        databaseRef: fixture.databaseRef,
        action: 'complete',
        lease: deliveryLease(retried),
        now: now + 2_001,
      })).toBe('completed');

      createOrder(actor, fixture.databaseRef, 'two');
      const expiring = requireClaim(automationCall(actor, 'write', {
        databaseRef: fixture.databaseRef,
        action: 'claim',
        leaseOwner: 'worker:three',
        now: now + 3_000,
        leaseMs: 1_000,
      }));
      expect(automationCall(actor, 'write', {
        databaseRef: fixture.databaseRef,
        action: 'recover-expired',
        now: expiring.leaseExpiresAt,
      })).toEqual({ requeued: 1, dead: 0 });
      const recovered = requireClaim(automationCall(actor, 'write', {
        databaseRef: fixture.databaseRef,
        action: 'claim',
        leaseOwner: 'worker:four',
        now: expiring.leaseExpiresAt,
        leaseMs: 1_000,
      }));
      expect(recovered.leaseToken).not.toBe(expiring.leaseToken);
      expect(automationCall(actor, 'write', {
        databaseRef: fixture.databaseRef,
        action: 'dead',
        lease: deliveryLease(recovered),
        errorCode: 'REMOTE_REJECTED',
        now: expiring.leaseExpiresAt + 1,
      })).toBe('dead');

      expect(automationCall(actor, 'read', {
        databaseRef: fixture.databaseRef,
        action: 'counts',
      })).toMatchObject({
        activeRecords: 0,
        completedRecords: 1,
        deadRecords: 1,
      });
      expect(readRollup(actor, fixture.databaseRef)).toMatchObject({ count: 2 });
    } finally {
      actor.close();
    }
  });

  test('requires a writer, the exact binding, and the exact operation kind', () => {
    const writer = new DatabaseActorRuntime({ role: 'writer', realm: automatedRealm });
    const fixture = bindActor(writer, automatedRealm, 'reader-rejection');
    createOrder(writer, fixture.databaseRef, 'one');
    const reader = new DatabaseActorRuntime({ role: 'reader', realm: automatedRealm });
    try {
      actorCall(
        reader,
        DATABASE_ACTOR_OPERATIONS.bindReader,
        'read',
        fixture.payload,
      );
      expectCode(() => automationCall(reader, 'read', {
        databaseRef: fixture.databaseRef,
        action: 'counts',
      }), 'DATABASE_OPERATION_UNSUPPORTED');
      expectCode(() => automationCall(reader, 'write', {
        databaseRef: fixture.databaseRef,
        action: 'claim',
        leaseOwner: 'worker:reader',
        now: Date.now(),
        leaseMs: 1_000,
      }), 'DATABASE_OPERATION_UNSUPPORTED');
      expectCode(() => automationCall(writer, 'write', {
        databaseRef: fixture.databaseRef,
        action: 'counts',
      }), 'DATABASE_PROTOCOL_ERROR');
      expectCode(() => automationCall(writer, 'read', {
        databaseRef: fixture.databaseRef,
        action: 'recover-expired',
        now: Date.now(),
      }), 'DATABASE_PROTOCOL_ERROR');
      expectCode(() => automationCall(writer, 'read', {
        databaseRef: createDatabaseRef('another-binding'),
        action: 'counts',
      }), 'DATABASE_AUTHORITY_CHANGED');

      const privateValue = '/private/customer/acme.sqlite handler-input-secret';
      const error = captureError(() => automationCall(writer, 'read', {
        databaseRef: fixture.databaseRef,
        action: 'counts',
        filePath: privateValue,
      }));
      expect(error.code).toBe('DATABASE_PAYLOAD_INVALID');
      expect(`${error.message}\n${JSON.stringify(error)}`).not.toContain(privateValue);
      expect(error.details).toEqual({});
    } finally {
      reader.close();
      writer.close();
    }
  });

  test('forces a synchronous durable image before every hot claim is returned', () => {
    for (const durability of ['on-write', 'periodic', 'final'] as const) {
      const actor = new DatabaseActorRuntime({ role: 'writer', realm: automatedRealm });
      const fixture = bindActor(
        actor,
        automatedRealm,
        `hot-claim-${durability}`,
        hotPlacement(durability),
      );
      const snapshot = hotSnapshot(actor);
      const originalSnapshot = snapshot.snapshotSyncDetailed.bind(snapshot);
      try {
        createOrder(actor, fixture.databaseRef, durability);
        let synchronousClaims = 0;
        snapshot.snapshotSyncDetailed = () => {
          synchronousClaims += 1;
          return originalSnapshot();
        };
        const claim = requireClaim(automationCall(actor, 'write', {
          databaseRef: fixture.databaseRef,
          action: 'claim',
          leaseOwner: `worker:${durability}`,
          now: Date.now() + 10_000,
          leaseMs: 1_000,
        }));
        expect(claim.input).toMatchObject({
          change: { rowId: durability },
        });
        expect(synchronousClaims).toBe(1);
      } finally {
        snapshot.snapshotSyncDetailed = originalSnapshot;
        actor.close();
      }
    }
  });

  test('quarantines a hot actor when claimed state cannot be durably published', () => {
    const actor = new DatabaseActorRuntime({ role: 'writer', realm: automatedRealm });
    const fixture = bindActor(
      actor,
      automatedRealm,
      'hot-claim-failure',
      hotPlacement('final'),
    );
    const snapshot = hotSnapshot(actor);
    const originalSnapshot = snapshot.snapshotSyncDetailed.bind(snapshot);
    const privateValue = `${fixture.path}:order-private`;
    try {
      createOrder(actor, fixture.databaseRef, 'order-private');
      snapshot.snapshotSyncDetailed = (): SnapshotWriteResult => ({
        status: 'failed',
        durable: false,
        error: new Error(privateValue),
      });
      const error = captureError(() => automationCall(actor, 'write', {
        databaseRef: fixture.databaseRef,
        action: 'claim',
        leaseOwner: 'worker:private',
        now: Date.now() + 10_000,
        leaseMs: 1_000,
      }));
      expect(error).toMatchObject({
        code: 'DATABASE_OUTCOME_UNKNOWN',
        retryable: false,
        outcome: 'unknown',
        details: {},
      });
      expect(`${error.message}\n${JSON.stringify(error)}`).not.toContain(privateValue);
      expect(actor.diagnostics().state).toBe('failed');
      expectCode(() => automationCall(actor, 'read', {
        databaseRef: fixture.databaseRef,
        action: 'counts',
      }), 'DATABASE_EXECUTOR_FAILED');
    } finally {
      snapshot.snapshotSyncDetailed = originalSnapshot;
      actor.close();
    }
  });

  test('closes automation ownership before engine/runtime and reinstalls it on rebind', () => {
    const actor = new DatabaseActorRuntime({ role: 'writer', realm: automatedRealm });
    const first = bindActor(actor, automatedRealm, 'cleanup-first');
    const order: string[] = [];
    const binding = writerBinding(actor);
    const session = binding.automationSession!;
    const closeSession = session.close.bind(session);
    const closeEngine = binding.engine.close.bind(binding.engine);
    const closeRuntime = binding.runtime.close.bind(binding.runtime);
    session.close = () => {
      order.push('automation');
      closeSession();
    };
    binding.engine.close = () => {
      order.push('engine');
      closeEngine();
    };
    binding.runtime.close = () => {
      order.push('runtime');
      closeRuntime();
    };

    expect(actorCall(actor, DATABASE_ACTOR_OPERATIONS.unbind, 'read', {
      databaseRef: first.databaseRef,
    })).toBeNull();
    expect(order).toEqual(['automation', 'engine', 'runtime']);

    const second = bindActor(actor, automatedRealm, 'cleanup-second');
    try {
      createOrder(actor, second.databaseRef, 'rebound');
      expect(readRollup(actor, second.databaseRef)).toMatchObject({ count: 1 });
      expect(automationCall(actor, 'read', {
        databaseRef: second.databaseRef,
        action: 'counts',
      })).toMatchObject({ pendingRecords: 1 });
    } finally {
      actor.close();
    }
  });

  test('strictly releases a partially started automation binding before retry', () => {
    const actor = new DatabaseActorRuntime({ role: 'writer', realm: automatedRealm });
    const captured: { fixture?: PreparedActorFixture } = {};
    try {
      expectCode(() => bindActor(
        actor,
        automatedRealm,
        'startup-cleanup',
        FILE_PLACEMENT,
        (fixture) => {
          captured.fixture = fixture;
          const database = new Database(fixture.path);
          try {
            database.exec(`CREATE TABLE ${DATABASE_AUTOMATION_OUTBOX_TABLE} (invalid TEXT)`);
          } finally {
            database.close();
          }
        },
      ), 'DATABASE_SCHEMA_MISMATCH');
      expect(actor.diagnostics().state).toBe('unbound');
      const pending = captured.fixture;
      if (!pending) throw new Error('Expected a prepared failed binding.');

      const database = new Database(pending.path);
      try {
        database.exec(`DROP TABLE ${DATABASE_AUTOMATION_OUTBOX_TABLE}`);
      } finally {
        database.close();
      }
      actorCall(
        actor,
        DATABASE_ACTOR_OPERATIONS.bindWriter,
        'write',
        pending.payload,
      );
      createOrder(actor, pending.databaseRef, 'after-retry');
      expect(readRollup(actor, pending.databaseRef)).toMatchObject({ count: 1 });
      expect(automationCall(actor, 'read', {
        databaseRef: pending.databaseRef,
        action: 'counts',
      })).toMatchObject({ pendingRecords: 1 });
    } finally {
      actor.close();
    }
  });
});

function createRealm(
  name: string,
  automations: NonNullable<DatabaseRealm['automations']>,
): DatabaseRealm {
  return defineDatabaseRealm({
    name,
    version: '1',
    tables: {
      orders: {
        id: 'text primary key',
        status: 'text not null',
      },
      order_rollups: {
        id: 'text primary key',
        count: 'integer not null',
      },
    },
    automations,
  });
}

function bindActor(
  actor: DatabaseActorRuntime,
  realm: DatabaseRealm,
  id: string,
  placement: DatabaseActorPlacementConfig = FILE_PLACEMENT,
  beforeBind?: (fixture: PreparedActorFixture) => void,
): PreparedActorFixture {
  const prepared = prepareDatabaseFile(TEST_ROOT, `${id}-${crypto.randomUUID()}`);
  paths.add(prepared.path);
  const databaseRef = createDatabaseRef(prepared.id);
  const identity = prepareDatabaseBindingIdentity({
    filePath: prepared.path,
    fileIdentity: prepared.identity,
    databaseRef,
    realmName: realm.name,
    initialize: prepared.created,
  });
  actorLiveness ??= probeDatabaseActorLiveness(TEST_ROOT);
  const payload = Object.freeze({
    databaseRef,
    filePath: prepared.path,
    fileIdentity: prepared.identity,
    instanceId: identity.instanceId,
    actorLiveness,
    placement,
    realmFingerprint: realm.fingerprint,
    sqlite: {},
  }) satisfies DatabaseActorBindPayload;
  const fixture = Object.freeze({
    databaseRef,
    path: prepared.path,
    payload,
  });
  beforeBind?.(fixture);
  actorCall(
    actor,
    actor.role === 'writer'
      ? DATABASE_ACTOR_OPERATIONS.bindWriter
      : DATABASE_ACTOR_OPERATIONS.bindReader,
    actor.role === 'writer' ? 'write' : 'read',
    payload,
  );
  return fixture;
}

interface PreparedActorFixture {
  readonly databaseRef: DatabaseRef;
  readonly path: string;
  readonly payload: DatabaseActorBindPayload;
}

function actorCall(
  actor: DatabaseActorRuntime,
  operation: string,
  kind: 'read' | 'write',
  payload: unknown,
): DatabaseExecutorValue {
  return actor.handle({
    operation,
    kind,
    payload: payload as DatabaseExecutorValue,
  });
}

function automationCall(
  actor: DatabaseActorRuntime,
  kind: 'read' | 'write',
  payload: unknown,
): DatabaseExecutorValue {
  return actorCall(
    actor,
    DATABASE_ACTOR_AUTOMATION_OUTBOX_OPERATION,
    kind,
    payload,
  );
}

function createOrder(
  actor: DatabaseActorRuntime,
  databaseRef: DatabaseRef,
  id: string,
): void {
  actorCall(actor, DATABASE_ACTOR_OPERATIONS.execute, 'write', {
    databaseRef,
    operation: {
      type: 'mutate',
      idempotencyKey: `create:${id}`,
      mutation: {
        type: 'create',
        table: 'orders',
        row: { id, status: 'new' },
      },
    },
  });
}

function readRollup(
  actor: DatabaseActorRuntime,
  databaseRef: DatabaseRef,
): Record<string, unknown> {
  const result = actorCall(actor, DATABASE_ACTOR_OPERATIONS.execute, 'read', {
    databaseRef,
    operation: { type: 'get', table: 'order_rollups', id: 'orders' },
  }) as { value?: unknown };
  return result.value as Record<string, unknown>;
}

function requireClaim(value: DatabaseExecutorValue) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a claimed database automation delivery.');
  }
  return value as unknown as {
    deliveryId: string;
    leaseOwner: string;
    leaseToken: string;
    leaseExpiresAt: number;
    updatedAt: number;
    attemptCount: number;
    input: Record<string, unknown>;
  };
}

function deliveryLease(claim: ReturnType<typeof requireClaim>) {
  return Object.freeze({
    deliveryId: claim.deliveryId,
    leaseOwner: claim.leaseOwner,
    leaseToken: claim.leaseToken,
    updatedAt: claim.updatedAt,
  });
}

function hotPlacement(durability: 'on-write' | 'periodic' | 'final') {
  return Object.freeze({
    mode: 'hot' as const,
    durability,
    maxBytes: HOT_MAX_BYTES,
    ...(durability === 'periodic'
      ? { snapshotIntervalMs: 60_000, snapshotTimeoutMs: 120_000 }
      : {}),
  });
}

function writerBinding(actor: DatabaseActorRuntime): DatabaseActorWriterBinding {
  return (actor as unknown as { binding: DatabaseActorWriterBinding }).binding;
}

function hotSnapshot(actor: DatabaseActorRuntime) {
  const snapshot = writerBinding(actor).runtime.sqlite.snapshot;
  if (!snapshot) throw new Error('Expected hot snapshot manager.');
  return snapshot;
}

function expectCode(operation: () => unknown, code: DatabaseErrorCode): void {
  expect(captureError(operation).code).toBe(code);
}

function captureError(operation: () => unknown): DatabaseError {
  try {
    operation();
    throw new Error('Expected database actor operation to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
}
