import { afterEach, describe, expect, test } from 'bun:test';
import { createReactiveDB, type ReactiveDB } from '../../sync/reactive-db';
import type {
  SyncHistoryGap,
  SyncResourcePolicyAdapter,
  SyncResourceTableAccessContext,
} from '../../sync/types';
import { PlatformSyncPolicyService } from './platform-sync-policy';

const GAP: SyncHistoryGap = {
  kind: 'retention',
  afterSeq: 0,
  oldestSeq: 2,
  currentSeq: 3,
};

const CONTEXT: SyncResourceTableAccessContext = {
  tableNames: ['rooms'],
  authContext: {
    userId: 'user-1',
    email: 'user-1@example.test',
    role: 'user',
  },
};

let db: ReactiveDB | null = null;

afterEach(() => {
  db?.dispose();
  db = null;
});

describe('PlatformSyncPolicyService history-gap reset', () => {
  test('rejects an asynchronous delegated observer before its result can be hidden', () => {
    db = createPolicyDatabase();
    const delegate = allowAllPolicy();
    delegate.observeChange = (async () => {}) as typeof delegate.observeChange;
    const policy = new PlatformSyncPolicyService({ delegate, getDB: () => db });

    expect(() => policy.observeChange({
      seq: 1,
      table: 'rooms',
      op: 'INSERT',
      rowId: 'room-1',
      row: { room_id: 'room-1' },
      previousRow: null,
      ts: Date.now(),
    })).toThrow('ZERO_SYNC_POLICY_OBSERVER_ASYNC');
  });

  test('preserves the delegated observer method receiver', () => {
    db = createPolicyDatabase();
    const delegate = allowAllPolicy() as SyncResourcePolicyAdapter & { observations: number };
    delegate.observations = 0;
    delegate.observeChange = function observeChange() {
      this.observations += 1;
    };
    const policy = new PlatformSyncPolicyService({ delegate, getDB: () => db });

    policy.observeChange({
      seq: 1,
      table: 'rooms',
      op: 'INSERT',
      rowId: 'room-1',
      row: { room_id: 'room-1' },
      previousRow: null,
      ts: Date.now(),
    });

    expect(delegate.observations).toBe(1);
  });

  test('refreshes an existing room-membership filter after skipped history', async () => {
    db = createPolicyDatabase();
    db.insert('rooms', {
      room_id: 'room-1',
      created_by: 'user-2',
      tenant_id: null,
    });
    db.insert('room_members', {
      member_id: 'member-1',
      room_id: 'room-1',
      user_id: 'user-1',
      tenant_id: null,
    });
    const policy = new PlatformSyncPolicyService({
      delegate: allowAllPolicy(),
      getDB: () => db,
    });
    const before = await policy.resolveTableAccess(CONTEXT);
    const filter = before.rowFilters.get('rooms');
    const room = db.get('rooms', 'room-1');
    if (!filter || !room) throw new Error('Expected room policy fixture');

    expect(filter.matches(room)).toBe(true);
    // Model a skipped remote change: SQLite is authoritative, while the
    // process-local observeChange-derived revision did not see this DELETE.
    db.getRawDatabase().run(
      "DELETE FROM main.room_members WHERE member_id = 'member-1'",
    );
    expect(filter.matches(room)).toBe(true);

    policy.onHistoryGap(GAP);

    expect(filter.matches(room)).toBe(false);
    const after = await policy.resolveTableAccess(CONTEXT);
    expect(after.policyFingerprint).not.toBe(before.policyFingerprint);
  });

  test('rejects a stateful delegate that cannot reset after skipped history', () => {
    db = createPolicyDatabase();
    const delegate = allowAllPolicy();
    delegate.observeChange = () => {};
    const policy = new PlatformSyncPolicyService({ delegate, getDB: () => db });

    expect(() => policy.onHistoryGap(GAP)).toThrow(
      'ZERO_SYNC_POLICY_HISTORY_GAP_UNHANDLED',
    );
  });

  test('rejects an asynchronous delegated reset before reconnect can proceed', () => {
    db = createPolicyDatabase();
    const delegate = allowAllPolicy();
    delegate.observeChange = () => {};
    delegate.onHistoryGap = (async () => {}) as typeof delegate.onHistoryGap;
    const policy = new PlatformSyncPolicyService({ delegate, getDB: () => db });

    expect(() => policy.onHistoryGap(GAP)).toThrow(
      'ZERO_SYNC_POLICY_HISTORY_GAP_ASYNC',
    );
  });

  test('preserves the delegated method receiver while resetting policy state', () => {
    db = createPolicyDatabase();
    const delegate = allowAllPolicy() as SyncResourcePolicyAdapter & { resets: number };
    delegate.resets = 0;
    delegate.observeChange = function observeChange() {
      void this.resets;
    };
    delegate.onHistoryGap = function onHistoryGap() {
      this.resets += 1;
    };
    const policy = new PlatformSyncPolicyService({ delegate, getDB: () => db });

    policy.onHistoryGap(GAP);

    expect(delegate.resets).toBe(1);
  });
});

function createPolicyDatabase(): ReactiveDB {
  const reactive = createReactiveDB({ mode: 'memory' });
  reactive.defineTable('rooms', {
    room_id: 'text primary key',
    created_by: 'text not null',
    tenant_id: 'text',
  });
  reactive.defineTable('room_members', {
    member_id: 'text primary key',
    room_id: 'text not null',
    user_id: 'text not null',
    tenant_id: 'text',
  });
  return reactive;
}

function allowAllPolicy(): SyncResourcePolicyAdapter {
  return {
    async resolveTableAccess(context) {
      return {
        readableTables: new Set(context.tableNames),
        rowFilters: new Map(),
        policyFingerprint: 'allow-all',
      };
    },
    async authorizeMutation() {
      return { ok: true };
    },
  };
}
