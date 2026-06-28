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

function createFakeSyncClient() {
  const { store, tables } = createSyncStore({ memberships: membershipTable });
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
        rowId: String(row[membershipTable._pk]),
        row,
        ref: `ref-${calls.length}`,
      });
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
    delete(table: string, rowId: string): void {
      calls.push({ op: 'delete', table, rowId });
      store.send({
        type: 'optimistic.delete' as const,
        table,
        rowId,
        ref: `ref-${calls.length}`,
      });
    },
    sendRaw(): void {},
    connect(): void {},
    reconnect(): void {},
    reset(): void {
      store.send({ type: 'sync.reset' });
    },
    onMessage(): () => void {
      return () => {};
    },
    disconnect(): void {},
  };

  return { client, calls };
}

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
