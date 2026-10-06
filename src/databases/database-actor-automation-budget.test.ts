/** Real file-backed Fabric actor coverage for transaction automation budget ownership. */
import { afterEach, describe, expect, test } from 'bun:test';

import { defineDatabaseAutomations } from '../database-automations/database-automations';
import { defineDatabaseFunction } from '../database-automations/database-function';
import { defineDatabaseTrigger } from '../database-automations/database-trigger';
import type { DatabaseTransactionFunctionCapability } from '../database-automations/database-transaction-function-capability';
import type { DatabaseTriggerFunctionInput } from '../database-automations/database-trigger-input';
import { probeDatabaseActorLiveness } from './database-actor-liveness';
import { DATABASE_ACTOR_OPERATIONS, type DatabaseActorBindPayload } from './database-actor-protocol';
import { DatabaseActorRuntime } from './database-actor-runtime';
import { prepareDatabaseBindingIdentity } from './database-binding-identity';
import type { DatabaseExecutorValue } from './database-executor';
import { createDatabaseRef, prepareDatabaseFile, type DatabaseRef } from './database-file';
import { defineDatabaseRealm, type DatabaseRealm } from './database-realm';

const SCRATCH_ROOT = `/Volumes/code-bank/tmp/scratch/zero-platform/trigger-budget-${crypto.randomUUID()}`;
const createdFiles = new Set<string>();

afterEach(async () => {
  // Every path was created by this synthetic fixture; no existing runtime
  // database or application directory is opened or removed by these tests.
  for (const path of createdFiles) {
    await Bun.file(path).delete().catch(() => undefined);
    await Bun.file(`${path}-wal`).delete().catch(() => undefined);
    await Bun.file(`${path}-shm`).delete().catch(() => undefined);
  }
  createdFiles.clear();
});

describe('Fabric actor automation change budgets', () => {
  test('commits a registered command with 300 unrelated permission writes and keeps the public batch limit', () => {
    const realm = createRealm(false);
    const fixture = openActor(realm);
    try {
      const result = write(fixture, {
        type: 'command', name: 'permissions.seed', input: null, idempotencyKey: 'permission-seed',
      }) as { sequence: { seq: number } };
      expect(result.sequence.seq).toBe(300);
      expect(readRows(fixture, 'permissions')).toHaveLength(300);
      expect(readRows(fixture, 'orders')).toEqual([]);
      expect(readRows(fixture, 'rollups')).toEqual([]);
      expect(() => write(fixture, {
        type: 'batch', idempotencyKey: 'oversized-unrelated-batch',
        mutations: Array.from({ length: 257 }, (_, index) => ({
          type: 'create', table: 'permissions', row: { id: `batch-${index}`, granted: 1 },
        })),
      })).toThrow(expect.objectContaining({ code: 'DATABASE_PAYLOAD_LIMIT' }));
      expect(readRows(fixture, 'permissions')).toHaveLength(300);
    } finally { fixture.actor.close(); }
  });

  test('accepts exactly 256 matched origins but rejects the 257th without retaining rows or a receipt', () => {
    const fixture = openActor(createRealm(false));
    try {
      expect(() => write(fixture, {
        type: 'command', name: 'orders.seed', input: 257, idempotencyKey: 'matched-limit',
      })).toThrow(expect.objectContaining({ code: 'DATABASE_PAYLOAD_LIMIT', outcome: 'not-committed' }));
      expect(readRows(fixture, 'orders')).toEqual([]);
      expect(readRows(fixture, 'permissions')).toEqual([]);
      // Reusing the key with corrected input succeeds: a rolled-back command
      // did not retain a conflicting success receipt or a spent budget.
      const result = write(fixture, {
        type: 'command', name: 'orders.seed', input: 256, idempotencyKey: 'matched-limit',
      }) as { sequence: { seq: number } };
      expect(result.sequence.seq).toBe(257); // 256 origins + unrelated marker.
      expect(readRows(fixture, 'orders')).toHaveLength(256);
      expect(readRows(fixture, 'permissions')).toHaveLength(1);
    } finally { fixture.actor.close(); }
  });

  test('rolls back the source and all untriggered rollup writes when generated work exceeds the cap', () => {
    const fixture = openActor(createRealm(true));
    try {
      expect(() => write(fixture, {
        type: 'command', name: 'orders.excessive', input: null, idempotencyKey: 'rollup-limit',
      })).toThrow(expect.objectContaining({ code: 'DATABASE_PAYLOAD_LIMIT', outcome: 'not-committed' }));
      expect(readRows(fixture, 'orders')).toEqual([]);
      expect(readRows(fixture, 'permissions')).toEqual([]);
      expect(readRows(fixture, 'rollups')).toEqual([]);
      const result = write(fixture, {
        type: 'mutate', idempotencyKey: 'next-root',
        mutation: { type: 'create', table: 'orders', row: { id: 'next', status: 'normal' } },
      }) as { sequence: { seq: number } };
      expect(result.sequence.seq).toBe(2);
      expect(readRows(fixture, 'rollups')).toEqual([{ id: 'next-0', count: 1 }]);
    } finally { fixture.actor.close(); }
  });
});

function createRealm(generated: boolean): DatabaseRealm {
  const observe = defineDatabaseFunction<DatabaseTriggerFunctionInput, void, DatabaseTransactionFunctionCapability>({
    name: 'orders.observe', version: 1, mode: 'transaction',
    handler: ({ input, transaction }) => {
      if (!generated) return;
      const count = input.change.row?.status === 'excessive' ? 256 : 1;
      for (let index = 0; index < count; index++) {
        transaction.createStrict('rollups', { id: `${input.change.rowId}-${index}`, count: 1 });
      }
    },
  });
  const trigger = defineDatabaseTrigger({
    name: 'orders.inserted', version: 1, table: 'orders', after: { insert: true }, run: observe,
  });
  return defineDatabaseRealm({
    name: generated ? 'actor-generated-budget' : 'actor-origin-budget', version: '1',
    tables: {
      orders: { id: 'TEXT PRIMARY KEY', status: 'TEXT NOT NULL' },
      permissions: { id: 'TEXT PRIMARY KEY', granted: 'INTEGER NOT NULL' },
      rollups: { id: 'TEXT PRIMARY KEY', count: 'INTEGER NOT NULL' },
    },
    automations: defineDatabaseAutomations({ functions: [observe], triggers: [trigger] }),
    commands: {
      'permissions.seed': ({ db }) => {
        for (let index = 0; index < 300; index++) {
          db.createStrict('permissions', { id: `permission-${index}`, granted: 1 });
        }
        return { count: 300 };
      },
      'orders.seed': ({ db }, count: number) => {
        db.createStrict('permissions', { id: 'marker', granted: 1 });
        for (let index = 0; index < count; index++) {
          db.createStrict('orders', { id: `order-${index}`, status: 'normal' });
        }
        return { count };
      },
      'orders.excessive': ({ db }) => {
        db.createStrict('permissions', { id: 'marker', granted: 1 });
        db.createStrict('orders', { id: 'excessive', status: 'excessive' });
        return null;
      },
    },
  });
}

interface ActorFixture { readonly actor: DatabaseActorRuntime; readonly databaseRef: DatabaseRef }

function openActor(realm: DatabaseRealm): ActorFixture {
  const root = `${SCRATCH_ROOT}/${crypto.randomUUID()}`;
  const prepared = prepareDatabaseFile(root, 'tenant-budget');
  createdFiles.add(prepared.path);
  const databaseRef = createDatabaseRef(prepared.id);
  const identity = prepareDatabaseBindingIdentity({
    filePath: prepared.path, fileIdentity: prepared.identity, databaseRef,
    realmName: realm.name, initialize: prepared.created,
  });
  const actorLiveness = probeDatabaseActorLiveness(root);
  createdFiles.add(actorLiveness.filePath);
  const actor = new DatabaseActorRuntime({ role: 'writer', realm });
  const payload = {
    databaseRef, filePath: prepared.path, fileIdentity: prepared.identity,
    instanceId: identity.instanceId, actorLiveness,
    placement: { mode: 'file' }, realmFingerprint: realm.fingerprint, sqlite: {},
  } satisfies DatabaseActorBindPayload;
  try {
    actor.handle({ operation: DATABASE_ACTOR_OPERATIONS.bindWriter, kind: 'write',
      payload: payload as unknown as DatabaseExecutorValue });
    return { actor, databaseRef };
  } catch (error) { actor.close(); throw error; }
}

function write(fixture: ActorFixture, operation: unknown): DatabaseExecutorValue {
  return fixture.actor.handle({ operation: DATABASE_ACTOR_OPERATIONS.execute, kind: 'write',
    payload: { databaseRef: fixture.databaseRef, operation } as DatabaseExecutorValue });
}

function readRows(fixture: ActorFixture, table: string): unknown[] {
  const result = fixture.actor.handle({ operation: DATABASE_ACTOR_OPERATIONS.execute, kind: 'read',
    payload: { databaseRef: fixture.databaseRef, operation: { type: 'list', table, limit: 500 } },
  }) as { value: { rows: unknown[] } };
  return result.value.rows;
}
