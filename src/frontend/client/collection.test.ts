/**
 * collection.test.ts
 *
 * Verifies client collection behavior using a fake SyncClient. WebSocket
 * transport and reconnect behavior remain covered by sync-client tests.
 */

import { describe, expect, test } from 'bun:test';
import { createIdentityId } from '../../sync/identity';
import { createSyncStore } from '../../sync/client/sync-store';
import type { SyncClient } from '../../sync/client/sync-client';
import type { ClientTableDef, Row } from '../../sync/types';
import { defineTable, field } from '../../schema';
import type { InferRow, InsertInput } from '../../schema';
import { createCollection } from './collection';

const membershipTable: ClientTableDef = {
  _pk: 'membership_id',
  _identity: ['team_id', 'user_id'],
  membership_id: 'text',
  team_id: 'text',
  user_id: 'text',
  role: 'text',
};

interface SyncCall {
  op: 'insert' | 'update' | 'delete';
  table: string;
  row?: Row;
  rowId?: string;
  partial?: Partial<Row>;
}

function createFakeSyncClient(
  tableName = 'memberships',
  tableDef: ClientTableDef = membershipTable,
) {
  const { store, tables } = createSyncStore({ [tableName]: tableDef });
  const calls: SyncCall[] = [];

  const client: SyncClient = {
    store,
    tables,
    get connected() {
      return false;
    },
    insert(table: string, row: Row): void {
      calls.push({ op: 'insert', table, row });
      store.send({
        type: 'optimistic.insert' as const,
        table,
        rowId: String(row[tableDef._pk]),
        row,
        ref: `ref-${calls.length}`,
      });
    },
    async insertAsync(table: string, row: Row): Promise<void> {
      client.insert(table, row);
    },
    update(table: string, rowId: string, partial: Partial<Row>): void {
      calls.push({ op: 'update', table, rowId, partial });
      store.send({
        type: 'optimistic.update' as const,
        table,
        rowId,
        partial,
        ref: `ref-${calls.length}`,
      });
    },
    async updateAsync(
      table: string,
      rowId: string,
      partial: Partial<Row>,
    ): Promise<void> {
      client.update(table, rowId, partial);
    },
    delete(table: string, rowId: string): void {
      calls.push({ op: 'delete', table, rowId });
      store.send({
        type: 'optimistic.delete' as const,
        table,
        rowId,
        ref: `ref-${calls.length}`,
      });
    },
    async deleteAsync(table: string, rowId: string): Promise<void> {
      client.delete(table, rowId);
    },
    sendRaw(): void {},
    connect(): void {},
    reconnect(): void {},
    reset(): void {
      store.send({ type: 'sync.reset' });
    },
    beginAuthorizationScopeTransition(): void {
      store.send({ type: 'sync.reset' });
    },
    completeAuthorizationScopeTransition(): void {},
    waitForAuthorizationBaseline(): Promise<void> {
      return Promise.resolve();
    },
    onMessage(): () => void {
      return () => {};
    },
    onMutationRejected(): () => void {
      return () => {};
    },
    disconnect(): void {},
  };

  return { client, calls };
}

describe('createCollection schema contracts', () => {
  test('exposes the declared primary-key metadata without assuming id', () => {
    const { client } = createFakeSyncClient();
    const collection = createCollection('memberships', client, membershipTable);
    expect(collection.primaryKey).toBe('membership_id');
  });
  test('generates an omitted custom primary key and keeps booleans logical at the API boundary', () => {
    const toggles = defineTable('toggles', {
      label: field.text({ required: true }),
      enabled: field.boolean({ required: true }),
    }, { pk: 'toggle_id' });
    type Toggle = InferRow<typeof toggles>;

    const { client, calls } = createFakeSyncClient('toggles', toggles.clientTable);
    const collection = createCollection<Toggle>('toggles', client, toggles.clientTable);
    const input: InsertInput<Toggle> = { label: 'Notifications', enabled: true };

    collection.insert(input);

    const inserted = calls[0]?.row;
    const id = String(inserted?.toggle_id);
    expect(id.length).toBeGreaterThan(0);
    expect(inserted).toMatchObject({
      label: 'Notifications',
      enabled: 1,
    });
    expect(collection.getOne(id)).toMatchObject({
      toggle_id: id,
      label: 'Notifications',
      enabled: true,
    });

    collection.update(id, { enabled: false });
    expect(calls[1]?.partial).toEqual({ enabled: 0 });
    expect(collection.getOne(id)?.enabled).toBe(false);
  });

  test('decodes SQLite boolean values loaded through a lazy collection', () => {
    const flags = defineTable('flags', {
      enabled: field.boolean({ required: true }),
    });
    type Flag = InferRow<typeof flags>;
    const { client } = createFakeSyncClient('flags', flags.clientTable);
    const collection = createCollection<Flag>('flags', client, flags.clientTable);

    collection.load([
      { id: 'flag-1', enabled: 1 } as unknown as InsertInput<Flag>,
      { id: 'flag-2', enabled: 0 } as unknown as InsertInput<Flag>,
    ]);

    expect(collection.getOne('flag-1')?.enabled).toBe(true);
    expect(collection.getOne('flag-2')?.enabled).toBe(false);
  });

  test('exposes acknowledged insert, update, and remove without changing logical encoding', async () => {
    const toggles = defineTable('toggles', {
      label: field.text({ required: true }),
      enabled: field.boolean({ required: true }),
    }, { pk: 'toggle_id' });
    type Toggle = InferRow<typeof toggles>;
    const { client, calls } = createFakeSyncClient('toggles', toggles.clientTable);
    const collection = createCollection<Toggle>('toggles', client, toggles.clientTable);

    await collection.insertAsync({
      toggle_id: 'toggle-1', label: 'Email', enabled: true,
    });
    await collection.updateAsync('toggle-1', { enabled: false });
    await collection.removeAsync('toggle-1');

    expect(calls).toEqual([
      {
        op: 'insert', table: 'toggles',
        row: { toggle_id: 'toggle-1', label: 'Email', enabled: 1 },
      },
      {
        op: 'update', table: 'toggles', rowId: 'toggle-1',
        partial: { enabled: 0 },
      },
      { op: 'delete', table: 'toggles', rowId: 'toggle-1' },
    ]);
  });

  test('derives natural-identity keys from logical booleans before storage encoding', () => {
    const preferences = defineTable('preferences', {
      scope: field.text({ required: true }),
      enabled: field.boolean({ required: true }),
    }, {
      pk: 'preference_id',
      identity: ['scope', 'enabled'],
    });
    type Preference = InferRow<typeof preferences>;
    const { client, calls } = createFakeSyncClient('preferences', preferences.clientTable);
    const collection = createCollection<Preference>(
      'preferences',
      client,
      preferences.clientTable,
    );
    const expectedId = createIdentityId('preferences', ['scope', 'enabled'], {
      scope: 'notifications',
      enabled: true,
    });

    collection.insert({ scope: 'notifications', enabled: true });

    expect(calls[0]?.row).toMatchObject({
      preference_id: expectedId,
      scope: 'notifications',
      enabled: 1,
    });
    expect(collection.getByIdentity({ scope: 'notifications', enabled: true })?.enabled).toBe(true);
  });
});

describe('createCollection natural identity behavior', () => {
  test('insert generates the deterministic natural-identity primary key', () => {
    const { client, calls } = createFakeSyncClient();
    const collection = createCollection('memberships', client, membershipTable);
    const id = createIdentityId('memberships', ['team_id', 'user_id'], {
      team_id: 'team-1',
      user_id: 'user-1',
    });

    collection.insert({
      team_id: 'team-1',
      user_id: 'user-1',
      role: 'admin',
    });

    expect(calls[0]).toMatchObject({
      op: 'insert',
      table: 'memberships',
      row: {
        membership_id: id,
        team_id: 'team-1',
        user_id: 'user-1',
        role: 'admin',
      },
    });
    expect(collection.getOne(id)?.role).toBe('admin');
  });

  test('load keys identity rows and supports lookup by natural identity', () => {
    const { client } = createFakeSyncClient();
    const collection = createCollection('memberships', client, membershipTable);
    const id = createIdentityId('memberships', ['team_id', 'user_id'], {
      team_id: 'team-1',
      user_id: 'user-1',
    });

    collection.load([{
      team_id: 'team-1',
      user_id: 'user-1',
      role: 'member',
    }]);

    expect(collection.getOne(id)?.role).toBe('member');
    expect(collection.getByIdentity({
      team_id: 'team-1',
      user_id: 'user-1',
    })?.role).toBe('member');
  });

  test('upsertByIdentity updates an already loaded legacy sync id', () => {
    const { client, calls } = createFakeSyncClient();
    const collection = createCollection('memberships', client, membershipTable);
    collection.load([{
      membership_id: 'legacy-id',
      team_id: 'team-1',
      user_id: 'user-1',
      role: 'member',
    }]);

    collection.upsertByIdentity({
      team_id: 'team-1',
      user_id: 'user-1',
      role: 'admin',
    });

    expect(calls[0]).toMatchObject({
      op: 'update',
      table: 'memberships',
      rowId: 'legacy-id',
      partial: {
        team_id: 'team-1',
        user_id: 'user-1',
        role: 'admin',
      },
    });
    expect(collection.getOne('legacy-id')?.role).toBe('admin');
  });

  test('updateByIdentity and deleteByIdentity target loaded legacy sync ids', () => {
    const { client, calls } = createFakeSyncClient();
    const collection = createCollection('memberships', client, membershipTable);
    collection.load([{
      membership_id: 'legacy-id',
      team_id: 'team-1',
      user_id: 'user-1',
      role: 'member',
    }]);

    collection.updateByIdentity({
      team_id: 'team-1',
      user_id: 'user-1',
    }, {
      role: 'owner',
    });
    collection.deleteByIdentity({
      team_id: 'team-1',
      user_id: 'user-1',
    });

    expect(calls[0]).toMatchObject({ op: 'update', rowId: 'legacy-id' });
    expect(calls[1]).toMatchObject({ op: 'delete', rowId: 'legacy-id' });
  });

  test('updateByIdentity rejects identity field changes', () => {
    const { client } = createFakeSyncClient();
    const collection = createCollection('memberships', client, membershipTable);

    expect(() => collection.updateByIdentity({
      team_id: 'team-1',
      user_id: 'user-1',
    }, {
      user_id: 'user-2',
    })).toThrow('Cannot change identity field "user_id"');
  });
});
