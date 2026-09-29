import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import type { ServerWebSocket } from 'bun';

import { createDataQueryPlugin } from '../sync/data-query.plugin';
import { createReactiveDB } from '../sync/reactive-db';
import { deliverSyncChange } from '../sync/sync-change-delivery';
import { handleSyncSubscribe } from '../sync/sync-subscribe-handler';
import type { ServerMessage, SyncSocketData, TableSchema } from '../sync/types';
import { ResourceCrudService } from './resource-crud-service';
import { defineResource, globalRealm } from './resource-definition';
import { defineResourceFields } from './resource-field-access';
import { customPolicy } from './resource-policy-helpers';
import { createResourceRegistry } from './resource-registry';
import { ResourceSyncPolicyService } from './resource-sync-policy';

const table: TableSchema = {
  id: 'text primary key',
  title: 'text not null',
  owner_id: 'text not null',
  secret: 'text not null',
};

const fields = defineResourceFields({
  read: ['id', 'title'],
  create: ['title'],
  update: ['title'],
  filter: ['id', 'title'],
  sort: ['title'],
});

const policy = customPolicy(({ action }) => action === 'create'
  ? {
      allowed: true,
      stampedInput: {
        owner_id: 'server-owner',
        secret: 'server-secret',
      },
    }
  : true, { name: 'field-access-integration' });

function setup() {
  const tables = { documents: table };
  const registry = createResourceRegistry({
    resources: [defineResource({
      table: 'documents',
      exposure: 'all',
      realm: globalRealm(),
      fields,
      policy,
    })],
    tables,
    authConfig: { userProperties: {} },
  });
  const db = createReactiveDB({ mode: 'memory' });
  db.defineTable('documents', table);
  db.insert('documents', {
    id: 'doc-1',
    title: 'Visible title',
    owner_id: 'owner-1',
    secret: 'classified',
  });
  return { db, registry, tables };
}

describe('resource field access across managed transports', () => {
  test('projects CRUD responses and rejects filter, sort, and write side channels', async () => {
    const runtime = setup();
    try {
      const service = new ResourceCrudService({
        db: runtime.db,
        registry: runtime.registry,
        tables: runtime.tables,
        authConfig: { userProperties: {} },
      });

      const list = await service.list('documents', { order: 'title' });
      expect(list).toMatchObject({
        ok: true,
        body: { rows: [{ id: 'doc-1', title: 'Visible title' }] },
      });

      const hiddenFilter = await service.list('documents', {
        filter: 'secret:eq:classified',
      });
      expect(hiddenFilter).toMatchObject({ ok: false, status: 400 });

      const hiddenSort = await service.list('documents', { order: 'owner_id' });
      expect(hiddenSort).toMatchObject({ ok: false, status: 400 });

      const get = await service.get('documents', 'doc-1');
      expect(get).toMatchObject({
        ok: true,
        body: { row: { id: 'doc-1', title: 'Visible title' } },
      });

      const deniedCreate = await service.create('documents', {
        id: 'doc-denied',
        title: 'Denied',
        secret: 'client-secret',
      });
      expect(deniedCreate).toMatchObject({
        ok: false,
        status: 400,
        body: { code: 'resource-field-not-writable' },
      });

      const created = await service.create('documents', {
        id: 'doc-2',
        title: 'Created',
      });
      expect(created).toMatchObject({
        ok: true,
        status: 201,
        body: { row: { id: 'doc-2', title: 'Created' } },
      });
      expect(runtime.db.get('documents', 'doc-2')).toEqual({
        id: 'doc-2',
        title: 'Created',
        owner_id: 'server-owner',
        secret: 'server-secret',
      });

      const deniedUpdate = await service.update('documents', 'doc-2', {
        owner_id: 'different-owner',
      });
      expect(deniedUpdate).toMatchObject({
        ok: false,
        status: 400,
        body: { code: 'resource-field-not-writable' },
      });

      const updated = await service.update('documents', 'doc-2', {
        title: 'Updated',
      });
      expect(updated).toMatchObject({
        ok: true,
        body: { row: { id: 'doc-2', title: 'Updated' } },
      });
    } finally {
      runtime.db.dispose();
    }
  });

  test('/api/data returns only readable fields and cannot filter or sort hidden fields', async () => {
    const runtime = setup();
    const app = new Elysia().use(createDataQueryPlugin({
      queryableTables: new Set(['documents']),
      tableColumns: new Map([['documents', ['id', 'title', 'owner_id', 'secret']]]),
      resourceRegistry: runtime.registry,
      resourceAuthConfig: { userProperties: {} },
      getDB: () => runtime.db,
    }));
    try {
      const response = await app.handle(new Request(
        'http://zero.test/api/data?table=documents&order=title&dir=asc',
      ));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        rows: [{ id: 'doc-1', title: 'Visible title' }],
      });

      const filter = await app.handle(new Request(
        'http://zero.test/api/data?table=documents&filter=secret:eq:classified',
      ));
      expect(filter.status).toBe(400);

      const sort = await app.handle(new Request(
        'http://zero.test/api/data?table=documents&order=secret',
      ));
      expect(sort.status).toBe(400);
    } finally {
      runtime.db.dispose();
    }
  });

  test('projects Sync snapshot, catch-up, live, and mutation boundaries', async () => {
    const runtime = setup();
    try {
      const service = new ResourceSyncPolicyService({
        registry: runtime.registry,
        authConfig: { userProperties: {} },
      });
      expect(service.classifyManagedTableDataPlane('documents')).toBe('default');
      const access = await service.resolveTableAccess({
        tableNames: ['documents'],
        authContext: null,
      });
      expect(access.readableTables.has('documents')).toBe(true);
      expect(access.rowProjectors?.get('documents')?.project(
        runtime.db.get('documents', 'doc-1')!,
      )).toEqual({ id: 'doc-1', title: 'Visible title' });

      const snapshotSocket = createSocket(access.rowProjectors);
      await handleSyncSubscribe(snapshotSocket.value, {
        type: 'sync.subscribe',
        tables: ['documents'],
        snapshot: ['documents'],
        lastSeq: 0,
        epoch: 'previous-process',
        scope: 'scope',
      }, runtime.db);
      expect(snapshotSocket.messages[0]).toMatchObject({
        type: 'sync.snapshot',
        tables: {
          documents: {
            'doc-1': { id: 'doc-1', title: 'Visible title' },
          },
        },
      });

      const priorSeq = runtime.db.currentSeq;
      const change = runtime.db.update('documents', 'doc-1', {
        title: 'Changed',
        secret: 'new-classified',
      })!;
      const catchupSocket = createSocket(access.rowProjectors);
      await handleSyncSubscribe(catchupSocket.value, {
        type: 'sync.subscribe',
        tables: ['documents'],
        lastSeq: priorSeq,
        epoch: runtime.db.syncEpoch,
        scope: 'scope',
      }, runtime.db);
      expect(catchupSocket.messages[0]).toMatchObject({
        type: 'sync.catchup',
        changes: [{
          row: { id: 'doc-1', title: 'Changed' },
        }],
      });

      const liveSocket = createSocket(access.rowProjectors);
      liveSocket.data.syncSubscribedTables.add('documents');
      deliverSyncChange([liveSocket.value], change, runtime.db.syncEpoch, 'test');
      expect(liveSocket.messages[0]).toMatchObject({
        type: 'sync.change',
        row: { id: 'doc-1', title: 'Changed' },
      });

      const deniedCreate = await service.authorizeMutation({
        table: 'documents',
        op: 'INSERT',
        row: { id: 'sync-denied', title: 'Denied', secret: 'client-secret' },
        authContext: null,
        loadRow: () => null,
      });
      expect(deniedCreate).toMatchObject({
        ok: false,
        code: 'resource-field-not-writable',
      });

      const allowedCreate = await service.authorizeMutation({
        table: 'documents',
        op: 'INSERT',
        row: { id: 'sync-created', title: 'Allowed' },
        authContext: null,
        loadRow: () => null,
      });
      expect(allowedCreate).toMatchObject({
        ok: true,
        row: {
          id: 'sync-created',
          title: 'Allowed',
          owner_id: 'server-owner',
          secret: 'server-secret',
        },
      });

      const deniedUpdate = await service.authorizeMutation({
        table: 'documents',
        op: 'UPDATE',
        rowId: 'doc-1',
        row: { secret: 'client-secret' },
        authContext: null,
        loadRow: async (tableName, rowId) => runtime.db.get(tableName, rowId),
      });
      expect(deniedUpdate).toMatchObject({
        ok: false,
        code: 'resource-field-not-writable',
      });
    } finally {
      runtime.db.dispose();
    }
  });
});

function createSocket(
  projectors: SyncSocketData['resourceRowProjectors'],
) {
  const messages: ServerMessage[] = [];
  const data: SyncSocketData = {
    allowedTables: new Set(['documents']),
    subscribedTopics: new Set(),
    lastSeq: 0,
    syncSubscribedTables: new Set(),
    syncBackpressured: false,
    authContext: null,
    authResolved: true,
    authorizationFingerprint: 'field-policy',
    authorizationScope: 'scope',
    connectionId: 'field-policy-test',
    query: {},
    stateSubscribed: false,
    ephemeralTopics: new Set(),
    resourceRowFilters: new Map(),
    resourceRowProjectors: projectors,
    rowFilteredSubscribedTables: new Set(),
  };
  const value = {
    data,
    send(payload: string) {
      messages.push(JSON.parse(payload));
      return payload.length;
    },
    close() {},
    subscribe() {},
    unsubscribe() {},
  } as unknown as ServerWebSocket<SyncSocketData>;
  return { value, data, messages };
}
