import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import type { AuthContext } from '../auth/types';
import { MemoryEventStore } from '../observability';
import type { PlatformObservabilityRuntime } from '../observability/types';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { TableSchema } from '../sync/types';
import { defineResource, globalRealm, tenantRealm } from './resource-definition';
import {
  ResourceDefaultReceiptStore,
  ResourceMutationReceiptError,
  RESOURCE_DEFAULT_RECEIPT_MAX_KEYS,
  type ResourceMutationReceiptEffect,
  type ResourceMutationReceiptIdentity,
} from './resource-default-receipt-store';
import { ResourceCrudService, type ResourceCrudRequestContext } from './resource-crud-service';
import { authenticatedOnly, customPolicy } from './resource-policy-helpers';
import { createResourceRegistry } from './resource-registry';

const noteTables = {
  notes: {
    id: 'text primary key',
    title: 'text not null',
  },
} satisfies Record<string, TableSchema>;

describe('default Resource mutation receipts', () => {
  test('replays exact create/update/delete effects without re-executing changed rows', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('notes', noteTables.notes);
    const service = createGlobalService(db);
    const auth = applicationAuth('user-a');

    try {
      const createContext = requestContext(auth, 'canonical-create');
      const createInput = { id: 'created', title: 'Committed create' };
      expect(await service.create('notes', createInput, createContext)).toEqual({
        ok: true,
        status: 201,
        body: { row: createInput },
      });
      db.update('notes', 'created', { title: 'Later create state' });
      expect(await service.create('notes', createInput, createContext)).toEqual({
        ok: true,
        status: 201,
        body: { row: createInput },
      });
      expect(db.get('notes', 'created')).toEqual({
        id: 'created', title: 'Later create state',
      });

      db.insert('notes', { id: 'updated', title: 'Before update' });
      const updateContext = requestContext(auth, 'canonical-update');
      expect(await service.update(
        'notes',
        'updated',
        { title: 'Committed update' },
        updateContext,
      )).toEqual({
        ok: true,
        status: 200,
        body: { row: { id: 'updated', title: 'Committed update' } },
      });
      db.update('notes', 'updated', { title: 'Later update state' });
      expect(await service.update(
        'notes',
        'updated',
        { title: 'Committed update' },
        updateContext,
      )).toEqual({
        ok: true,
        status: 200,
        body: { row: { id: 'updated', title: 'Committed update' } },
      });
      expect(db.get('notes', 'updated')).toEqual({
        id: 'updated', title: 'Later update state',
      });

      db.insert('notes', { id: 'deleted', title: 'Committed delete' });
      const deleteContext = requestContext(auth, 'canonical-delete');
      expect(await service.delete('notes', 'deleted', deleteContext)).toEqual({
        ok: true,
        status: 200,
        body: { deleted: true, id: 'deleted' },
      });
      db.insert('notes', { id: 'deleted', title: 'Later recreated row' });
      expect(await service.delete('notes', 'deleted', deleteContext)).toEqual({
        ok: true,
        status: 200,
        body: { deleted: true, id: 'deleted' },
      });
      expect(db.get('notes', 'deleted')).toEqual({
        id: 'deleted', title: 'Later recreated row',
      });
    } finally {
      db.dispose();
    }
  });

  test('rechecks a create receipt with the same policy input shape as the original create', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('notes', noteTables.notes);
    const policy = customPolicy(({ action, row }) =>
      action !== 'create' || row === undefined, {
      name: 'create-input-shape',
    });
    const registry = createResourceRegistry({
      resources: [defineResource({
        table: 'notes', exposure: 'http', realm: globalRealm(), policy,
      })],
      tables: noteTables,
      authConfig: { userProperties: {} },
      tenancyMode: 'single',
      managedTables: ['notes'],
    });
    const service = new ResourceCrudService({
      db,
      registry,
      tables: noteTables,
      authConfig: { userProperties: {} },
    });
    const input = { id: 'create-shape', title: 'Created once' };
    const context = requestContext(applicationAuth('shape-user'), 'create-shape-key');

    try {
      expect(await service.create('notes', input, context)).toMatchObject({ ok: true });
      expect(await service.create('notes', input, context)).toEqual({
        ok: true,
        status: 201,
        body: { row: input },
      });
    } finally {
      db.dispose();
    }
  });

  test('rejects logical key reuse while keeping caller principals independent', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('notes', noteTables.notes);
    const service = createGlobalService(db);
    const firstPrincipal = applicationAuth('user-a');
    const secondPrincipal = applicationAuth('user-b');

    try {
      expect(await service.create('notes', {
        id: 'principal-a', title: 'A',
      }, requestContext(firstPrincipal, 'shared-visible-key'))).toMatchObject({ ok: true });
      expect(await service.create('notes', {
        id: 'principal-b', title: 'B',
      }, requestContext(secondPrincipal, 'shared-visible-key'))).toMatchObject({ ok: true });

      expect(await service.create('notes', {
        id: 'different-logical-request', title: 'Different',
      }, requestContext(firstPrincipal, 'shared-visible-key'))).toEqual({
        ok: false,
        status: 409,
        body: {
          error: 'Idempotency-Key was already used for a different resource mutation',
          code: 'resource-idempotency-key-reused',
        },
      });
      expect(db.get('notes', 'different-logical-request')).toBeNull();
    } finally {
      db.dispose();
    }
  });

  test('does not let a durable replay bypass current request authority', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('notes', noteTables.notes);
    const service = createGlobalService(db);
    const auth = applicationAuth('revoked-user');
    const context = requestContext(auth, 'revoked-delete');

    try {
      db.insert('notes', { id: 'revoked-row', title: 'Delete once' });
      expect(await service.delete('notes', 'revoked-row', context)).toMatchObject({
        ok: true,
      });
      expect(await service.delete('notes', 'revoked-row', {
        ...context,
        revalidateAuthContext: async () => null,
      })).toEqual({
        ok: false,
        status: 403,
        body: {
          error: 'Resource authorization changed during the request',
          code: 'resource-authority-changed',
        },
      });
    } finally {
      db.dispose();
    }
  });

  test('returns the permanent public expiry contract without re-executing', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('notes', noteTables.notes);
    const service = createGlobalService(db);
    const context = requestContext(applicationAuth('expiry-user'), 'expired-create');
    const input = { id: 'expired-row', title: 'Committed once' };

    try {
      expect(await service.create('notes', input, context)).toMatchObject({ ok: true });
      db.prepare(`
        UPDATE _zero_resource_mutation_receipts
        SET receipt_state = 'expired', result_json = NULL, final_seq = NULL
      `).run();
      db.update('notes', 'expired-row', { title: 'Must remain current' });

      expect(await service.create('notes', input, context)).toEqual({
        ok: false,
        status: 409,
        body: {
          error: 'Idempotency result expired; read the current resource state before submitting new work',
          code: 'resource-idempotency-result-expired',
          retryable: false,
        },
      });
      expect(db.get('notes', 'expired-row')).toEqual({
        id: 'expired-row', title: 'Must remain current',
      });
    } finally {
      db.dispose();
    }
  });

  test('serializes two in-flight retries to one row commit and one receipt', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('notes', noteTables.notes);
    let policyEntries = 0;
    let releasePolicy!: () => void;
    let bothEntered!: () => void;
    const blocked = new Promise<void>((resolve) => { releasePolicy = resolve; });
    const entered = new Promise<void>((resolve) => { bothEntered = resolve; });
    const policy = customPolicy(async ({ action }) => {
      if (action === 'create' && policyEntries < 2) {
        policyEntries += 1;
        if (policyEntries === 2) bothEntered();
        await blocked;
      }
      return true;
    }, { name: 'default-receipt-race' });
    const registry = createResourceRegistry({
      resources: [defineResource({
        table: 'notes', exposure: 'http', realm: globalRealm(), policy,
      })],
      tables: noteTables,
      authConfig: { userProperties: {} },
      tenancyMode: 'single',
      managedTables: ['notes'],
    });
    const service = new ResourceCrudService({
      db,
      registry,
      tables: noteTables,
      authConfig: { userProperties: {} },
    });
    const input = { id: 'raced-row', title: 'Committed once' };
    const context = requestContext(applicationAuth('race-user'), 'raced-key');
    let committedChanges = 0;
    const unsubscribe = db.onChange((change) => {
      if (change.table === 'notes' && change.rowId === 'raced-row') committedChanges += 1;
    });

    try {
      const first = service.create('notes', input, context);
      const second = service.create('notes', input, context);
      await entered;
      releasePolicy();
      expect(await Promise.all([first, second])).toEqual([
        { ok: true, status: 201, body: { row: input } },
        { ok: true, status: 201, body: { row: input } },
      ]);
      expect(committedChanges).toBe(1);
      expect(db.get('notes', 'raced-row')).toEqual(input);
    } finally {
      unsubscribe();
      db.dispose();
    }
  });

  test('persists canonical receipts across a file database restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zero-resource-receipt-'));
    const path = join(directory, 'app.sqlite');
    const auth = applicationAuth('restart-user');
    const context = requestContext(auth, 'restart-create');
    const input = { id: 'restart-row', title: 'Original commit' };
    let first: ReactiveDB | null = null;
    let second: ReactiveDB | null = null;

    try {
      first = createReactiveDB({ mode: path, clearChangesOnStart: false });
      first.defineTable('notes', noteTables.notes);
      expect(await createGlobalService(first).create('notes', input, context))
        .toMatchObject({ ok: true, body: { row: input } });
      first.update('notes', 'restart-row', { title: 'Changed before restart' });
      first.dispose();
      first = null;

      second = createReactiveDB({ mode: path, clearChangesOnStart: false });
      second.defineTable('notes', noteTables.notes);
      expect(await createGlobalService(second).create('notes', input, context)).toEqual({
        ok: true,
        status: 201,
        body: { row: input },
      });
      expect(second.get('notes', 'restart-row')).toEqual({
        id: 'restart-row', title: 'Changed before restart',
      });
    } finally {
      first?.dispose();
      second?.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('namespaces the same visible key by shared-row tenant authority', async () => {
    const tables = {
      documents: {
        id: 'text primary key',
        tenant_id: 'text not null',
        title: 'text not null',
      },
    } satisfies Record<string, TableSchema>;
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('documents', tables.documents);
    db.exec('CREATE INDEX documents_tenant_id ON documents (tenant_id)');
    const registry = createResourceRegistry({
      resources: [defineResource({
        table: 'documents',
        exposure: 'http',
        realm: tenantRealm(),
        policy: authenticatedOnly(),
      })],
      tables,
      authConfig: { userProperties: {} },
      tenancyMode: 'multi',
      tenantIsolation: 'shared-row',
      managedTables: ['documents'],
    });
    const service = new ResourceCrudService({
      db,
      registry,
      tables,
      authConfig: { userProperties: {} },
    });

    try {
      expect(await service.create('documents', {
        id: 'tenant-a-row', title: 'Tenant A',
      }, requestContext(tenantAuth('tenant-a'), 'same-tenant-visible-key')))
        .toMatchObject({ ok: true });
      expect(await service.create('documents', {
        id: 'tenant-b-row', title: 'Tenant B',
      }, requestContext(tenantAuth('tenant-b'), 'same-tenant-visible-key')))
        .toMatchObject({ ok: true });
      expect(db.get('documents', 'tenant-a-row')).toMatchObject({ tenant_id: 'tenant-a' });
      expect(db.get('documents', 'tenant-b-row')).toMatchObject({ tenant_id: 'tenant-b' });
    } finally {
      db.dispose();
    }
  });

  test('compacts retained results into permanent no-reexecution tombstones', () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('notes', noteTables.notes);
    const store = new ResourceDefaultReceiptStore(db, { retainedResults: 2 });
    const first = receiptIdentity('a', '1');
    const second = receiptIdentity('b', '2');
    const third = receiptIdentity('c', '3');

    try {
      expect(store.execute(first, () => insertEffect(db, '1')).compaction).toBeNull();
      expect(store.execute(second, () => insertEffect(db, '2')).compaction).toBeNull();
      const compacted = store.execute(third, () => insertEffect(db, '3')).compaction;
      expect(compacted).toMatchObject({
        totalKeys: 3,
        retainedResults: 2,
        expiredTombstones: 1,
        keyLimit: 1_000_000,
        prunedCount: 1,
        prunedResultBytes: expect.any(Number),
        retainedLimit: 2,
        retainedByteLimit: 67_108_864,
        resultByteLimit: 4_194_304,
      });
      expect(typeof compacted?.retainedResultBytes).toBe('number');

      let executed = false;
      expect(() => store.execute(first, () => {
        executed = true;
        return insertEffect(db, 'must-not-run');
      })).toThrow(ResourceMutationReceiptError);
      expect(executed).toBe(false);
      try {
        store.find(first);
        throw new Error('Expected the compacted result to be expired');
      } catch (error) {
        expect(error).toBeInstanceOf(ResourceMutationReceiptError);
        expect((error as ResourceMutationReceiptError).kind).toBe('expired');
      }

      try {
        store.find({
          ...first,
          logicalFingerprint: `sha256:${'f'.repeat(64)}`,
        });
        throw new Error('Expected changed logical work to conflict');
      } catch (error) {
        expect(error).toBeInstanceOf(ResourceMutationReceiptError);
        expect((error as ResourceMutationReceiptError).kind).toBe('key-reused');
      }
    } finally {
      db.dispose();
    }
  });

  test('rejects unseen work before its callback at permanent-key capacity', () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('notes', noteTables.notes);
    const store = new ResourceDefaultReceiptStore(db, {
      permanentKeys: 2,
      retainedResults: 1,
    });
    const first = receiptIdentity('a', '1');
    const retained = receiptIdentity('b', '2');

    try {
      store.execute(first, () => insertEffect(db, '1'));
      store.execute(retained, () => insertEffect(db, '2'));

      let replayCallbackRan = false;
      expect(store.execute(retained, () => {
        replayCallbackRan = true;
        return insertEffect(db, 'replay-must-not-run');
      }).replayed).toBe(true);
      expect(replayCallbackRan).toBe(false);

      let expiredCallbackRan = false;
      expect(() => store.execute(first, () => {
        expiredCallbackRan = true;
        return insertEffect(db, 'expired-must-not-run');
      })).toThrow(expect.objectContaining({ kind: 'expired' }));
      expect(expiredCallbackRan).toBe(false);

      let unseenCallbackRan = false;
      expect(() => store.execute(receiptIdentity('c', 'capacity-row'), () => {
        unseenCallbackRan = true;
        return insertEffect(db, 'capacity-row');
      })).toThrow(expect.objectContaining({ kind: 'capacity' }));
      expect(unseenCallbackRan).toBe(false);
      expect(db.get('notes', 'capacity-row')).toBeNull();
    } finally {
      db.dispose();
    }
  });

  test('compacts oldest full results to satisfy the aggregate byte budget', () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('notes', noteTables.notes);
    const store = new ResourceDefaultReceiptStore(db, {
      permanentKeys: 10,
      retainedResults: 10,
      resultBytes: 512,
      retainedBytes: 512,
    });

    try {
      expect(store.execute(
        receiptIdentity('a', 'byte-a'),
        () => insertEffect(db, 'byte-a', 'a'.repeat(240)),
      ).compaction).toBeNull();
      const second = store.execute(
        receiptIdentity('b', 'byte-b'),
        () => insertEffect(db, 'byte-b', 'b'.repeat(240)),
      );
      const compaction = second.compaction;
      expect(compaction).not.toBeNull();
      expect(compaction).toMatchObject({
        totalKeys: 2,
        retainedResults: 1,
        expiredTombstones: 1,
        keyLimit: 10,
        prunedCount: 1,
        prunedResultBytes: expect.any(Number),
        retainedLimit: 10,
        retainedByteLimit: 512,
        resultByteLimit: 512,
      });
      expect(typeof compaction?.retainedResultBytes).toBe('number');
      expect(Number(compaction?.retainedResultBytes)).toBeLessThanOrEqual(512);
      expect(() => store.find(receiptIdentity('a', 'byte-a')))
        .toThrow(expect.objectContaining({ kind: 'expired' }));
    } finally {
      db.dispose();
    }
  });

  test('rolls back an application effect whose canonical result exceeds its byte cap', () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('notes', noteTables.notes);
    const store = new ResourceDefaultReceiptStore(db, {
      permanentKeys: 10,
      retainedResults: 10,
      resultBytes: 256,
      retainedBytes: 512,
    });
    let callbackRan = false;

    try {
      expect(() => store.execute(receiptIdentity('a', 'oversized'), () => {
        callbackRan = true;
        return insertEffect(db, 'oversized', 'private-value'.repeat(100));
      })).toThrow(expect.objectContaining({ kind: 'result-too-large' }));
      expect(callbackRan).toBe(true);
      expect(db.get('notes', 'oversized')).toBeNull();
      expect(db.prepare(`
        SELECT total_keys, retained_results, retained_result_bytes
        FROM _zero_resource_receipt_stats_v1
      `).get()).toEqual({
        total_keys: 0,
        retained_results: 0,
        retained_result_bytes: 0,
      });
    } finally {
      db.dispose();
    }
  });

  test('maps an oversized canonical update receipt to the tenant-plane 400 contract', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('notes', noteTables.notes);
    const service = createGlobalService(db);
    // The logical update input remains small enough to canonicalize, while
    // the exact preimage retained for replay pushes the durable result over
    // the 4 MiB receipt boundary.
    const originalTitle = 'a'.repeat(4_200_000);
    db.insert('notes', { id: 'oversized-update', title: originalTitle });

    try {
      expect(await service.update(
        'notes',
        'oversized-update',
        { title: 'updated' },
        requestContext(applicationAuth('user-a'), 'oversized-update-key'),
      )).toEqual({
        ok: false,
        status: 400,
        body: {
          error: 'Invalid resource input',
          code: 'invalid-resource-input',
        },
      });
      expect(db.get('notes', 'oversized-update')).toEqual({
        id: 'oversized-update',
        title: originalTitle,
      });
    } finally {
      db.dispose();
    }
  });

  test('preserves the 4 MiB contract for update receipts with two large rows', () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('notes', noteTables.notes);
    const store = new ResourceDefaultReceiptStore(db);
    const id = 'large-update';
    const before = { id, title: 'a'.repeat(800_000) };
    db.insert('notes', before);

    try {
      const execution = store.execute(
        receiptIdentity('a', id, 'update'),
        () => {
          const change = db.updateIfCurrent(
            'notes',
            id,
            { title: 'b'.repeat(800_000) },
            before,
          );
          if (!change) throw new Error('Expected large update row');
          return {
            type: 'update',
            table: 'notes',
            rowId: change.rowId,
            row: change.row,
            previousRow: change.previousRow ?? null,
            sequence: change.seq,
          };
        },
      );
      expect(execution.replayed).toBe(false);
      const stats = db.prepare(`
        SELECT retained_result_bytes
        FROM _zero_resource_receipt_stats_v1
      `).get() as { retained_result_bytes: number };
      expect(stats.retained_result_bytes).toBeGreaterThan(1_310_720);
      expect(stats.retained_result_bytes).toBeLessThanOrEqual(4_194_304);
    } finally {
      db.dispose();
    }
  });

  test('fails closed when private stats are corrupted across a restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zero-resource-receipt-stats-'));
    const path = join(directory, 'app.sqlite');
    let first: ReactiveDB | null = null;
    let second: ReactiveDB | null = null;

    try {
      first = createReactiveDB({ mode: path, clearChangesOnStart: false });
      first.defineTable('notes', noteTables.notes);
      new ResourceDefaultReceiptStore(first).execute(
        receiptIdentity('a', 'stats-row'),
        () => insertEffect(first!, 'stats-row'),
      );
      first.prepare(`
        UPDATE _zero_resource_receipt_stats_v1
        SET total_keys = total_keys + 1
      `).run();
      first.dispose();
      first = null;

      second = createReactiveDB({ mode: path, clearChangesOnStart: false });
      second.defineTable('notes', noteTables.notes);
      expect(() => new ResourceDefaultReceiptStore(second!).find(
        receiptIdentity('a', 'stats-row'),
      )).toThrow(expect.objectContaining({ kind: 'corrupt' }));
    } finally {
      first?.dispose();
      second?.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects altered private schema without exposing its SQL error', () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('notes', noteTables.notes);
    const store = new ResourceDefaultReceiptStore(db);
    const identity = receiptIdentity('a', 'schema-row');

    try {
      store.execute(identity, () => insertEffect(db, 'schema-row'));
      expect(() => db.prepare(`
        UPDATE _zero_resource_receipt_stats_v1
        SET total_keys = ?
      `).run(RESOURCE_DEFAULT_RECEIPT_MAX_KEYS + 1)).toThrow();
      db.exec('DROP TRIGGER _zero_resource_receipt_insert_guard_v1');
      try {
        store.find(identity);
        throw new Error('Expected private receipt schema validation to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(ResourceMutationReceiptError);
        expect((error as ResourceMutationReceiptError).kind).toBe('corrupt');
        expect((error as Error).message).toBe(
          'Resource idempotency receipt storage is incompatible',
        );
        expect((error as Error).message).not.toContain('TRIGGER');
      }
    } finally {
      db.dispose();
    }
  });

  test('maps receipt capacity to a safe non-retryable 503 and app-local event', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('notes', noteTables.notes);
    const events = new MemoryEventStore();
    const service = createGlobalService(db, runtimeFor(events));
    const auth = applicationAuth('private-principal');

    try {
      expect(await service.create(
        'notes',
        { id: 'first', title: 'First' },
        requestContext(auth, 'first-key'),
      )).toMatchObject({ ok: true });
      db.prepare(`
        UPDATE _zero_resource_receipt_stats_v1
        SET total_keys = ?
      `).run(RESOURCE_DEFAULT_RECEIPT_MAX_KEYS);

      expect(await service.create(
        'notes',
        { id: 'capacity', title: 'Must not commit' },
        requestContext(auth, 'private-visible-key'),
      )).toEqual({
        ok: false,
        status: 503,
        body: {
          error: 'Resource idempotency receipt capacity is exhausted',
          code: 'resource-idempotency-capacity-exhausted',
          retryable: false,
        },
      });
      expect(db.get('notes', 'capacity')).toBeNull();
      const event = events.query({
        code: 'resource.receipt.capacity_exhausted',
      }).events[0];
      expect(event?.error).toBeUndefined();
      expect(event?.metadata).toEqual({
        resource: 'notes',
        table: 'notes',
        action: 'create',
        databasePlane: 'default',
        permanentKeyLimit: RESOURCE_DEFAULT_RECEIPT_MAX_KEYS,
      });
      expect(JSON.stringify(event)).not.toContain('private-principal');
      expect(JSON.stringify(event)).not.toContain('private-visible-key');
    } finally {
      db.dispose();
    }
  });
});

function createGlobalService(
  db: ReactiveDB,
  observability?: PlatformObservabilityRuntime,
): ResourceCrudService {
  const registry = createResourceRegistry({
    resources: [defineResource({
      table: 'notes',
      exposure: 'http',
      realm: globalRealm(),
      policy: authenticatedOnly(),
    })],
    tables: noteTables,
    authConfig: { userProperties: {} },
    observability,
    tenancyMode: 'single',
    managedTables: ['notes'],
  });
  return new ResourceCrudService({
    db,
    registry,
    tables: noteTables,
    authConfig: { userProperties: {} },
    observability,
  });
}

function requestContext(
  authContext: AuthContext,
  idempotencyKey: string,
): ResourceCrudRequestContext {
  return { authContext, idempotencyKey };
}

function applicationAuth(userId: string): AuthContext {
  return {
    userId,
    email: `${userId}@example.test`,
    role: 'user',
    sessionKind: 'web',
    sessionId: `session-${userId}`,
    sessionGeneration: 0,
    sessionScopeKind: 'application',
    sessionScopeId: 'application',
  };
}

function tenantAuth(tenantId: string): AuthContext {
  return {
    userId: 'shared-user',
    email: 'shared-user@example.test',
    role: 'user',
    sessionKind: 'web',
    sessionId: `session-${tenantId}`,
    sessionGeneration: 0,
    sessionScopeKind: 'tenant',
    sessionScopeId: tenantId,
    tenantId,
    membershipId: `membership-${tenantId}`,
    tenantRole: 'member',
    tenantAuthorizationGeneration: 0,
    membershipAuthorizationGeneration: 0,
  };
}

function receiptIdentity(
  seed: string,
  id: string,
  action: ResourceMutationReceiptIdentity['action'] = 'create',
): ResourceMutationReceiptIdentity {
  return {
    receiptKey: `resource:v3:${seed.repeat(64)}`,
    logicalFingerprint: `sha256:${seed.repeat(64)}`,
    resource: 'notes',
    table: 'notes',
    action,
    id,
  };
}

function insertEffect(
  db: ReactiveDB,
  id: string,
  title = `Title ${id}`,
): ResourceMutationReceiptEffect {
  const change = db.createStrict('notes', { id, title });
  return {
    type: 'create',
    table: 'notes',
    rowId: change.rowId,
    row: change.row,
    previousRow: change.previousRow ?? null,
    sequence: change.seq,
  };
}

function runtimeFor(store: MemoryEventStore): PlatformObservabilityRuntime {
  return {
    sink: store,
    store,
    config: { console: false, store },
  };
}
