import { afterEach, describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import { createReactiveDB, type ReactiveDB } from '../../sync/reactive-db';
import { deliverSyncChange } from '../../sync/sync-change-delivery';
import { handleSyncSubscribe } from '../../sync/sync-subscribe-handler';
import { clearSyncBackpressure } from '../../sync/sync-wire-send';
import type {
  ServerMessage,
  SyncHistoryGap,
  SyncResourcePolicyAdapter,
  SyncResourceTableAccessContext,
  SyncSocketData,
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
  test('preserves delegated realm, exposure, and physical data-plane proofs', () => {
    const delegate = allowAllPolicy();
    delegate.classifyManagedTableRealm = (table) => table === 'documents'
      ? 'tenant'
      : null;
    delegate.classifyManagedTableExposure = (table) => table === 'documents'
      ? 'all'
      : null;
    delegate.classifyManagedTableDataPlane = (table) => table === 'documents'
      ? 'tenant'
      : null;
    const policy = new PlatformSyncPolicyService({ delegate, getDB: () => null });

    expect(policy.classifyManagedTableRealm('documents')).toBe('tenant');
    expect(policy.classifyManagedTableExposure('documents')).toBe('all');
    expect(policy.classifyManagedTableDataPlane('documents')).toBe('tenant');
    expect(policy.classifyManagedTableDataPlane('unknown')).toBeNull();
  });

  test('preserves delegated comparable read authority and validator receiver', async () => {
    const delegate = allowAllPolicy() as SyncResourcePolicyAdapter & {
      revision: string;
    };
    delegate.revision = 'revision-1';
    delegate.resolveTableAccess = async function resolveTableAccess(context) {
      return {
        readableTables: new Set(context.tableNames),
        rowFilters: new Map(),
        policyFingerprint: 'allow-all',
        readAuthorityFingerprint: this.revision,
      };
    };
    delegate.validateReadAuthorityAtDelivery = function validate(_context, expected) {
      return this.revision === expected;
    };
    const policy = new PlatformSyncPolicyService({ delegate, getDB: () => null });
    const access = await policy.resolveTableAccess({
      tableNames: ['documents'],
      authContext: CONTEXT.authContext,
    });

    expect(access.readAuthorityFingerprint).toBe('revision-1');
    expect(policy.validateReadAuthorityAtDelivery(
      CONTEXT.authContext,
      'revision-1',
    )).toBeTrue();
    delegate.revision = 'revision-2';
    expect(policy.validateReadAuthorityAtDelivery(
      CONTEXT.authContext,
      'revision-1',
    )).toBeFalse();
  });

  test('invalidates comparable delivery authority when room membership changes', async () => {
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
      delegate: comparableAllowAllPolicy(),
      getDB: () => db,
    });
    const access = await policy.resolveTableAccess(CONTEXT);
    const fingerprint = access.readAuthorityFingerprint;
    if (!fingerprint) throw new Error('Expected comparable room authority');

    expect(policy.validateReadAuthorityAtDelivery(
      CONTEXT.authContext,
      fingerprint,
    )).toBeTrue();
    const change = db.delete('room_members', 'member-1');
    if (!change) throw new Error('Expected membership deletion');
    policy.observeChange(change);
    expect(policy.validateReadAuthorityAtDelivery(
      CONTEXT.authContext,
      fingerprint,
    )).toBeFalse();
  });

  test('stops a backpressured room snapshot after membership is revoked', async () => {
    db = createPolicyDatabase();
    for (const suffix of ['1', '2']) {
      db.insert('rooms', {
        room_id: `room-${suffix}`,
        created_by: `user-2-${'x'.repeat(600_000)}`,
        tenant_id: null,
      });
      db.insert('room_members', {
        member_id: `member-${suffix}`,
        room_id: `room-${suffix}`,
        user_id: 'user-1',
        tenant_id: null,
      });
    }
    const policy = new PlatformSyncPolicyService({
      delegate: comparableAllowAllPolicy(),
      getDB: () => db,
    });
    const access = await policy.resolveTableAccess(CONTEXT);
    const fingerprint = access.readAuthorityFingerprint;
    if (!fingerprint) throw new Error('Expected comparable room authority');
    const target = platformSocket([-1]);
    installAccess(target.data, access);
    const assertAuthority = () => {
      if (!policy.validateReadAuthorityAtDelivery(CONTEXT.authContext, fingerprint)) {
        throw new Error('read authority changed');
      }
    };

    const pending = handleSyncSubscribe(target.value, {
      type: 'sync.subscribe',
      tables: ['rooms'],
      snapshot: ['rooms'],
      lastSeq: 0,
      epoch: 'force-snapshot',
      scope: 'scope-a',
    }, db, undefined, undefined, assertAuthority);
    await Promise.resolve();
    await Promise.resolve();
    expect(target.messages.map((message) => message.type)).toEqual([
      'sync.snapshot.begin',
    ]);

    const change = db.delete('room_members', 'member-1');
    if (!change) throw new Error('Expected membership deletion');
    policy.observeChange(change);
    clearSyncBackpressure(target.value);

    await expect(pending).rejects.toThrow('read authority changed');
    expect(target.messages.map((message) => message.type)).toEqual([
      'sync.snapshot.begin',
    ]);
    expect(target.data.lastSeq).toBe(0);
  });

  test('does not flush a room change queued before membership revocation', async () => {
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
      delegate: comparableAllowAllPolicy(),
      getDB: () => db,
    });
    const access = await policy.resolveTableAccess(CONTEXT);
    const fingerprint = access.readAuthorityFingerprint;
    if (!fingerprint) throw new Error('Expected comparable room authority');
    const target = platformSocket([-1]);
    installAccess(target.data, access);
    const isCurrent = () => policy.validateReadAuthorityAtDelivery(
      CONTEXT.authContext,
      fingerprint,
    );
    const assertAuthority = () => {
      if (!isCurrent()) throw new Error('read authority changed');
    };

    const pending = handleSyncSubscribe(target.value, {
      type: 'sync.subscribe',
      tables: ['rooms'],
      snapshot: ['rooms'],
      lastSeq: 0,
      epoch: 'force-snapshot',
      scope: 'scope-a',
    }, db, undefined, undefined, assertAuthority);
    await Promise.resolve();
    await Promise.resolve();
    expect(target.messages.map((message) => message.type)).toEqual(['sync.snapshot']);

    const roomChange = db.update('rooms', 'room-1', { created_by: 'user-3' });
    if (!roomChange) throw new Error('Expected room update');
    policy.observeChange(roomChange);
    deliverSyncChange(
      [target.value],
      roomChange,
      db.syncEpoch,
      'other-connection',
      () => isCurrent(),
    );
    const membershipChange = db.delete('room_members', 'member-1');
    if (!membershipChange) throw new Error('Expected membership deletion');
    policy.observeChange(membershipChange);
    clearSyncBackpressure(target.value);

    await expect(pending).rejects.toThrow('read authority changed');
    expect(target.messages.map((message) => message.type)).toEqual(['sync.snapshot']);
    expect(target.data.lastSeq).toBe(2);
  });

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

function comparableAllowAllPolicy(): SyncResourcePolicyAdapter {
  const delegate = allowAllPolicy();
  delegate.resolveTableAccess = async (context) => ({
    readableTables: new Set(context.tableNames),
    rowFilters: new Map(),
    policyFingerprint: 'allow-all',
    readAuthorityFingerprint: 'delegate-authority',
  });
  delegate.validateReadAuthorityAtDelivery = (_context, expected) => (
    expected === 'delegate-authority'
  );
  return delegate;
}

function platformSocket(sendStatuses: number[] = []) {
  const messages: ServerMessage[] = [];
  const data: SyncSocketData = {
    allowedTables: new Set(['rooms']),
    subscribedTopics: new Set(),
    lastSeq: 0,
    syncSubscribedTables: new Set(),
    syncBackpressured: false,
    authContext: CONTEXT.authContext,
    authResolved: true,
    authorizationFingerprint: 'policy',
    readAuthorizationFingerprint: null,
    authorizationScope: 'scope-a',
    connectionId: 'connection-1',
    query: {},
    stateSubscribed: false,
    ephemeralTopics: new Set(),
    resourceRowFilters: new Map(),
    resourceRowProjectors: new Map(),
    rowFilteredSubscribedTables: new Set(),
  };
  const value = {
    data,
    send(payload: string) {
      messages.push(JSON.parse(payload));
      return sendStatuses.shift() ?? payload.length;
    },
    close() {},
    subscribe() {},
    unsubscribe() {},
  } as unknown as ServerWebSocket<SyncSocketData>;
  return { value, data, messages };
}

function installAccess(
  data: SyncSocketData,
  access: Awaited<ReturnType<PlatformSyncPolicyService['resolveTableAccess']>>,
): void {
  data.allowedTables = access.readableTables;
  data.resourceRowFilters = access.rowFilters;
  data.resourceRowProjectors = access.rowProjectors ?? new Map();
  data.readAuthorizationFingerprint = access.readAuthorityFingerprint ?? null;
}
